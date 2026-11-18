"""M05-D2: контракт UTC/IANA для расписаний.

Приёмка M05: у двух мастеров разные цены и смены, сайт показывает соответствующие часы.
STOP: можно записать вне смены или перепутать часовую зону.

Правила контракта:
- в БД время записи хранится в UTC, смена мастера — локальное время филиала + IANA-пояс филиала;
- день смены — локальный день филиала; переход на летнее/зимнее время сдвигает UTC, но не локальное время;
- неверный пояс филиала не принимается (раньше молча становился UTC).
Каждый тест заводит свою компанию через настоящий онбординг, демо-данные не трогаются.
"""
import datetime as dt
import uuid
import zoneinfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.app.modules.bookings.service import BookingEngine
from apps.api.tests.company_factory import client, new_company

UTC = dt.timezone.utc


def test_kazakhstan_is_utc_plus_5_in_the_shipped_tz_database():
    # с 01.03.2024 весь Казахстан в UTC+5; старая база tz дала бы +6 и сдвиг всех записей на час
    assert zoneinfo.ZoneInfo("Asia/Almaty").utcoffset(dt.datetime(2026, 11, 18)) == dt.timedelta(hours=5)


async def test_two_masters_different_prices_and_shifts_on_the_site():
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")
        a = await co.staff("Мастер Утро", "10:00", "14:00")
        b = await co.staff("Мастер Вечер", "15:00", "19:00")
        svc = await co.service(8000_00)
        await co.price(a, svc, 9000_00)
        await co.price(b, svc, 12000_00)

        day = dt.date.today() + dt.timedelta(days=5)
        sa = await co.slots(svc, a, day, day + dt.timedelta(days=1))
        sb = await co.slots(svc, b, day, day + dt.timedelta(days=1))
        assert sa and sb
        assert {s["price_minor"] for s in sa} == {9000_00} and {s["price_minor"] for s in sb} == {12000_00}
        assert all(dt.time(10) <= co.local(s).time() and (co.local(s) + dt.timedelta(hours=1)).time() <= dt.time(14) for s in sa)
        assert all(dt.time(15) <= co.local(s).time() and (co.local(s) + dt.timedelta(hours=1)).time() <= dt.time(19) for s in sb)
        assert co.local(sa[0]).time() == dt.time(10) and co.local(sb[0]).time() == dt.time(15)

        # «любой мастер»: оба мастера со своими ценами
        both = await co.slots(svc, None, day, day, mode="any")
        assert {(s["staff_id"], s["price_minor"]) for s in both} == {(a, 9000_00), (b, 12000_00)}

        # записать мастера утренней смены на 15:00 нельзя
        evening = dt.datetime.combine(day, dt.time(15), tzinfo=co.tz).astimezone(UTC)
        r = await c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": str(uuid.uuid4())}, json={
            "branch_id": co.branch_id, "staff_id": a, "service_ids": [svc], "starts_at_utc": evening.isoformat(),
            "customer_name": "Вне смены", "customer_phone": "+77010000444", "expected_price_minor": 9000_00})
        assert r.status_code == 400 and "STAFF_OUTSIDE_SHIFT" in r.text, r.text

        # запись в смену хранится в UTC и с поясом филиала
        r = await c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": str(uuid.uuid4())}, json={
            "branch_id": co.branch_id, "staff_id": a, "service_ids": [svc], "starts_at_utc": sa[0]["starts_at_utc"],
            "customer_name": "В смену", "customer_phone": "+77010000445", "expected_price_minor": 9000_00})
        assert r.status_code == 201, r.text
        r = await c.get(f"/api/v1/business/bookings/{r.json()['booking_id']}", headers=co.h)
        assert r.status_code == 200
        booked = dt.datetime.fromisoformat(r.json()["starts_at_utc"])
        assert booked.utcoffset() == dt.timedelta(0) and booked.astimezone(co.tz).time() == dt.time(10)


async def test_dst_switch_keeps_local_hours():
    async with client() as c:
        co = await new_company(c, "Europe/Berlin")
        m = await co.staff("Berlin", "10:00", "12:00")
        svc = await co.service(5000_00)
        before, after = dt.date(2027, 3, 26), dt.date(2027, 3, 29)   # переход на летнее время 28.03.2027
        if after - dt.date.today() > dt.timedelta(days=170):
            before, after = dt.date(2027, 10, 29), dt.date(2027, 11, 1)  # обратный переход 31.10.2027
        s1 = await co.slots(svc, m, before, before)
        s2 = await co.slots(svc, m, after, after)
        assert co.local(s1[0]).time() == dt.time(10) and co.local(s2[0]).time() == dt.time(10)
        u1 = dt.datetime.fromisoformat(s1[0]["starts_at_utc"]).astimezone(UTC).time()
        u2 = dt.datetime.fromisoformat(s2[0]["starts_at_utc"]).astimezone(UTC).time()
        assert {u1, u2} == {dt.time(9), dt.time(8)}, (u1, u2)   # UTC сдвинулся на час, локальное время нет


async def test_late_local_shift_in_negative_offset_zone_is_found():
    """Регрессия: поиск шёл по UTC-датам и терял вечернюю смену там, где UTC уже «завтра»."""
    async with client() as c:
        co = await new_company(c, "America/New_York")
        m = await co.staff("Night", "20:00", "23:00")
        svc = await co.service(3000_00)
    day = dt.date.today() + dt.timedelta(days=10)
    from_utc = dt.datetime.combine(day, dt.time(20), tzinfo=co.tz).astimezone(UTC)   # уже следующий UTC-день
    engine = create_async_engine(settings.ASYNC_DATABASE_URL, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as s:
            await s.execute(text("SELECT set_config('app.current_tenant', :t, true)"), {"t": co.tenant_id})
            res = await BookingEngine.search_availability(
                s, uuid.UUID(co.tenant_id), uuid.UUID(co.branch_id), [uuid.UUID(svc)],
                from_utc, from_utc + dt.timedelta(hours=3), staff_id=uuid.UUID(m), staff_mode="specific")
            await s.rollback()
    finally:
        await engine.dispose()
    assert res["slots"], "вечерняя смена локального дня не найдена"
    assert dt.datetime.fromisoformat(res["slots"][0]["starts_at_utc"]) == from_utc


async def test_invalid_branch_timezone_is_rejected():
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")
        r = await c.patch(f"/api/v1/business/branches/{co.branch_id}", headers=co.h, json={"timezone_iana": "Asia/Almty"})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "TIMEZONE_INVALID"
        r = await c.patch(f"/api/v1/business/branches/{co.branch_id}", headers=co.h, json={"timezone_iana": "UTC+5"})
        assert r.status_code == 422
        branches = (await c.get("/api/v1/business/branches", headers=co.h)).json()
        assert branches[0]["timezone_iana"] == "Asia/Almaty"
