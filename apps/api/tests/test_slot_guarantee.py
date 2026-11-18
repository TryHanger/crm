"""M07-D2: гарантия свободного слота.

Приёмка: из 20+ конкурентных запросов на один слот проходит одна бронь, остальным показаны новые слоты.
STOP: двойная запись, тихий повтор или дубль при повторной отправке.
"""
import asyncio
import datetime as dt
import time
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.tests.company_factory import client, new_company

DAY = dt.date.today() + dt.timedelta(days=7)


def admin(sql, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(sql), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


async def one_master_company(c):
    co = await new_company(c, "Asia/Almaty")
    master = await co.staff("Единственный", "10:00", "14:00")
    svc = await co.service(6000_00, minutes=60)
    return co, master, svc


def payload(co, master, svc, start, n, **extra):
    return {"branch_id": co.branch_id, "staff_id": master, "service_ids": [svc], "starts_at_utc": start,
            "customer_name": f"Клиент {n}", "customer_phone": f"+770100{n:05d}", **extra}


async def post_booking(co, body, key=None):
    return await co.c.post("/api/v1/public/bookings", json=body,
                           headers={**co.host, "Idempotency-Key": key or str(uuid.uuid4())})


def ten_am(co):
    return dt.datetime.combine(DAY, dt.time(10), tzinfo=co.tz).astimezone(dt.timezone.utc).isoformat()


# ---------------------------------------------------------------- the database guard itself

async def test_exclusion_constraint_semantics():
    async with client() as c:
        co, master, _ = await one_master_company(c)
        other = await co.staff("Второй", "10:00", "14:00")
    t0 = dt.datetime.combine(DAY, dt.time(5), tzinfo=dt.timezone.utc)

    def occ(staff, start_h, end_h, released=False):
        admin("INSERT INTO staff_occupancies (id, tenant_id, staff_id, branch_id, starts_at_utc, ends_at_utc, "
              "occupancy_type, released_at) VALUES (gen_random_uuid(), :t, :s, :b, :a, :z, 'block', :r)",
              t=co.tenant_id, s=staff, b=co.branch_id, a=t0 + dt.timedelta(hours=start_h),
              z=t0 + dt.timedelta(hours=end_h), r=t0 if released else None)

    occ(master, 0, 1)
    occ(master, 1, 2)                 # [) — встык можно
    occ(other, 0, 1)                  # другой мастер в то же время можно
    occ(master, 0.5, 1.5, released=True)  # освобождённая занятость не мешает
    with pytest.raises(IntegrityError, match="staff_occupancy_no_overlap"):
        occ(master, 0.5, 1.5)


# ---------------------------------------------------------------- 20+ concurrent clients

async def test_25_concurrent_clients_one_slot_one_booking_others_get_new_slots():
    async with client() as c:
        co, master, svc = await one_master_company(c)
        start = ten_am(co)
        bodies = [payload(co, master, svc, start, n, expected_price_minor=6000_00) for n in range(25)]
        t = time.perf_counter()
        results = await asyncio.gather(*[post_booking(co, b) for b in bodies])
        elapsed = time.perf_counter() - t

    codes = [r.status_code for r in results]
    assert codes.count(201) == 1, codes
    losers = [r.json() for r in results if r.status_code != 201]
    assert all(r.status_code == 409 for r in results if r.status_code != 201), codes
    for body in losers:
        assert body["detail"]["code"] == "SLOT_CONFLICT"
        alts = body["detail"]["details"]["alternatives"]
        assert alts, "проигравшему нужно показать новые слоты"
        assert start not in {a["starts_at_utc"] for a in alts}
    assert admin("SELECT count(*) FROM bookings WHERE tenant_id = :t", t=co.tenant_id)[0][0] == 1
    assert admin("SELECT count(*) FROM staff_occupancies WHERE tenant_id = :t AND released_at IS NULL", t=co.tenant_id)[0][0] == 1
    print(f"\n25 concurrent bookings resolved in {elapsed:.2f}s")


async def test_20_concurrent_clients_sharing_one_quote():
    async with client() as c:
        co, master, svc = await one_master_company(c)
        r = await c.post("/api/v1/public/availability/search", headers=co.host, json={
            "branch_id": co.branch_id, "service_ids": [svc], "staff_id": master, "staff_mode": "specific",
            "from_date": DAY.isoformat(), "to_date": DAY.isoformat()})
        slot = r.json()["slots"][0]
        bodies = [payload(co, master, svc, slot["starts_at_utc"], n, quote_id=slot["quote_id"],
                          expected_price_minor=slot["price_minor"]) for n in range(20)]
        results = await asyncio.gather(*[post_booking(co, b) for b in bodies])
    codes = [r.status_code for r in results]
    assert codes.count(201) == 1 and codes.count(409) == 19, codes
    for r in results:
        if r.status_code == 409:
            assert r.json()["detail"]["code"] in ("SLOT_CONFLICT", "QUOTE_EXPIRED")
            assert r.json()["detail"]["details"]["alternatives"]
    assert admin("SELECT count(*) FROM bookings WHERE tenant_id = :t", t=co.tenant_id)[0][0] == 1


# ---------------------------------------------------------------- repeated submit (same Idempotency-Key)

async def test_double_submit_same_key_is_one_booking_not_a_conflict():
    async with client() as c:
        co, master, svc = await one_master_company(c)
        key = f"bk-{uuid.uuid4()}"
        body = payload(co, master, svc, ten_am(co), 1, expected_price_minor=6000_00)
        results = await asyncio.gather(*[post_booking(co, body, key) for _ in range(10)])
        codes = [r.status_code for r in results]
        assert codes == [201] * 10, [r.text for r in results if r.status_code != 201]
        assert len({r.json()["booking_id"] for r in results}) == 1
        again = await post_booking(co, body, key)               # повтор позже
        assert again.status_code == 201 and again.json()["booking_id"] == results[0].json()["booking_id"]
        assert again.json()["management_token"]

        other = await post_booking(co, {**body, "customer_name": "Другой"}, key)
        assert other.status_code == 201  # имя не входит в отпечаток запроса: тот же визит
        changed = await post_booking(co, {**body, "starts_at_utc": (dt.datetime.fromisoformat(body["starts_at_utc"])
                                                                      + dt.timedelta(hours=1)).isoformat()}, key)
        assert changed.status_code == 409 and changed.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert admin("SELECT count(*) FROM bookings WHERE tenant_id = :t", t=co.tenant_id)[0][0] == 1


async def test_key_of_a_lost_race_is_released_for_the_next_choice():
    async with client() as c:
        co, master, svc = await one_master_company(c)
        start = ten_am(co)
        assert (await post_booking(co, payload(co, master, svc, start, 1, expected_price_minor=6000_00))).status_code == 201
        key = f"bk-{uuid.uuid4()}"
        lost = await post_booking(co, payload(co, master, svc, start, 2, expected_price_minor=6000_00), key)
        assert lost.status_code == 409
        alt = lost.json()["detail"]["details"]["alternatives"][0]["starts_at_utc"]
        # клиент выбрал предложенное время, приложение отправило тот же ключ — запись проходит
        retry = await post_booking(co, payload(co, master, svc, alt, 2, expected_price_minor=6000_00), key)
        assert retry.status_code == 201, retry.text


async def test_same_key_in_two_companies_does_not_collide():
    key = f"bk-{uuid.uuid4()}"
    async with client() as c:
        a, ma, sa = await one_master_company(c)
        b, mb, sb = await one_master_company(c)
        ra = await post_booking(a, payload(a, ma, sa, ten_am(a), 1, expected_price_minor=6000_00), key)
        rb = await post_booking(b, payload(b, mb, sb, ten_am(b), 1, expected_price_minor=6000_00), key)
    assert ra.status_code == 201 and rb.status_code == 201, (ra.text, rb.text)
    assert ra.json()["booking_id"] != rb.json()["booking_id"]
