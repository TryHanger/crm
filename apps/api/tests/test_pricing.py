"""M04-D2: цены, валюта, привязки tenant/branch.

Приёмка: владелец создал услугу за 8000 KZT, клиент видит её в своём филиале.
STOP: формы сохраняют только UI-состояние или нет разделения филиалов.
"""
import uuid
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.app.main import app
from apps.api.app.modules.finance import money

BH_HOST = {"Host": "barberhouse.book.example.kz"}
PWD = "Password123!"


# ---------------------------------------------------------------- money contract

def test_format_and_parse_minor_units():
    assert money.format_minor(8000_00) == "8 000 ₸"
    assert money.format_minor(8000_50) == "8 000,50 ₸"
    assert money.format_minor(5) == "0,05 ₸"
    assert money.format_minor(-1500_00) == "-1 500 ₸"
    assert money.to_minor("8000") == 800000
    assert money.to_minor(Decimal("12.34")) == 1234
    with pytest.raises(money.MoneyError):
        money.to_minor("0.001")


def test_rounding_is_half_up_once():
    assert money.round_half_up(5, 2) == 3
    assert money.round_half_up(4, 3) == 1
    assert money.percent_of(8000_00, 10) == 800_00
    assert money.percent_of(333, Decimal("12.5")) == 42      # 41.625 -> 42
    assert money.percent_of(1, 50) == 1                       # 0.5 -> 1


@pytest.mark.parametrize("total,weights", [(100, [1, 1, 1]), (8000_00, [3, 5]), (1, [1, 1]), (99999, [7, 0, 13])])
def test_allocation_never_loses_or_creates_money(total, weights):
    parts = money.allocate(total, weights)
    assert sum(parts) == total and len(parts) == len(weights)
    assert all(p >= 0 for p in parts)


def test_price_validation_and_currency_mixing():
    assert money.validate_price_minor(0) == 0
    for bad in (-1, money.MAX_PRICE_MINOR + 1, 1.5, True):
        with pytest.raises(money.MoneyError):
            money.validate_price_minor(bad)
    assert money.sum_same_currency([(100, "KZT"), (250, "kzt")]) == (350, "KZT")
    with pytest.raises(money.MoneyError) as e:
        money.sum_same_currency([(100, "KZT"), (100, "USD")])
    assert e.value.code in ("CURRENCY_UNSUPPORTED", "CURRENCY_MISMATCH")


# ---------------------------------------------------------------- helpers

