"""M12-D2: ручная касса и частичная оплата.

Приёмка: по заказу 8000 KZT внесли 3000 -> оплачено 3000, долг 5000, журнал денег сверился.
STOP: повтор запроса создаёт второе поступление или деньги смешиваются с выручкой.
"""
import asyncio
import datetime as dt
import uuid

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.tests.company_factory import client, invite_admin, new_company

DAY = dt.date.today() + dt.timedelta(days=12)


def sql(q, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(q), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


async def completed_visit(c, price=8000_00, co=None, hour=10):
    if co is None:
        co = await new_company(c, "Asia/Almaty")
        co.master = await co.staff("Мастер", "09:00", "21:00")
        co.svc = await co.service(price, minutes=60)
    start = dt.datetime.combine(DAY, dt.time(hour), tzinfo=co.tz).astimezone(dt.timezone.utc)
    r = await c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": str(uuid.uuid4())}, json={
        "branch_id": co.branch_id, "staff_id": co.master, "service_ids": [co.svc], "starts_at_utc": start.isoformat(),
        "expected_price_minor": price, "customer_name": "Клиент", "customer_phone": "+77010006001"})
    assert r.status_code == 201, r.text
    bid = r.json()["booking_id"]
    assert (await c.patch(f"/api/v1/business/bookings/{bid}/status", headers=co.h, json={"status": "completed"})).status_code == 200
    return co, bid


async def accounts(co):
    r = await co.c.get(f"/api/v1/business/cash-accounts?branch_id={co.branch_id}", headers=co.h)
    assert r.status_code == 200, r.text
    accs = {a["kind"]: a for a in r.json()}
    # M13: cash is accepted only within an open cash shift
    o = await co.c.post("/api/v1/business/cash-shifts/open", headers=co.h, json={"cash_account_id": accs["cash"]["id"]})
    assert o.status_code in (201, 409), o.text
    return accs


async def pay(co, bid, amount, account, key=None, h=None):
    return await co.c.post(f"/api/v1/business/bookings/{bid}/payments", headers={**(h or co.h), "Idempotency-Key": key or str(uuid.uuid4())},
                           json={"amount_minor": amount, "cash_account_id": account})


async def finance(co, bid):
    return (await co.c.get(f"/api/v1/business/bookings/{bid}", headers=co.h)).json()["finance"]


async def test_partial_payment_3000_of_8000_and_ledger_reconciles():
    async with client() as c:
        co, bid = await completed_visit(c)
        acc = await accounts(co)
        assert set(acc) == {"cash", "bank_transfer"} and all(a["balance_minor"] == 0 for a in acc.values())
        r = await pay(co, bid, 3000_00, acc["cash"]["id"])
        assert r.status_code == 201, r.text
        assert r.json()["finance"] == {"rendered_minor": 8000_00, "received_minor": 3000_00, "debt_minor": 5000_00}
        f = await finance(co, bid)
        assert (f["rendered_minor"], f["received_minor"], f["debt_minor"]) == (8000_00, 3000_00, 5000_00)
        assert (await accounts(co))["cash"]["balance_minor"] == 3000_00
        # сверка: сумма приходов по журналу = «получено» по заказу = остаток кассы
        total = sql("SELECT sum(amount_minor) FROM ledger_entries WHERE tenant_id = :t AND kind = 'payment'", t=co.tenant_id)[0][0]
        assert total == 3000_00
        hist = (await c.get(f"/api/v1/business/bookings/{bid}/payments", headers=co.h)).json()
        assert [(p["kind"], p["amount_minor"], p["cash_account"]) for p in hist] == [("payment", 3000_00, "Наличные")]

        # вторая часть через перевод — долг закрыт, выручка («оказано») не изменилась
        assert (await pay(co, bid, 5000_00, acc["bank_transfer"]["id"])).status_code == 201
        f = await finance(co, bid)
        assert (f["rendered_minor"], f["received_minor"], f["debt_minor"]) == (8000_00, 8000_00, 0)
        r = await pay(co, bid, 100, acc["cash"]["id"])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "NOTHING_TO_PAY"


