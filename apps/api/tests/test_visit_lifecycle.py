"""M09-D2: жизненный цикл визита.

Приёмка: после переноса старый слот свободен, новый занят; в журнале есть запись события.
STOP: отмена удаляет историю или оставляет «призрачную» занятость.
"""
import asyncio
import datetime as dt
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.tests.company_factory import client, invite_admin, new_company

DAY = dt.date.today() + dt.timedelta(days=9)
UTC = dt.timezone.utc


def sql(q, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(q), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


def at(co, hh, mm=0):
    return dt.datetime.combine(DAY, dt.time(hh, mm), tzinfo=co.tz).astimezone(UTC)


async def setup(c, masters=1):
    co = await new_company(c, "Asia/Almaty")
    ids = [await co.staff(f"Мастер {i}", "10:00", "18:00") for i in range(masters)]
    svc = await co.service(5000_00, minutes=60)
    return co, ids, svc


async def book(co, staff, svc, start, phone="+77010009001"):
    r = await co.c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": str(uuid.uuid4())}, json={
        "branch_id": co.branch_id, "staff_id": staff, "service_ids": [svc], "starts_at_utc": start.isoformat(),
        "expected_price_minor": await price_of(co, staff, svc), "customer_name": "Клиент", "customer_phone": phone})
    assert r.status_code == 201, r.text
    return r.json()


async def price_of(co, staff, svc):
    items = (await co.c.get(f"/api/v1/public/staff/{staff}/services?branch_id={co.branch_id}", headers=co.host)).json()
    return {x["id"]: x["base_price_minor"] for x in items}[svc]


async def slot_starts(co, staff, svc):
    r = await co.c.post("/api/v1/public/availability/search", headers=co.host, json={
        "branch_id": co.branch_id, "service_ids": [svc], "staff_id": staff, "staff_mode": "specific",
        "from_date": DAY.isoformat(), "to_date": DAY.isoformat()})
    return {dt.datetime.fromisoformat(s["starts_at_utc"]) for s in r.json()["slots"]}


def active_occ(co, booking_id):
    return sql("SELECT starts_at_utc FROM staff_occupancies WHERE booking_id = :b AND released_at IS NULL", b=booking_id)


async def card(co, booking_id, h=None):
    return await co.c.get(f"/api/v1/business/bookings/{booking_id}", headers=h or co.h)


# ---------------------------------------------------------------- acceptance

async def test_reschedule_frees_old_slot_takes_new_and_logs_event():
    async with client() as c:
        co, (m,), svc = await setup(c)
        b = await book(co, m, svc, at(co, 11))
        assert at(co, 11) not in await slot_starts(co, m, svc)

        r = await c.post(f"/api/v1/business/bookings/{b['booking_id']}/reschedule", headers=co.h,
                         json={"new_starts_at_utc": at(co, 15).isoformat()})
        assert r.status_code == 200, r.text
        assert r.json()["version"] == 2

        starts = await slot_starts(co, m, svc)
        assert at(co, 11) in starts and at(co, 15) not in starts           # старый слот свободен, новый занят
        assert [o[0] for o in active_occ(co, b["booking_id"])] == [at(co, 15)]
        assert sql("SELECT count(*) FROM staff_occupancies WHERE booking_id = :b AND released_at IS NOT NULL",
                   b=b["booking_id"])[0][0] == 1                   # прежняя занятость не удалена, а освобождена
        ev = [e for e in (await card(co, b["booking_id"])).json()["events"] if e["event_type"] == "rescheduled"]
        assert len(ev) == 1
        assert dt.datetime.fromisoformat(ev[0]["old"]["starts_at_utc"]) == at(co, 11)
        assert dt.datetime.fromisoformat(ev[0]["new"]["starts_at_utc"]) == at(co, 15)
        assert ev[0]["actor_type"] == "staff" and ev[0]["actor_id"]

        # сдвиг на 30 минут внутрь собственного интервала тоже работает
        r = await c.post(f"/api/v1/business/bookings/{b['booking_id']}/reschedule", headers=co.h,
                         json={"new_starts_at_utc": at(co, 15, 30).isoformat()})
        assert r.status_code == 200, r.text
        assert [o[0] for o in active_occ(co, b["booking_id"])] == [at(co, 15, 30)]


