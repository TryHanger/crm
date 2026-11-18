"""M06-D2: контракт availability / quote / booking для трёх сценариев записи.

Сервер решает, какие слоты есть и сколько они стоят; клиент только показывает их и бронирует по quote.
- по услуге: несколько услуг одного мастера, индивидуальная цена и длительность, снимок цен в брони;
- по мастеру: список мастеров и цены мастера совпадают с тем, что вернёт поиск;
- по времени: сначала время (без услуги), потом услуги на это время (at_utc), потом бронь;
- «любой мастер»: порядок — время, затем цена; бронь по выбранному слоту.
STOP M06: time-first только рисует слоты и не завершает бронирование.
"""
import datetime as dt
import uuid

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.tests.company_factory import client, new_company


def admin(sql, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(sql), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


async def offer(co, staff_id, service_id, price=None, minutes=None, active=True):
    r = await co.c.put(f"/api/v1/business/staff/{staff_id}/services", headers=co.h, json=[{
        "branch_id": co.branch_id, "service_id": service_id, "price_override_minor": price,
        "duration_override_minutes": minutes, "active": active, "online_visible": active}])
    assert r.status_code == 200, r.text


async def search(co, body):
    return await co.c.post("/api/v1/public/availability/search", headers=co.host, json={"branch_id": co.branch_id, **body})


async def book(co, slot, service_ids, staff_id=None, **extra):
    return await co.c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": str(uuid.uuid4())}, json={
        "branch_id": co.branch_id, "staff_id": staff_id or slot["staff_id"], "service_ids": service_ids,
        "starts_at_utc": slot["starts_at_utc"], "quote_id": slot.get("quote_id"),
        "expected_price_minor": slot["price_minor"], "customer_name": "Контракт",
        "customer_phone": "+77010000321", **extra})


def at_local(co, day, hh, mm=0):
    return dt.datetime.combine(day, dt.time(hh, mm), tzinfo=co.tz).astimezone(dt.timezone.utc)


DAY = dt.date.today() + dt.timedelta(days=6)


async def test_service_first_two_services_one_master_individual_price():
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")
        a = await co.staff("Айгерим", "10:00", "18:00")
        s1 = await co.service(5000_00, minutes=30)
        s2 = await co.service(7000_00, minutes=45)
        await offer(co, a, s2, price=9000_00, minutes=40)

        r = await search(co, {"service_ids": [s2, s1], "staff_id": a, "staff_mode": "specific",
                              "from_date": DAY.isoformat(), "to_date": DAY.isoformat()})
        assert r.status_code == 200, r.text
        slots = r.json()["slots"]
        first = slots[0]
        assert (first["duration_minutes"], first["price_minor"], first["currency"]) == (70, 14000_00, "KZT")
        assert co.local(first).time() == dt.time(10)
        assert co.local(slots[-1]).time() == dt.time(16, 45)        # сетка 15 мин: 16:45 + 70 мин = 17:55 <= 18:00

        r = await book(co, first, [s2, s1])
        assert r.status_code == 201, r.text
        assert r.json()["total_amount_minor"] == 14000_00
        items = admin("SELECT sequence, service_id, price_minor_snapshot, duration_minutes_snapshot FROM booking_items "
                      "WHERE booking_id = :b ORDER BY sequence", b=r.json()["booking_id"])
        assert [(str(i[1]), i[2], i[3]) for i in items] == [(s2, 9000_00, 40), (s1, 5000_00, 30)]

        # цена изменилась между поиском и бронью: 409, клиент увидит новую цену
        r = await search(co, {"service_ids": [s2, s1], "staff_id": a, "staff_mode": "specific",
                              "from_date": DAY.isoformat(), "to_date": DAY.isoformat()})
        stale = r.json()["slots"][0]
        await offer(co, a, s2, price=9500_00, minutes=40)
        r = await book(co, stale, [s2, s1])
        assert r.status_code == 409 and "QUOTE_CHANGED" in r.text, r.text


async def test_master_first_prices_match_search():
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")
        a = await co.staff("Азамат", "10:00", "18:00")
        b = await co.staff("Берик", "10:00", "18:00")
        s = await co.service(7000_00, minutes=45)
        await offer(co, a, s, price=9000_00, minutes=40)
        await offer(co, b, s, active=False)

        staff = (await c.get(f"/api/v1/public/staff?branch_id={co.branch_id}&service_ids={s}", headers=co.host)).json()
        assert [st["id"] for st in staff] == [a]
        svc = [x for x in (await c.get(f"/api/v1/public/staff/{a}/services?branch_id={co.branch_id}", headers=co.host)).json() if x["id"] == s][0]
        assert (svc["base_price_minor"], svc["base_duration_minutes"]) == (9000_00, 40)

        slot = (await search(co, {"service_ids": [s], "staff_id": a, "staff_mode": "specific",
                                  "from_date": DAY.isoformat(), "to_date": DAY.isoformat()})).json()["slots"][0]
        assert (slot["price_minor"], slot["duration_minutes"]) == (svc["base_price_minor"], svc["base_duration_minutes"])
        r = await book(co, slot, [s], staff_id=a)
        assert r.status_code == 201, r.text


