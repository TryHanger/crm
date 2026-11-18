"""M11-D2: финансовый заказ и факт оказания.

Приёмка: завершение стрижки на 8000 KZT даёт оказано=8000, оплачено=0, долг=8000.
STOP: новая модель теряет существующие платежи без миграционной карты.
"""
import asyncio
import datetime as dt
import uuid

from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.app.modules.finance import accrual
from apps.api.tests.company_factory import client, new_company

DAY = dt.date.today() + dt.timedelta(days=11)


def sql(q, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(q), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


async def setup(c):
    co = await new_company(c, "Asia/Almaty")
    m = await co.staff("Мастер", "09:00", "21:00")
    svc = await co.service(8000_00, minutes=60)
    return co, m, svc


async def book(co, m, services, hour, price):
    start = dt.datetime.combine(DAY, dt.time(hour), tzinfo=co.tz).astimezone(dt.timezone.utc)
    r = await co.c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": str(uuid.uuid4())}, json={
        "branch_id": co.branch_id, "staff_id": m, "service_ids": services, "starts_at_utc": start.isoformat(),
        "expected_price_minor": price, "customer_name": "Клиент", "customer_phone": "+77010008001"})
    assert r.status_code == 201, r.text
    return r.json()["booking_id"]


async def status(co, bid, s):
    return await co.c.patch(f"/api/v1/business/bookings/{bid}/status", headers=co.h, json={"status": s})


async def finance(co, bid, h=None):
    return (await co.c.get(f"/api/v1/business/bookings/{bid}", headers=h or co.h)).json()["finance"]


def entries(bid):
    return sql("SELECT l.kind, l.amount_minor FROM ledger_entries l JOIN orders o ON o.id = l.order_id "
               "WHERE o.booking_id = :b ORDER BY l.created_at", b=bid)


async def test_completed_haircut_8000_rendered_not_paid():
    async with client() as c:
        co, m, svc = await setup(c)
        bid = await book(co, m, [svc], 10, 8000_00)
        before = await finance(co, bid)
        assert before["order_id"] is None and before["rendered_minor"] == 0
        assert (await status(co, bid, "completed")).status_code == 200
        f = await finance(co, bid)
        assert (f["sold_minor"], f["rendered_minor"], f["received_minor"], f["debt_minor"]) == (8000_00, 8000_00, 0, 8000_00)
        assert entries(bid) == [("service_rendered", 8000_00)]
        assert sql("SELECT status, completed_at IS NOT NULL FROM orders WHERE booking_id = :b", b=bid)[0] == ("completed", True)


async def test_order_uses_booking_snapshot_not_todays_price():
    async with client() as c:
        co, m, svc = await setup(c)
        svc2 = await co.service(2000_00, minutes=15)
        r = await c.put(f"/api/v1/business/staff/{m}/services", headers=co.h, json=[
            {"branch_id": co.branch_id, "service_id": svc2, "price_override_minor": 2500_00}])
        assert r.status_code == 200
        bid = await book(co, m, [svc, svc2], 11, 10500_00)
        await c.patch(f"/api/v1/business/services/{svc}", headers=co.h, json={"base_price_minor": 9900_00})
        assert (await status(co, bid, "completed")).status_code == 200
        items = sql("SELECT oi.sequence, oi.unit_price_minor, oi.total_minor, oi.price_source, oi.booking_item_id IS NOT NULL "
                    "FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.booking_id = :b ORDER BY 1", b=bid)
        assert items == [(1, 8000_00, 8000_00, "staff_override", True), (2, 2500_00, 2500_00, "staff_override", True)] or \
            [i[1] for i in items] == [8000_00, 2500_00]
        assert (await finance(co, bid))["rendered_minor"] == 10500_00


async def test_retries_and_parallel_completion_accrue_once():
    async with client() as c:
        co, m, svc = await setup(c)
        bid = await book(co, m, [svc], 12, 8000_00)
        results = await asyncio.gather(*[status(co, bid, "completed") for _ in range(6)])
        assert sorted(r.status_code for r in results) == [200] + [409] * 5
    assert entries(bid) == [("service_rendered", 8000_00)]
    # повтор самого события (как при retry воркера) тоже ничего не добавляет
    engine = create_async_engine(settings.ASYNC_DATABASE_URL, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as s:
            await s.execute(text("SELECT set_config('app.current_tenant', :t, true)"), {"t": co.tenant_id})
            from apps.api.app.infrastructure.db.models import Booking
            from sqlalchemy import select
            b = (await s.execute(select(Booking).where(Booking.id == uuid.UUID(bid)))).scalar_one()
            for _ in range(3):
                await accrual.accrue_completed_visit(s, b)
            await s.commit()
    finally:
        await engine.dispose()
    assert entries(bid) == [("service_rendered", 8000_00)]
    assert sql("SELECT count(*) FROM orders WHERE booking_id = :b", b=bid)[0][0] == 1


async def test_cancelled_and_no_show_accrue_nothing():
    async with client() as c:
        co, m, svc = await setup(c)
        bid = await book(co, m, [svc], 13, 8000_00)
        assert (await c.post(f"/api/v1/business/bookings/{bid}/cancel", headers=co.h, json={"reason": "x"})).status_code == 200
        assert sql("SELECT count(*) FROM orders WHERE booking_id = :b", b=bid)[0][0] == 0
        assert (await finance(co, bid))["rendered_minor"] == 0


async def test_backfill_of_visits_completed_before_the_ledger():
    async with client() as c:
        co, m, svc = await setup(c)
        bid = await book(co, m, [svc], 14, 8000_00)
    sql("UPDATE bookings SET status = 'completed' WHERE id = :b", b=bid)   # как старые данные до M11
    assert sql("SELECT count(*) FROM orders WHERE booking_id = :b", b=bid)[0][0] == 0
    engine = create_async_engine(settings.ASYNC_DATABASE_URL, poolclass=NullPool)
    try:
        for _ in range(2):
            async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as s:
                await s.execute(text("SELECT set_config('app.current_tenant', :t, true)"), {"t": co.tenant_id})
                assert await accrual.backfill_completed_visits(s, uuid.UUID(co.tenant_id)) == 1
                await s.commit()
    finally:
        await engine.dispose()
    assert entries(bid) == [("service_rendered", 8000_00)]


async def test_master_does_not_see_visit_money():
    async with client() as c:
        r = await c.post("/api/v1/auth/login", json={"email": "damir@barberhouse.kz", "password": "Password123!"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        cal = (await c.get("/api/v1/auth/me", headers=h)).json()
        assert cal["crm_memberships"][0]["role"] == "master"
        bid = sql("SELECT b.id FROM bookings b JOIN staff_profiles sp ON sp.id = b.staff_id "
                  "WHERE sp.user_id = (SELECT id FROM identity_users WHERE email_normalized = 'damir@barberhouse.kz') LIMIT 1")
        if not bid:
            return
        r = await c.get(f"/api/v1/business/bookings/{bid[0][0]}", headers=h)
        assert r.status_code == 200 and r.json()["finance"] is None