async def test_reschedule_into_taken_time_keeps_original():
    async with client() as c:
        co, (m,), svc = await setup(c)
        b1 = await book(co, m, svc, at(co, 11))
        await book(co, m, svc, at(co, 14), phone="+77010009002")
        r = await c.post(f"/api/v1/business/bookings/{b1['booking_id']}/reschedule", headers=co.h,
                         json={"new_starts_at_utc": at(co, 14, 30).isoformat()})
        assert r.status_code == 409 and r.json()["detail"]["code"] in ("SLOT_CONFLICT", "CALENDAR_BLOCKED"), r.text
        assert r.json()["detail"]["details"]["alternatives"]
        cardj = (await card(co, b1["booking_id"])).json()
        assert dt.datetime.fromisoformat(str(cardj["starts_at_utc"])) == at(co, 11) and cardj["version"] == 1
        assert [o[0] for o in active_occ(co, b1["booking_id"])] == [at(co, 11)]
        assert not [e for e in cardj["events"] if e["event_type"] == "rescheduled"]


# ---------------------------------------------------------------- cancel keeps history, frees time

async def test_cancel_frees_time_and_keeps_history():
    async with client() as c:
        co, (m,), svc = await setup(c)
        b = await book(co, m, svc, at(co, 12))
        r = await c.post(f"/api/v1/business/bookings/{b['booking_id']}/cancel", headers=co.h, json={"reason": "Клиент заболел"})
        assert r.status_code == 200 and r.json()["status"] == "cancelled"
        assert active_occ(co, b["booking_id"]) == []                       # нет «призрачной» занятости
        assert at(co, 12) in await slot_starts(co, m, svc)
        cardj = (await card(co, b["booking_id"])).json()
        assert cardj["status"] == "cancelled" and cardj["cancellation_reason"] == "Клиент заболел"
        ev = [e for e in cardj["events"] if e["event_type"] == "cancelled"]
        assert ev and ev[0]["new"]["reason"] == "Клиент заболел" and ev[0]["old"]["status"] == "confirmed"
        assert cardj["allowed_transitions"] == []

        r = await c.post(f"/api/v1/business/bookings/{b['booking_id']}/cancel", headers=co.h, json={"reason": "ещё раз"})
        assert r.status_code == 409

    # историю нельзя стереть даже прямым запросом
    with pytest.raises(DBAPIError, match="HISTORY_IMMUTABLE"):
        sql("DELETE FROM bookings WHERE id = :b", b=b["booking_id"])
    with pytest.raises(DBAPIError, match="HISTORY_IMMUTABLE"):
        sql("UPDATE booking_events SET event_type = 'x' WHERE booking_id = :b", b=b["booking_id"])
    with pytest.raises(DBAPIError, match="HISTORY_IMMUTABLE"):
        sql("DELETE FROM booking_events WHERE booking_id = :b", b=b["booking_id"])


# ---------------------------------------------------------------- state machine

async def test_transitions_table_and_no_show_rule():
    async with client() as c:
        co, (m,), svc = await setup(c)
        b = await book(co, m, svc, at(co, 10))
        bid = b["booking_id"]
        status = lambda s, **kw: c.patch(f"/api/v1/business/bookings/{bid}/status", headers=co.h, json={"status": s, **kw})

        r = await status("no_show")
        assert r.status_code == 409 and r.json()["detail"]["code"] == "NO_SHOW_BEFORE_START"
        r = await status("teleported")
        assert r.status_code == 422 and r.json()["detail"]["code"] == "UNKNOWN_STATUS"
        assert (await card(co, bid)).json()["allowed_transitions"] == ["arrived", "in_progress", "completed", "no_show", "cancelled"]

        for s in ("arrived", "in_progress", "completed"):
            r = await status(s)
            assert r.status_code == 200, r.text
        r = await status("cancelled")
        assert r.status_code == 409 and r.json()["detail"]["code"] == "INVALID_TRANSITION"
        assert r.json()["detail"]["details"]["allowed"] == []
        r = await c.post(f"/api/v1/business/bookings/{bid}/reschedule", headers=co.h, json={"new_starts_at_utc": at(co, 16).isoformat()})
        assert r.status_code == 409
        cardj = (await card(co, bid)).json()
        assert cardj["version"] == 4
        assert [(e["old"]["status"], e["new"]["status"]) for e in reversed(cardj["events"]) if e["event_type"] == "status_changed"] == \
            [("confirmed", "arrived"), ("arrived", "in_progress"), ("in_progress", "completed")]
        assert active_occ(co, bid) != []                       # оказанный визит остаётся в календаре мастера


async def test_parallel_complete_and_cancel_only_one_wins():
    async with client() as c:
        co, (m,), svc = await setup(c)
        b = await book(co, m, svc, at(co, 13))
        bid = b["booking_id"]
        ops = []
        for i in range(5):
            ops.append(c.patch(f"/api/v1/business/bookings/{bid}/status", headers=co.h, json={"status": "completed"}))
            ops.append(c.post(f"/api/v1/business/bookings/{bid}/cancel", headers=co.h, json={"reason": f"r{i}"}))
        results = await asyncio.gather(*ops)
    codes = [r.status_code for r in results]
    assert codes.count(200) == 1 and codes.count(409) == 9, codes
    changes = sql("SELECT count(*) FROM booking_events WHERE booking_id = :b AND event_type IN ('status_changed', 'cancelled')", b=bid)[0][0]
    assert changes == 1
    final = sql("SELECT status, version FROM bookings WHERE id = :b", b=bid)[0]
    assert final[1] == 2 and final[0] in ("completed", "cancelled")
    occ = active_occ(co, bid)
    assert (final[0] == "cancelled") == (occ == [])


