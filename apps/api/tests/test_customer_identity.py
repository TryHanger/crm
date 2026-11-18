"""M10-D2: база клиентов — нормализация номеров KZ, подтверждённые правила привязки, изоляция.

Приёмка: повторный визит на тот же номер привязан к клиенту по подтверждённым правилам;
чужие клиенты невидимы.
STOP: один общий телефон автоматически объединяет двух разных людей.
"""
import asyncio
import datetime as dt
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.app.modules.customers.identity import PhoneError, name_key, normalize_phone, search_digits
from apps.api.tests.company_factory import client, new_company

DAY = dt.date.today() + dt.timedelta(days=10)


def sql(q, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(q), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


# ---------------------------------------------------------------- rules

@pytest.mark.parametrize("raw", ["+7 701 111-22-33", "8 701 111 22 33", "87011112233", "77011112233",
                                 "7011112233", "+7(701)111-22-33", " +7 701 1112233 "])
def test_kz_formats_normalize_to_one_number(raw):
    assert normalize_phone(raw) == "+77011112233"


@pytest.mark.parametrize("raw", ["", "abc", "12345", "8701111223", "+7701111223", "+7 001 111 22 33",
                                 "++77011112233", "7011112233x", "+7 701 111 22 33 доб. 5"])
def test_invalid_numbers_are_rejected(raw):
    with pytest.raises(PhoneError):
        normalize_phone(raw)


def test_foreign_numbers_and_helpers():
    assert normalize_phone("+49 30 1234567") == "+49301234567"
    assert name_key("  Алёна   ИВАНОВА ") == name_key("алена иванова")
    assert search_digits("8 701 11") == "770111" and search_digits("Айгерим") is None


# ---------------------------------------------------------------- helpers

async def setup(c):
    co = await new_company(c, "Asia/Almaty")
    m = await co.staff("Мастер", "09:00", "21:00")
    svc = await co.service(5000_00, minutes=30)
    return co, m, svc


async def book(co, m, svc, hour, minute, name, phone):
    start = dt.datetime.combine(DAY, dt.time(hour, minute), tzinfo=co.tz).astimezone(dt.timezone.utc)
    return await co.c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": str(uuid.uuid4())}, json={
        "branch_id": co.branch_id, "staff_id": m, "service_ids": [svc], "starts_at_utc": start.isoformat(),
        "expected_price_minor": 5000_00, "customer_name": name, "customer_phone": phone})


def customer_of(booking_id):
    return str(sql("SELECT customer_id FROM bookings WHERE id = :b", b=booking_id)[0][0])


# ---------------------------------------------------------------- acceptance

async def test_repeat_visit_links_by_confirmed_rules_and_shared_phone_is_not_merged():
    async with client() as c:
        co, m, svc = await setup(c)
        r1 = await book(co, m, svc, 10, 0, "Айгерим Сапарова", "8 701 555 44 33")
        r2 = await book(co, m, svc, 11, 0, "  айгерим   сапарова", "+7 (701) 555-44-33")
        r3 = await book(co, m, svc, 12, 0, "Гульнара Сапарова", "87015554433")   # мама, тот же телефон
        assert [r.status_code for r in (r1, r2, r3)] == [201, 201, 201], [r.text for r in (r1, r2, r3)]
        aigerim, again, mother = (customer_of(r.json()["booking_id"]) for r in (r1, r2, r3))
        assert aigerim == again                     # повторный визит -> тот же клиент
        assert mother != aigerim                    # другой человек с тем же номером -> не слит

        rows = sql("SELECT full_name, phone_e164 FROM customers WHERE tenant_id = :t ORDER BY created_at", t=co.tenant_id)
        assert rows == [("Айгерим Сапарова", "+77015554433"), ("Гульнара Сапарова", "+77015554433")]

        cardj = (await c.get(f"/api/v1/business/customers/{aigerim}", headers=co.h)).json()
        assert cardj["total_bookings"] == 2 and cardj["phone"] == "+77015554433"
        assert [x["full_name"] for x in cardj["same_phone_customers"]] == ["Гульнара Сапарова"]
        mom = (await c.get(f"/api/v1/business/customers/{mother}", headers=co.h)).json()
        assert mom["total_bookings"] == 1


