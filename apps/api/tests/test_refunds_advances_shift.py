"""M13-D2: возвраты, авансы и кассовая смена.

Приёмка: частичная оплата, возврат 1000, аванс 2000 корректно отражены и сверены.
STOP: возврат реализован удалением исходного платежа.
"""
import asyncio
import datetime as dt
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.tests.company_factory import client, new_company

DAY = dt.date.today() + dt.timedelta(days=13)


def sql(q, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(q), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


def k():
    return str(uuid.uuid4())


async def setup(c):
    co = await new_company(c, "Asia/Almaty")
    co.master = await co.staff("Мастер", "09:00", "21:00")
    co.svc = await co.service(8000_00, minutes=60)
    accs = {a["kind"]: a["id"] for a in (await c.get(f"/api/v1/business/cash-accounts?branch_id={co.branch_id}", headers=co.h)).json()}
    co.cash, co.bank = accs["cash"], accs["bank_transfer"]
    return co


async def visit(co, hour, complete=True, phone="+77010007100"):
    start = dt.datetime.combine(DAY, dt.time(hour), tzinfo=co.tz).astimezone(dt.timezone.utc)
    r = await co.c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": k()}, json={
        "branch_id": co.branch_id, "staff_id": co.master, "service_ids": [co.svc], "starts_at_utc": start.isoformat(),
        "expected_price_minor": 8000_00, "customer_name": "Клиент Смены", "customer_phone": phone})
    assert r.status_code == 201, r.text
    bid = r.json()["booking_id"]
    if complete:
        assert (await co.c.patch(f"/api/v1/business/bookings/{bid}/status", headers=co.h, json={"status": "completed"})).status_code == 200
    cust = str(sql("SELECT customer_id FROM bookings WHERE id = :b", b=bid)[0][0])
    return bid, cust


async def post(co, path, body, key=None):
    return await co.c.post(path, headers={**co.h, "Idempotency-Key": key or k()}, json=body)


async def open_shift(co, float_minor=0):
    r = await co.c.post("/api/v1/business/cash-shifts/open", headers=co.h, json={"cash_account_id": co.cash, "opening_float_minor": float_minor})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def finance(co, bid):
    return (await co.c.get(f"/api/v1/business/bookings/{bid}", headers=co.h)).json()["finance"]


# ---------------------------------------------------------------- acceptance

async def test_partial_payment_refund_1000_advance_2000_reconcile():
    async with client() as c:
        co = await setup(c)
        shift = await open_shift(co, float_minor=10000_00)
        bid, cust = await visit(co, 10)

        pay = await post(co, f"/api/v1/business/bookings/{bid}/payments", {"amount_minor": 3000_00, "cash_account_id": co.cash})
        assert pay.status_code == 201, pay.text
        r = await post(co, f"/api/v1/business/bookings/{bid}/refunds", {"amount_minor": 1000_00, "cash_account_id": co.cash, "reason": "Жалоба на качество"})
        assert r.status_code == 201, r.text
        f = r.json()["finance"]
        assert (f["rendered_minor"], f["received_minor"], f["debt_minor"]) == (7000_00, 2000_00, 5000_00)

        r = await post(co, f"/api/v1/business/customers/{cust}/advances", {"branch_id": co.branch_id, "amount_minor": 2000_00, "cash_account_id": co.cash})
        assert r.status_code == 201 and r.json()["advance_balance_minor"] == 2000_00, r.text
        assert (await finance(co, bid))["rendered_minor"] == 7000_00          # аванс — не выручка

        r = await post(co, f"/api/v1/business/bookings/{bid}/apply-advance", {"amount_minor": 2000_00})
        assert r.status_code == 201, r.text
        assert r.json()["finance"]["debt_minor"] == 3000_00
        adv = (await c.get(f"/api/v1/business/customers/{cust}/advance", headers=co.h)).json()
        assert adv["advance_balance_minor"] == 0

        rep = (await c.get(f"/api/v1/business/cash-shifts/{shift}", headers=co.h)).json()
        assert rep["movements"] == {"payment": 3000_00, "refund": 1000_00, "advance": 2000_00}
        assert rep["expected_minor"] == 10000_00 + 3000_00 - 1000_00 + 2000_00
        r = await c.post(f"/api/v1/business/cash-shifts/{shift}/close", headers=co.h, json={"counted_minor": 14000_00})
        assert r.status_code == 200 and r.json()["difference_minor"] == 0 and r.json()["status"] == "closed"

        # исходная оплата на месте, возврат — отдельная запись с причиной и автором
        rows = sql("SELECT kind, amount_minor, reason, created_by_user_id IS NOT NULL FROM ledger_entries "
                   "WHERE order_id = (SELECT id FROM orders WHERE booking_id = :b) ORDER BY created_at", b=bid)
        kinds = [(r[0], r[1]) for r in rows]
        assert ("payment", 3000_00) in kinds and ("refund", 1000_00) in kinds and ("adjustment", -1000_00) in kinds
        refund_row = next(r for r in rows if r[0] == "refund")
        assert refund_row[2] == "Жалоба на качество" and refund_row[3] is True