async def test_repeated_request_never_takes_money_twice():
    async with client() as c:
        co, bid = await completed_visit(c)
        cash = (await accounts(co))["cash"]["id"]
        key = f"pay-{uuid.uuid4()}"
        results = await asyncio.gather(*[pay(co, bid, 3000_00, cash, key) for _ in range(10)])
        assert [r.status_code for r in results] == [201] * 10, [r.text for r in results]
        assert len({r.json()["payment_id"] for r in results}) == 1
        assert sum(not r.json()["replayed"] for r in results) == 1
        later = await pay(co, bid, 3000_00, cash, key)
        assert later.status_code == 201 and later.json()["replayed"] is True
        other = await pay(co, bid, 4000_00, cash, key)
        assert other.status_code == 409 and other.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"
        r = await c.post(f"/api/v1/business/bookings/{bid}/payments", headers=co.h,
                         json={"amount_minor": 100, "cash_account_id": cash})                  # без ключа
        assert r.status_code == 422 and r.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"
        assert (await finance(co, bid))["received_minor"] == 3000_00


async def test_no_overpayment_even_in_parallel():
    async with client() as c:
        co, bid = await completed_visit(c)
        cash = (await accounts(co))["cash"]["id"]
        r = await pay(co, bid, 9000_00, cash)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "OVERPAYMENT"
        results = await asyncio.gather(pay(co, bid, 5000_00, cash), pay(co, bid, 5000_00, cash))
        assert sorted(r.status_code for r in results) == [201, 409], [r.text for r in results]
        f = await finance(co, bid)
        assert f["received_minor"] == 5000_00 and f["received_minor"] <= f["rendered_minor"]


async def test_payment_only_after_service_and_only_by_cashier():
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")
        co.master = await co.staff("Мастер", "09:00", "21:00")
        co.svc = await co.service(8000_00, minutes=60)
        start = dt.datetime.combine(DAY, dt.time(15), tzinfo=co.tz).astimezone(dt.timezone.utc)
        r = await c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": str(uuid.uuid4())}, json={
            "branch_id": co.branch_id, "staff_id": co.master, "service_ids": [co.svc], "starts_at_utc": start.isoformat(),
            "expected_price_minor": 8000_00, "customer_name": "Клиент", "customer_phone": "+77010006002"})
        open_bid = r.json()["booking_id"]
        cash = (await accounts(co))["cash"]["id"]
        r = await pay(co, open_bid, 1000_00, cash)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "NOTHING_TO_PAY"   # аванс — M13

        co2, bid = await completed_visit(c, co=co, hour=10)
        other, obid = await completed_visit(c)
        other_cash = (await accounts(other))["cash"]["id"]
        r = await pay(co, bid, 1000_00, other_cash)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "CASH_ACCOUNT_NOT_FOUND"
        assert (await pay(co, obid, 1000_00, cash)).status_code == 404               # чужой визит

        r = await c.post("/api/v1/auth/login", json={"email": "damir@barberhouse.kz", "password": "Password123!"})
        master_h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        assert (await c.get(f"/api/v1/business/cash-accounts?branch_id={co.branch_id}", headers=master_h)).status_code == 403
        assert (await pay(co, bid, 1000_00, cash, h=master_h)).status_code == 403

        second = sql("INSERT INTO branches (id, tenant_id, name, city, address, timezone_iana, status, created_at) "
                     "VALUES (gen_random_uuid(), :t, 'Второй', 'Алматы', 'ул. 2', 'Asia/Almaty', 'active', now()) RETURNING id",
                     t=co.tenant_id)[0][0]
        admin_h, membership = await invite_admin(co)
        sql("INSERT INTO branch_role_grants (id, membership_id, branch_id) VALUES (gen_random_uuid(), :m, :b)", m=membership, b=second)
        assert (await pay(co, bid, 1000_00, cash, h=admin_h)).status_code == 403
        assert (await finance(co, bid))["received_minor"] == 0