async def test_other_companies_clients_are_invisible():
    async with client() as c:
        a, m, svc = await setup(c)
        b, _, _ = await setup(c)
        r = await book(a, m, svc, 10, 0, "Тайный Клиент", "+77016667788")
        cust = customer_of(r.json()["booking_id"])
        for term in ("Тайный", "87016667788", "6667788"):
            found = (await c.get(f"/api/v1/business/customers?search={term}", headers=b.h)).json()
            assert found == [], term
        assert (await c.get(f"/api/v1/business/customers/{cust}", headers=b.h)).status_code == 404
        r = await c.patch(f"/api/v1/business/customers/{cust}", headers=b.h, json={"full_name": "Взлом"})
        assert r.status_code == 404
        # а своя компания находит по номеру в любом написании
        for term in ("8 701 666", "+7 701 666 77 88", "6667788", "Тайный"):
            found = (await c.get(f"/api/v1/business/customers?search={term}", headers=a.h)).json()
            assert [x["id"] for x in found] == [cust], term
        assert (await c.get("/api/v1/business/customers?search=%25", headers=a.h)).json() == []   # «%» — не шаблон


# ---------------------------------------------------------------- safe duplicates

async def test_parallel_bookings_from_one_new_number_create_one_client():
    async with client() as c:
        co, m, svc = await setup(c)
        results = await asyncio.gather(*[book(co, m, svc, 9 + i, 0, "Новый Клиент", "+7 701 999 00 11") for i in range(8)])
    assert [r.status_code for r in results] == [201] * 8, [r.text for r in results]
    assert sql("SELECT count(*) FROM customers WHERE tenant_id = :t", t=co.tenant_id)[0][0] == 1


async def test_two_clients_on_one_phone_do_not_break_booking():
    """Раньше: поиск клиента по телефону через scalar_one_or_none -> 500, как только номер был у двоих."""
    async with client() as c:
        co, m, svc = await setup(c)
        for name in ("Отец Ахметов", "Сын Ахметов"):
            r = await c.post("/api/v1/business/customers", headers=co.h, json={"full_name": name, "phone_e164": "+77017770000"})
            assert r.status_code == 201 and r.json()["duplicate_detected"] is False
        r1 = await book(co, m, svc, 10, 0, "Сын Ахметов", "87017770000")
        r2 = await book(co, m, svc, 11, 0, "Внук Ахметов", "87017770000")
        assert r1.status_code == 201 and r2.status_code == 201, (r1.text, r2.text)
        names = dict(sql("SELECT b.id::text, c.full_name FROM bookings b JOIN customers c ON c.id = b.customer_id "
                         "WHERE b.tenant_id = :t", t=co.tenant_id))
        assert names[r1.json()["booking_id"]] == "Сын Ахметов" and names[r2.json()["booking_id"]] == "Внук Ахметов"


async def test_invalid_phone_is_rejected_everywhere():
    async with client() as c:
        co, m, svc = await setup(c)
        r = await book(co, m, svc, 10, 0, "Клиент", "8 701 11")
        assert r.status_code == 422 and r.json()["detail"]["code"] == "PHONE_INVALID"
        r = await c.post("/api/v1/business/customers", headers=co.h, json={"full_name": "Клиент", "phone_e164": "позвоните мне"})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "PHONE_INVALID"
        ok = await c.post("/api/v1/business/customers", headers=co.h, json={"full_name": "Клиент", "phone_e164": "+77010001122"})
        r = await c.patch(f"/api/v1/business/customers/{ok.json()['id']}", headers=co.h, json={"phone_e164": "12"})
        assert r.status_code == 422
        r = await c.patch(f"/api/v1/business/customers/{ok.json()['id']}", headers=co.h, json={"phone_e164": "8 701 000 11 23"})
        assert r.status_code == 200
        assert sql("SELECT phone_e164, phone_digits_index FROM customers WHERE id = :i", i=ok.json()["id"])[0] == ("+77010001123", "77010001123")
    assert sql("SELECT count(*) FROM bookings WHERE tenant_id = :t", t=co.tenant_id)[0][0] == 0
