"""M08-D2: authoritative API календаря с правами филиала.

Приёмка: администратор заблокировал 13:00–14:00, клиент не может выбрать этот промежуток.
STOP: календарь показывает время иначе, чем его считает доступным backend.
"""
import asyncio
import datetime as dt
import uuid

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.tests.company_factory import client, new_company

DAY = dt.date.today() + dt.timedelta(days=8)
UTC = dt.timezone.utc


def admin_sql(sql, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(sql), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


def local(co, hh, mm=0, day=DAY):
    return dt.datetime.combine(day, dt.time(hh, mm), tzinfo=co.tz).astimezone(UTC)


async def setup(c):
    co = await new_company(c, "Asia/Almaty")
    master = await co.staff("Мастер", "10:00", "18:00")
    svc = await co.service(5000_00, minutes=60)
    return co, master, svc


async def calendar(co, h=None, branch=None, day=DAY):
    return await co.c.get(f"/api/v1/business/calendar?date={day.isoformat()}&branch_id={branch or co.branch_id}",
                          headers=h or co.h)


async def block(co, staff, start, end, h=None, branch=None):
    return await co.c.post("/api/v1/business/calendar-blocks", headers=h or co.h, json={
        "branch_id": str(branch or co.branch_id), "staff_id": staff, "starts_at_utc": start.isoformat(),
        "ends_at_utc": end.isoformat(), "block_reason": "Обед"})


async def public_slots(co, svc, master):
    r = await co.c.post("/api/v1/public/availability/search", headers=co.host, json={
        "branch_id": co.branch_id, "service_ids": [svc], "staff_id": master, "staff_mode": "specific",
        "from_date": DAY.isoformat(), "to_date": DAY.isoformat()})
    assert r.status_code == 200, r.text
    return r.json()["slots"]


def windows(cal, staff_id, kind):
    st = next(s for s in cal["staff"] if s["id"] == staff_id)
    return [(dt.datetime.fromisoformat(w["starts_at_utc"]), dt.datetime.fromisoformat(w["ends_at_utc"])) for w in st[kind]]


async def invite_admin(co):
    email = f"admin-{uuid.uuid4().hex[:6]}@example.kz"
    r = await co.c.post("/api/v1/business/invites", headers=co.h, json={"email": email, "role": "admin"})
    assert r.status_code == 201, r.text
    r = await co.c.post("/api/v1/auth/accept-invite", json={"token": r.json()["invite_token"], "password": "Admin-Pass-1"})
    assert r.status_code == 200, r.text
    membership = admin_sql("SELECT m.id FROM tenant_memberships m JOIN identity_users u ON u.id = m.user_id "
                           "WHERE u.email_normalized = :e", e=email)[0][0]
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, membership


# ---------------------------------------------------------------- acceptance: block 13–14

async def test_block_13_14_is_unavailable_everywhere_and_calendar_matches_backend():
    async with client() as c:
        co, master, svc = await setup(c)
        r = await block(co, master, local(co, 13), local(co, 14))
        assert r.status_code == 201, r.text

        slots = await public_slots(co, svc, master)
        starts = [dt.datetime.fromisoformat(s["starts_at_utc"]) for s in slots]
        assert all(not (s < local(co, 14) and s + dt.timedelta(hours=1) > local(co, 13)) for s in starts)
        assert local(co, 12) in starts and local(co, 14) in starts and local(co, 12, 15) not in starts

        r = await c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": str(uuid.uuid4())}, json={
            "branch_id": co.branch_id, "staff_id": master, "service_ids": [svc],
            "starts_at_utc": local(co, 13).isoformat(), "expected_price_minor": 5000_00,
            "customer_name": "Клиент", "customer_phone": "+77010003001"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "CALENDAR_BLOCKED", r.text
        assert r.json()["detail"]["details"]["alternatives"]

        cal = (await calendar(co)).json()
        assert [b["reason"] for b in cal["blocks"]] == ["Обед"]
        free = windows(cal, master, "free")
        assert free == [(local(co, 10), local(co, 13)), (local(co, 14), local(co, 18))]
        assert windows(cal, master, "working") == [(local(co, 10), local(co, 18))]
        # каждый слот сайта лежит внутри свободного окна календаря
        for s in starts:
            assert any(a <= s and s + dt.timedelta(hours=1) <= b for a, b in free), s

        # снятие блокировки возвращает время
        r = await c.delete(f"/api/v1/business/calendar-blocks/{cal['blocks'][0]['id']}", headers=co.h)
        assert r.status_code == 200
        assert local(co, 13) in [dt.datetime.fromisoformat(s["starts_at_utc"]) for s in await public_slots(co, svc, master)]
        assert windows((await calendar(co)).json(), master, "free") == [(local(co, 10), local(co, 18))]


async def test_block_validation_and_overlap_answers():
    async with client() as c:
        co, master, svc = await setup(c)
        other_co, other_master, _ = await setup(c)
        bad = [
            (local(co, 14), local(co, 13), 422),              # конец раньше начала (раньше: «время занято»)
            (local(co, 13), local(co, 13), 422),
        ]
        for start, end, code in bad:
            r = await block(co, master, start, end)
            assert r.status_code == code, r.text
        r = await c.post("/api/v1/business/calendar-blocks", headers=co.h, json={
            "branch_id": co.branch_id, "staff_id": master, "starts_at_utc": f"{DAY}T13:00:00", "ends_at_utc": f"{DAY}T14:00:00"})
        assert r.status_code == 422                            # без часового пояса
        r = await block(co, other_master, local(co, 13), local(co, 14))
        assert r.status_code == 422 and r.json()["detail"]["code"] == "STAFF_NOT_IN_BRANCH"
        r = await block(co, master, local(co, 13), local(co, 14), branch=other_co.branch_id)
        assert r.status_code == 404 and r.json()["detail"]["code"] == "BRANCH_NOT_FOUND"

        assert (await block(co, master, local(co, 13), local(co, 14))).status_code == 201
        r = await block(co, master, local(co, 13, 30), local(co, 15))
        assert r.status_code == 409 and r.json()["detail"]["code"] == "SLOT_CONFLICT"


# ---------------------------------------------------------------- branch rights

async def test_calendar_branch_rights():
    async with client() as c:
        co, master, svc = await setup(c)
        other, _, _ = await setup(c)
        assert (await calendar(co, branch=other.branch_id)).status_code == 404     # раньше 200 и пустой список
        assert (await calendar(co, branch=uuid.uuid4())).status_code == 404

        second = admin_sql("INSERT INTO branches (id, tenant_id, name, city, address, timezone_iana, status, created_at) "
                           "VALUES (gen_random_uuid(), :t, 'Второй', 'Алматы', 'ул. 2', 'Asia/Almaty', 'active', now()) RETURNING id",
                           t=co.tenant_id)[0][0]
        scoped_h, membership = await invite_admin(co)
        free_h, _ = await invite_admin(co)
        admin_sql("INSERT INTO branch_role_grants (id, membership_id, branch_id) VALUES (gen_random_uuid(), :m, :b)",
                  m=membership, b=co.branch_id)

        assert (await calendar(co, h=scoped_h)).status_code == 200
        r = await calendar(co, h=scoped_h, branch=second)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "BRANCH_FORBIDDEN"
        r = await block(co, master, local(co, 13), local(co, 14), h=scoped_h, branch=second)
        assert r.status_code == 403
        r = await c.post("/api/v1/business/bookings", headers=scoped_h, json={
            "branch_id": str(second), "staff_id": master, "service_ids": [svc],
            "starts_at_utc": local(co, 11).isoformat(), "customer_name": "X", "customer_phone": "+77010003002"})
        assert r.status_code == 403
        # админ без грантов видит все филиалы (как до M08)
        assert (await calendar(co, h=free_h, branch=second)).status_code == 200
        assert (await calendar(co, branch=second)).status_code == 200                # владелец — все


# ---------------------------------------------------------------- one transactional model

async def test_manual_and_online_requests_for_one_slot_one_winner():
    async with client() as c:
        co, master, svc = await setup(c)
        start = local(co, 11).isoformat()
        manual = c.post("/api/v1/business/bookings", headers={**co.h, "Idempotency-Key": str(uuid.uuid4())}, json={
            "branch_id": co.branch_id, "staff_id": master, "service_ids": [svc], "starts_at_utc": start,
            "customer_name": "Звонок в салон", "customer_phone": "+77010004000"})
        online = [c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": str(uuid.uuid4())}, json={
            "branch_id": co.branch_id, "staff_id": master, "service_ids": [svc], "starts_at_utc": start,
            "expected_price_minor": 5000_00, "customer_name": f"Онлайн {i}", "customer_phone": f"+770100040{i:02d}"})
            for i in range(1, 11)]
        blk = block(co, master, local(co, 11), local(co, 12))
        results = await asyncio.gather(manual, blk, *online)
    codes = [r.status_code for r in results]
    assert codes.count(201) == 1, codes
    assert all(code == 409 for code in codes if code != 201), [r.text for r in results if r.status_code not in (201, 409)]
    assert admin_sql("SELECT count(*) FROM staff_occupancies WHERE tenant_id = :t AND released_at IS NULL "
                     "AND starts_at_utc < :e AND ends_at_utc > :s", t=co.tenant_id,
                     s=local(co, 11), e=local(co, 12))[0][0] == 1
    manual_409 = results[0]
    if manual_409.status_code == 409:
        assert manual_409.json()["detail"]["details"]["alternatives"]