# ---------------------------------------------------------------- price snapshot on reschedule

async def test_reschedule_keeps_booked_price_and_reprices_only_for_another_master():
    async with client() as c:
        co, (m1, m2), svc = await setup(c, masters=2)
        r = await c.put(f"/api/v1/business/staff/{m2}/services", headers=co.h, json=[
            {"branch_id": co.branch_id, "service_id": svc, "price_override_minor": 7000_00}])
        assert r.status_code == 200
        b = await book(co, m1, svc, at(co, 11))
        # прайс вырос после записи: при переносе к тому же мастеру клиент сохраняет свою цену
        await c.patch(f"/api/v1/business/services/{svc}", headers=co.h, json={"base_price_minor": 6000_00})
        r = await c.post(f"/api/v1/business/bookings/{b['booking_id']}/reschedule", headers=co.h,
                         json={"new_starts_at_utc": at(co, 12).isoformat()})
        assert r.status_code == 200 and r.json()["amount_minor"] == 5000_00
        items = sql("SELECT price_minor_snapshot FROM booking_items WHERE booking_id = :b", b=b["booking_id"])
        assert [i[0] for i in items] == [5000_00]

        # клиент по ссылке к другому мастеру с другой ценой — не молча
        r = await c.post(f"/api/v1/public/manage/{b['management_token']}/reschedule",
                         json={"new_starts_at_utc": at(co, 16).isoformat(), "new_staff_id": m2})
        assert r.status_code in (409, 403), r.text
        if r.status_code == 409:
            assert r.json()["detail"]["code"] in ("PRICE_CHANGED", "CANCEL_CUTOFF_EXCEEDED")

        # администратор переносит к другому мастеру: позиции и сумма пересчитаны, событие хранит обе цены
        r = await c.post(f"/api/v1/business/bookings/{b['booking_id']}/reschedule", headers=co.h,
                         json={"new_starts_at_utc": at(co, 16).isoformat(), "new_staff_id": m2})
        assert r.status_code == 200, r.text
        assert r.json()["amount_minor"] == 7000_00 and r.json()["staff_id"] == m2
        assert [i[0] for i in sql("SELECT price_minor_snapshot FROM booking_items WHERE booking_id = :b", b=b["booking_id"])] == [7000_00]
        ev = [e for e in (await card(co, b["booking_id"])).json()["events"] if e["event_type"] == "rescheduled"][0]
        assert (ev["old"]["amount_minor"], ev["new"]["amount_minor"]) == (5000_00, 7000_00)


# ---------------------------------------------------------------- rights

async def test_branch_scope_on_booking_actions():
    async with client() as c:
        co, (m,), svc = await setup(c)
        other, (om,), osvc = await setup(c)
        b = await book(co, m, svc, at(co, 10))
        ob = await book(other, om, osvc, at(co, 10))
        assert (await card(co, ob["booking_id"])).status_code == 404            # чужая компания
        r = await c.patch(f"/api/v1/business/bookings/{ob['booking_id']}/status", headers=co.h, json={"status": "arrived"})
        assert r.status_code == 404

        second = sql("INSERT INTO branches (id, tenant_id, name, city, address, timezone_iana, status, created_at) "
                     "VALUES (gen_random_uuid(), :t, 'Второй', 'Алматы', 'ул. 2', 'Asia/Almaty', 'active', now()) RETURNING id",
                     t=co.tenant_id)[0][0]
        h, membership = await invite_admin(co)
        sql("INSERT INTO branch_role_grants (id, membership_id, branch_id) VALUES (gen_random_uuid(), :m, :b)", m=membership, b=second)
        assert (await card(co, b["booking_id"], h=h)).status_code == 403
        for call in (c.patch(f"/api/v1/business/bookings/{b['booking_id']}/status", headers=h, json={"status": "arrived"}),
                     c.post(f"/api/v1/business/bookings/{b['booking_id']}/cancel", headers=h, json={"reason": "x"}),
                     c.post(f"/api/v1/business/bookings/{b['booking_id']}/reschedule", headers=h,
                            json={"new_starts_at_utc": at(co, 15).isoformat()})):
            r = await call
            assert r.status_code == 403, r.text
        assert sql("SELECT status FROM bookings WHERE id = :b", b=b["booking_id"])[0][0] == "confirmed"