def admin(sql, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(sql), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


async def crm(c, email):
    r = await c.post("/api/v1/auth/login", json={"email": email, "password": PWD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def first(c, path, h):
    r = await c.get(path, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- acceptance

async def test_owner_creates_8000_kzt_service_and_client_sees_it_in_branch():
    async with client() as c:
        h = await crm(c, "owner@barberhouse.kz")
        branch_id = (await first(c, "/api/v1/business/branches", h))[0]["id"]
        name = f"M04 Стрижка {uuid.uuid4().hex[:6]}"
        r = await c.post("/api/v1/business/services", headers=h, json={
            "name": f"  {name}  ", "base_price_minor": money.to_minor("8000"), "base_duration_minutes": 60})
        assert r.status_code == 201, r.text
        svc = r.json()
        try:
            assert svc["name"] == name and svc["base_price_minor"] == 800000 and svc["currency"] == "KZT"

            listed = await first(c, f"/api/v1/public/services?branch_id={branch_id}", BH_HOST)
            mine = [s for s in listed if s["id"] == svc["id"]]
            assert len(mine) == 1
            assert mine[0]["base_price_minor"] == 800000 and mine[0]["price_formatted"] == "8 000 ₸"

            # другая компания эту услугу не видит
            mc = await first(c, "/api/v1/public/services", {"Host": "moderncut.book.example.kz"})
            assert svc["id"] not in {s["id"] for s in mc}

            # без активного мастера в филиале услуга в этом филиале не показывается
            admin("UPDATE staff_service_offers SET active = false WHERE service_id = :s", s=svc["id"])
            listed = await first(c, f"/api/v1/public/services?branch_id={branch_id}", BH_HOST)
            assert svc["id"] not in {s["id"] for s in listed}
        finally:
            await c.delete(f"/api/v1/business/services/{svc['id']}", headers=h)


async def test_public_services_reject_foreign_branch():
    async with client() as c:
        hm = await crm(c, "owner@moderncut.kz")
        mc_branch = (await first(c, "/api/v1/business/branches", hm))[0]["id"]
        r = await c.get(f"/api/v1/public/services?branch_id={mc_branch}", headers=BH_HOST)
        assert r.status_code == 404 and r.json()["detail"]["code"] == "BRANCH_NOT_FOUND"


@pytest.mark.parametrize("patch,field", [
    ({"base_price_minor": -100}, "base_price_minor"),
    ({"base_price_minor": money.MAX_PRICE_MINOR + 1}, "base_price_minor"),
    ({"base_price_minor": 2_147_483_648}, "base_price_minor"),   # раньше: переполнение int4 -> 500
    ({"base_price_minor": "8000.5"}, "base_price_minor"),
    ({"base_duration_minutes": 0}, "base_duration_minutes"),
    ({"base_duration_minutes": 1441}, "base_duration_minutes"),
    ({"name": ""}, "name"),
])
async def test_invalid_service_payload_is_rejected(patch, field):
    body = {"name": "Неверная услуга", "base_price_minor": 100000, "base_duration_minutes": 30, **patch}
    async with client() as c:
        h = await crm(c, "owner@barberhouse.kz")
        r = await c.post("/api/v1/business/services", headers=h, json=body)
    assert r.status_code == 422, r.text
    assert field in r.text


async def test_cannot_reference_other_company_category_or_service():
    async with client() as c:
        h = await crm(c, "owner@barberhouse.kz")
        hm = await crm(c, "owner@moderncut.kz")
        r = await c.post("/api/v1/business/service-categories", headers=hm, json={"name": f"MC cat {uuid.uuid4().hex[:4]}"})
        assert r.status_code == 201
        mc_cat = r.json()["id"]
        mc_service = (await first(c, "/api/v1/business/services", hm))[0]["id"]
        mc_branch = (await first(c, "/api/v1/business/branches", hm))[0]["id"]

        r = await c.post("/api/v1/business/services", headers=h, json={
            "name": "Чужая категория", "category_id": mc_cat, "base_price_minor": 100000, "base_duration_minutes": 30})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "CATEGORY_NOT_FOUND"

        bh_service = (await first(c, "/api/v1/business/services", h))[0]["id"]
        r = await c.patch(f"/api/v1/business/services/{bh_service}", headers=h, json={"category_id": mc_cat})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "CATEGORY_NOT_FOUND"

        branch_id = (await first(c, "/api/v1/business/branches", h))[0]["id"]
        staff_id = (await first(c, "/api/v1/business/staff", h))[0]["id"]
        cases = [
            ([{"branch_id": branch_id, "service_id": mc_service, "price_override_minor": 1}], 422, "SERVICE_NOT_FOUND"),
            ([{"branch_id": mc_branch, "service_id": bh_service, "price_override_minor": 1}], 422, "BRANCH_NOT_FOUND"),
            ([{"branch_id": branch_id, "service_id": bh_service, "price_override_minor": -5}], 422, None),
            ([{"branch_id": branch_id, "service_id": bh_service},
              {"branch_id": branch_id, "service_id": bh_service}], 422, "DUPLICATE_OFFER"),
        ]
        for payload, status, code in cases:
            r = await c.put(f"/api/v1/business/staff/{staff_id}/services", headers=h, json=payload)
            assert r.status_code == status, (payload, r.text)
            if code:
                assert r.json()["detail"]["code"] == code
        r = await c.put(f"/api/v1/business/staff/{uuid.uuid4()}/services", headers=h, json=[])
        assert r.status_code == 404

    # ничего чужого не записалось
    assert admin("SELECT count(*) FROM staff_service_offers o JOIN services s ON s.id = o.service_id "
                 "WHERE s.tenant_id <> o.tenant_id")[0][0] == 0


async def test_staff_price_only_in_branch_where_staff_works():
    async with client() as c:
        h = await crm(c, "owner@barberhouse.kz")
        branch_id = (await first(c, "/api/v1/business/branches", h))[0]["id"]
        staff_id = (await first(c, "/api/v1/business/staff", h))[0]["id"]
        service_id = (await first(c, "/api/v1/business/services", h))[0]["id"]
        admin("UPDATE staff_branches SET active = false WHERE staff_id = :s AND branch_id = :b", s=staff_id, b=branch_id)
        try:
            r = await c.put(f"/api/v1/business/staff/{staff_id}/services", headers=h,
                            json=[{"branch_id": branch_id, "service_id": service_id, "price_override_minor": 900000}])
            assert r.status_code == 422 and r.json()["detail"]["code"] == "STAFF_NOT_IN_BRANCH"
        finally:
            admin("UPDATE staff_branches SET active = true WHERE staff_id = :s AND branch_id = :b", s=staff_id, b=branch_id)


def test_database_rejects_cross_tenant_catalog_links():
    bh = admin("SELECT t.id, sp.id, b.id FROM tenants t JOIN staff_profiles sp ON sp.tenant_id = t.id "
               "JOIN branches b ON b.tenant_id = t.id WHERE t.slug = 'barberhouse' LIMIT 1")[0]
    mc_service = admin("SELECT s.id FROM services s JOIN tenants t ON t.id = s.tenant_id WHERE t.slug = 'moderncut' LIMIT 1")[0][0]
    mc_category = admin("SELECT c.id FROM service_categories c JOIN tenants t ON t.id = c.tenant_id "
                        "WHERE t.slug = 'moderncut' LIMIT 1")
    with pytest.raises(IntegrityError, match="fk_offer_service_same_tenant"):
        admin("INSERT INTO staff_service_offers (id, tenant_id, staff_id, branch_id, service_id, active, online_visible) "
              "VALUES (gen_random_uuid(), :t, :st, :b, :s, true, true)", t=bh[0], st=bh[1], b=bh[2], s=mc_service)
    if mc_category:
        with pytest.raises(IntegrityError, match="fk_service_category_same_tenant"):
            admin("UPDATE services SET category_id = :c WHERE tenant_id = :t", c=mc_category[0][0], t=bh[0])