async def test_refund_rules():
    async with client() as c:
        co = await setup(c)
        await open_shift(co)
        bid, _ = await visit(co, 11)
        await post(co, f"/api/v1/business/bookings/{bid}/payments", {"amount_minor": 3000_00, "cash_account_id": co.cash})
        r = await post(co, f"/api/v1/business/bookings/{bid}/refunds", {"amount_minor": 3500_00, "cash_account_id": co.cash, "reason": "x"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "REFUND_EXCEEDS_RECEIVED"
        r = await post(co, f"/api/v1/business/bookings/{bid}/refunds", {"amount_minor": 100, "cash_account_id": co.cash, "reason": ""})
        assert r.status_code == 422
        key = k()
        r1 = await post(co, f"/api/v1/business/bookings/{bid}/refunds", {"amount_minor": 500_00, "cash_account_id": co.cash, "reason": "Ошибка"}, key)
        r2 = await post(co, f"/api/v1/business/bookings/{bid}/refunds", {"amount_minor": 500_00, "cash_account_id": co.cash, "reason": "Ошибка"}, key)
        assert r1.status_code == r2.status_code == 201 and r2.json()["replayed"] is True and r1.json()["entry_id"] == r2.json()["entry_id"]
        assert (await finance(co, bid))["received_minor"] == 2500_00
    with pytest.raises(DBAPIError, match="FINANCE_IMMUTABLE"):
        sql("DELETE FROM ledger_entries WHERE kind = 'payment' AND order_id = (SELECT id FROM orders WHERE booking_id = :b)", b=bid)


# ---------------------------------------------------------------- closed period

async def test_closed_shift_is_locked_and_corrections_go_to_current_shift():
    async with client() as c:
        co = await setup(c)
        shift1 = await open_shift(co)
        bid, _ = await visit(co, 12)
        pay = (await post(co, f"/api/v1/business/bookings/{bid}/payments", {"amount_minor": 3000_00, "cash_account_id": co.cash})).json()
        r = await c.post(f"/api/v1/business/cash-shifts/{shift1}/close", headers=co.h, json={"counted_minor": 2900_00})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "DIFFERENCE_REASON_REQUIRED"
        r = await c.post(f"/api/v1/business/cash-shifts/{shift1}/close", headers=co.h, json={"counted_minor": 2900_00, "note": "Недостача 100"})
        assert r.status_code == 200 and r.json()["difference_minor"] == -100_00

        r = await post(co, f"/api/v1/business/bookings/{bid}/payments", {"amount_minor": 1000_00, "cash_account_id": co.cash})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "SHIFT_REQUIRED"
        r = await post(co, f"/api/v1/business/bookings/{bid}/payments", {"amount_minor": 1000_00, "cash_account_id": co.bank})
        assert r.status_code == 201                                     # безнал работает без смены
        r = await post(co, f"/api/v1/business/ledger-entries/{pay['payment_id']}/reverse", {"reason": "Ошибочно пробили"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "SHIFT_REQUIRED"

        shift2 = await open_shift(co)
        r = await post(co, f"/api/v1/business/ledger-entries/{pay['payment_id']}/reverse", {"reason": "Ошибочно пробили"})
        assert r.status_code == 201, r.text
        assert str(sql("SELECT cash_shift_id FROM ledger_entries WHERE id = :i", i=r.json()["entry_id"])[0][0]) == shift2
        closed = (await c.get(f"/api/v1/business/cash-shifts/{shift1}", headers=co.h)).json()
        assert closed["movements"] == {"payment": 3000_00} and closed["counted_minor"] == 2900_00   # закрытая смена не изменилась

    with pytest.raises(DBAPIError, match="PERIOD_CLOSED"):
        sql("UPDATE cash_shifts SET counted_minor = 3000_00 WHERE id = :s", s=shift1)
    with pytest.raises(DBAPIError, match="PERIOD_CLOSED"):
        sql("INSERT INTO ledger_entries (id, tenant_id, branch_id, kind, amount_minor, currency, idempotency_key, cash_account_id, cash_shift_id) "
            "VALUES (gen_random_uuid(), :t, :b, 'service_rendered', 100, 'KZT', :k, :a, :s)",
            t=co.tenant_id, b=co.branch_id, k=k(), a=co.cash, s=shift1)


async def test_shift_rules():
    async with client() as c:
        co = await setup(c)
        await open_shift(co)
        r = await c.post("/api/v1/business/cash-shifts/open", headers=co.h, json={"cash_account_id": co.cash})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "SHIFT_ALREADY_OPEN"
        r = await c.post("/api/v1/business/cash-shifts/open", headers=co.h, json={"cash_account_id": co.bank})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "SHIFT_NOT_FOR_ACCOUNT"


# ---------------------------------------------------------------- advances

async def test_advance_cannot_be_overspent_even_in_parallel():
    async with client() as c:
        co = await setup(c)
        await open_shift(co)
        b1, cust = await visit(co, 13)
        b2, cust2 = await visit(co, 15)
        assert cust == cust2
        r = await post(co, f"/api/v1/business/customers/{cust}/advances", {"branch_id": co.branch_id, "amount_minor": 2000_00, "cash_account_id": co.cash})
        adv_id = r.json()["entry_id"]
        r = await post(co, f"/api/v1/business/bookings/{b1}/apply-advance", {"amount_minor": 2500_00})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "ADVANCE_INSUFFICIENT"
        results = await asyncio.gather(post(co, f"/api/v1/business/bookings/{b1}/apply-advance", {"amount_minor": 2000_00}),
                                       post(co, f"/api/v1/business/bookings/{b2}/apply-advance", {"amount_minor": 2000_00}))
        assert sorted(r.status_code for r in results) == [201, 409], [r.text for r in results]
        assert (await c.get(f"/api/v1/business/customers/{cust}/advance", headers=co.h)).json()["advance_balance_minor"] == 0
        r = await post(co, f"/api/v1/business/ledger-entries/{adv_id}/reverse", {"reason": "Вернули клиенту"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "ADVANCE_ALREADY_USED"