async def test_any_master_orders_by_time_then_price():
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")
        a = await co.staff("Дорогой", "10:00", "13:00")
        b = await co.staff("Выгодный", "10:00", "13:00")
        s = await co.service(8000_00, minutes=60)
        await offer(co, a, s, price=9000_00)
        await offer(co, b, s, price=7000_00)
        slots = (await search(co, {"service_ids": [s], "staff_mode": "any",
                                   "from_date": DAY.isoformat(), "to_date": DAY.isoformat()})).json()["slots"]
        ten = [x for x in slots if co.local(x).time() == dt.time(10)]
        assert [(x["staff_id"], x["price_minor"]) for x in ten] == [(b, 7000_00), (a, 9000_00)]
        assert slots == sorted(slots, key=lambda x: (x["starts_at_utc"], x["price_minor"], x["staff_id"]))
        r = await book(co, ten[0], [s])
        assert r.status_code == 201 and r.json()["total_amount_minor"] == 7000_00, r.text


async def test_time_first_ends_with_a_real_booking():
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")
        a = await co.staff("Утро", "10:00", "12:00")
        b = await co.staff("День", "14:00", "16:00")
        short = await co.service(4000_00, minutes=30)
        long_ = await co.service(9000_00, minutes=45)
        await offer(co, a, long_, active=False)          # «Утро» делает только короткую услугу

        # шаг 1: время без услуги
        r = await c.post("/api/v1/public/availability/time-first", headers=co.host,
                         json={"branch_id": co.branch_id, "from_date": DAY.isoformat(), "to_date": DAY.isoformat()})
        assert r.status_code == 200, r.text
        times = {dt.datetime.fromisoformat(x["starts_at_utc"]).astimezone(co.tz).time(): x["available_staff_count"]
                 for x in r.json()["slots"]}
        assert times[dt.time(10)] == 1 and times[dt.time(11, 30)] == 1 and times[dt.time(14)] == 1
        assert dt.time(12) not in times and dt.time(13) not in times and dt.time(15, 45) not in times
        assert admin("SELECT count(*) FROM booking_quotes WHERE tenant_id = :t", t=co.tenant_id)[0][0] == 0

        # шаг 2: выбрали 11:30 и длинную услугу — не помещается, сервер предлагает ближайшее
        r = await search(co, {"service_ids": [long_], "staff_mode": "any", "from_date": DAY.isoformat(),
                              "to_date": DAY.isoformat(), "at_utc": at_local(co, DAY, 11, 30).isoformat()})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["exact_match"] is False and data["slots"] == []
        assert at_local(co, DAY, 14).isoformat() in data["alternatives"]

        # выбрали 14:00: quote ровно на это время, мастер «День»
        r = await search(co, {"service_ids": [long_], "staff_mode": "any", "from_date": DAY.isoformat(),
                              "to_date": DAY.isoformat(), "at_utc": at_local(co, DAY, 14).isoformat()})
        data = r.json()
        assert data["exact_match"] is True and len(data["slots"]) == 1
        slot = data["slots"][0]
        assert slot["staff_id"] == b and slot["quote_id"] and dt.datetime.fromisoformat(slot["starts_at_utc"]) == at_local(co, DAY, 14)

        # шаг 3: настоящая бронь
        r = await book(co, slot, [long_])
        assert r.status_code == 201, r.text
        assert r.json()["status"] == "confirmed" and r.json()["management_token"]

        # время занято: time-first больше не показывает 14:00 у «Дня»
        r = await c.post("/api/v1/public/availability/time-first", headers=co.host,
                         json={"branch_id": co.branch_id, "from_date": DAY.isoformat(), "to_date": DAY.isoformat()})
        times = {dt.datetime.fromisoformat(x["starts_at_utc"]).astimezone(co.tz).time() for x in r.json()["slots"]}
        assert dt.time(14) not in times


async def test_search_contract_validation():
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")
        a = await co.staff("М", "10:00", "18:00")
        s = await co.service(5000_00)
        base = {"service_ids": [s], "from_date": DAY.isoformat(), "to_date": DAY.isoformat()}
        bad = [
            {**base, "staff_mode": "specific"},
            {**base, "staff_mode": "nearest"},
            {**base, "service_ids": [s, s]},
            {**base, "to_date": (DAY - dt.timedelta(days=1)).isoformat()},
            {**base, "at_utc": f"{DAY.isoformat()}T10:00:00"},       # без пояса
        ]
        for body in bad:
            r = await search(co, body)
            assert r.status_code == 422, (body, r.text)
        r = await c.post("/api/v1/public/availability/search", headers=co.host,
                         json={**base, "branch_id": str(uuid.uuid4()), "staff_id": a, "staff_mode": "specific"})
        assert r.status_code == 404 and r.json()["detail"]["code"] == "BRANCH_NOT_FOUND"
        r = await c.post("/api/v1/public/availability/time-first", headers=co.host,
                         json={"branch_id": str(uuid.uuid4()), "from_date": DAY.isoformat(), "to_date": DAY.isoformat()})
        assert r.status_code == 404
