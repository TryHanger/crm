import uuid
import datetime
import zoneinfo
import random
import pytest
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app


@pytest.mark.asyncio
async def test_sprint_m08_calendar_block_and_public_slot_sync():
    """
    SPRINT M08 — Acceptance and Demo Gate T08:
    1. Administrator sets staff schedule (09:00-20:00).
    2. Customer queries public booking slots -> 13:00-14:00 is available.
    3. Administrator blocks 13:00–14:00 (local Asia/Almaty time = 08:00-09:00 UTC) for specialist.
    4. Customer queries public booking slots -> 13:00–14:00 is strictly ABSENT!
    5. Direct booking attempt on blocked slot fails with 400/409 (CALENDAR_BLOCKED/SLOT_CONFLICT).
    6. Administrator deletes calendar block -> 13:00–14:00 slot reappears in public booking!
    7. Stop-Gate check: CRM calendar returns accurate blocks and bookings.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Barber House owner
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        owner_token = login_resp.json()["access_token"]
        owner_headers = {"Authorization": f"Bearer {owner_token}"}
        public_headers = {"Host": "barberhouse.book.example.kz"}

        # 2. Get branch and staff
        branches_resp = await client.get("/api/v1/business/branches", headers=owner_headers)
        assert branches_resp.status_code == 200
        branch = branches_resp.json()[0]
        branch_id = branch["id"]
        tz = zoneinfo.ZoneInfo(branch.get("timezone_iana") or "Asia/Almaty")

        staff_resp = await client.get("/api/v1/business/staff", headers=owner_headers)
        assert staff_resp.status_code == 200
        staff_members = staff_resp.json()
        damir = next((s for s in staff_members if "Дамир" in s.get("full_name", "")), staff_members[0])
        staff_id = damir["id"]

        # Ensure active service exists
        services_resp = await client.get("/api/v1/business/services", headers=owner_headers)
        assert services_resp.status_code == 200
        services = services_resp.json()
        target_service = next((s for s in services if s.get("online_visible", True)), services[0])
        service_id = target_service["id"]

        # 3. Ensure Damir offers this service and has active shift 09:00-20:00 every day
        await client.put(
            f"/api/v1/business/staff/{staff_id}/services",
            json=[{
                "service_id": service_id,
                "price_minor": target_service.get("base_price_minor", 800000),
                "duration_minutes": 60,
                "active": True,
                "online_visible": True
            }],
            headers=owner_headers
        )

        shifts_payload = []
        for d in range(1, 8):
            shifts_payload.append({
                "weekday_iso": d,
                "is_working": True,
                "local_start": "09:00",
                "local_end": "20:00",
                "breaks": []
            })
        set_sched = await client.put(
            f"/api/v1/business/staff/{staff_id}/schedule?branch_id={branch_id}",
            json={"shifts": shifts_payload},
            headers=owner_headers
        )
        assert set_sched.status_code == 200

        # 4. Target date in the near future (e.g. 5 days ahead)
        target_date = datetime.date.today() + datetime.timedelta(days=5)

        # 13:00-14:00 in branch local time (Asia/Almaty UTC+5 -> 08:00-09:00 UTC)
        block_start_local = datetime.datetime.combine(target_date, datetime.time(13, 0), tzinfo=tz)
        block_end_local = datetime.datetime.combine(target_date, datetime.time(14, 0), tzinfo=tz)
        block_start_utc = block_start_local.astimezone(datetime.timezone.utc)
        block_end_utc = block_end_local.astimezone(datetime.timezone.utc)

        # 5. Query public slots BEFORE block
        slots_before_resp = await client.post(
            "/api/v1/public/availability/search",
            json={
                "branch_id": branch_id,
                "service_ids": [service_id],
                "from_date": target_date.isoformat(),
                "to_date": target_date.isoformat(),
                "staff_id": staff_id,
                "staff_mode": "specific"
            },
            headers=public_headers
        )
        assert slots_before_resp.status_code == 200, f"Slots query failed: {slots_before_resp.text}"
        initial_slots = slots_before_resp.json().get("slots", [])
        
        has_13_slot = any(
            datetime.datetime.fromisoformat(s["starts_at_utc"].replace("Z", "+00:00")) == block_start_utc
            for s in initial_slots
        )
        assert has_13_slot, f"Expected 13:00 local slot ({block_start_utc}) to be initially available in {initial_slots}"

        # 6. Administrator creates Calendar Block 13:00–14:00 (DEMO GATE T08)
        block_create_resp = await client.post(
            "/api/v1/business/calendar-blocks",
            json={
                "branch_id": branch_id,
                "staff_id": staff_id,
                "starts_at_utc": block_start_utc.isoformat(),
                "ends_at_utc": block_end_utc.isoformat(),
                "block_reason": "Обед / Технический перерыв (M08 Acceptance)"
            },
            headers=owner_headers
        )
        assert block_create_resp.status_code == 201, f"Failed to create block: {block_create_resp.text}"
        block_id = block_create_resp.json()["block_id"]

        # 7. Check CRM Calendar endpoint: block MUST be present in blocks list
        cal_resp = await client.get(
            f"/api/v1/business/calendar?date={target_date.isoformat()}&branch_id={branch_id}",
            headers=owner_headers
        )
        assert cal_resp.status_code == 200
        cal_data = cal_resp.json()
        found_block = next((b for b in cal_data.get("blocks", []) if b["id"] == block_id), None)
        assert found_block is not None, "Block must appear in GET /calendar response"
        assert found_block["staff_id"] == staff_id
        assert found_block["starts_at_utc"] == block_start_utc.isoformat()

        # 8. DEMO GATE T08: Query public slots AFTER block
        # The 13:00 slot must NOT be offered in public slots!
        slots_after_resp = await client.post(
            "/api/v1/public/availability/search",
            json={
                "branch_id": branch_id,
                "service_ids": [service_id],
                "from_date": target_date.isoformat(),
                "to_date": target_date.isoformat(),
                "staff_id": staff_id,
                "staff_mode": "specific"
            },
            headers=public_headers
        )
        assert slots_after_resp.status_code == 200
        after_slots = slots_after_resp.json().get("slots", [])

        # Verify no slot overlaps with 13:00-14:00
        for slot in after_slots:
            slot_start = datetime.datetime.fromisoformat(slot["starts_at_utc"].replace("Z", "+00:00"))
            slot_end = datetime.datetime.fromisoformat(slot["ends_at_utc"].replace("Z", "+00:00"))
            overlap = max(slot_start, block_start_utc) < min(slot_end, block_end_utc)
            assert not overlap, f"DEMO GATE T08 VIOLATION: Available slot {slot} overlaps with block 13:00-14:00!"

        # 9. Customer direct booking attempt on blocked time must be rejected
        booking_attempt = await client.post(
            "/api/v1/business/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": staff_id,
                "service_ids": [service_id],
                "starts_at_utc": block_start_utc.isoformat(),
                "customer_name": "Тестовый Посетитель",
                "customer_phone": "+77019998877"
            },
            headers=owner_headers
        )
        assert booking_attempt.status_code in (400, 409), (
            f"Expected conflict/blocked error, got {booking_attempt.status_code}: {booking_attempt.text}"
        )

        # 10. Administrator deletes Calendar Block
        del_resp = await client.delete(
            f"/api/v1/business/calendar-blocks/{block_id}",
            headers=owner_headers
        )
        assert del_resp.status_code == 200, f"Failed to delete block: {del_resp.text}"

        # 11. Verify block is removed from CRM Calendar
        cal_after_del = await client.get(
            f"/api/v1/business/calendar?date={target_date.isoformat()}&branch_id={branch_id}",
            headers=owner_headers
        )
        assert cal_after_del.status_code == 200
        rem_block = next((b for b in cal_after_del.json().get("blocks", []) if b["id"] == block_id), None)
        assert rem_block is None, "Block must be absent from calendar after deletion"

        # 12. Verify slot becomes available again in public booking
        slots_restored_resp = await client.post(
            "/api/v1/public/availability/search",
            json={
                "branch_id": branch_id,
                "service_ids": [service_id],
                "from_date": target_date.isoformat(),
                "to_date": target_date.isoformat(),
                "staff_id": staff_id,
                "staff_mode": "specific"
            },
            headers=public_headers
        )
        assert slots_restored_resp.status_code == 200
        restored_slots = slots_restored_resp.json().get("slots", [])
        has_restored_slot = any(
            datetime.datetime.fromisoformat(s["starts_at_utc"].replace("Z", "+00:00")) == block_start_utc
            for s in restored_slots
        )
        assert has_restored_slot, "Deleted block must restore slot availability in public booking!"


@pytest.mark.asyncio
async def test_sprint_m08_reschedule_contract_and_conflict_handling():
    """
    SPRINT M08:
    - Manual booking creation
    - Rescheduling to a new time slot
    - Old slot is released, new slot is occupied
    - Conflict check: booking on occupied slot fails
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        owner_token = login_resp.json()["access_token"]
        owner_headers = {"Authorization": f"Bearer {owner_token}"}

        branches_resp = await client.get("/api/v1/business/branches", headers=owner_headers)
        branch_id = branches_resp.json()[0]["id"]

        staff_resp = await client.get("/api/v1/business/staff", headers=owner_headers)
        staff_list = staff_resp.json()
        damir = next((s for s in staff_list if "Дамир" in s.get("full_name", "")), staff_list[0])
        staff_id = damir["id"]

        services_resp = await client.get("/api/v1/business/services", headers=owner_headers)
        service_id = services_resp.json()[0]["id"]

        target_date = datetime.date.today() + datetime.timedelta(days=random.randint(70, 95))
        while target_date.isoweekday() not in (1, 2, 3, 4, 5):
            target_date += datetime.timedelta(days=1)

        slot1_utc = datetime.datetime.combine(target_date, datetime.time(10, 0), tzinfo=datetime.timezone.utc)
        slot2_utc = datetime.datetime.combine(target_date, datetime.time(11, 0), tzinfo=datetime.timezone.utc)

        # Create manual booking at slot 1
        create_resp = await client.post(
            "/api/v1/business/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": staff_id,
                "service_ids": [service_id],
                "starts_at_utc": slot1_utc.isoformat(),
                "customer_name": "Перенос Тест",
                "customer_phone": f"+7702{random.randint(1000000, 9999999)}"
            },
            headers=owner_headers
        )
        assert create_resp.status_code == 201
        booking_id = create_resp.json()["booking_id"]

        # Reschedule to slot 2 (using POST or PATCH)
        reschedule_resp = await client.post(
            f"/api/v1/business/bookings/{booking_id}/reschedule",
            json={
                "new_starts_at_utc": slot2_utc.isoformat(),
                "new_staff_id": staff_id
            },
            headers=owner_headers
        )
        assert reschedule_resp.status_code == 200, f"Reschedule failed: {reschedule_resp.text}"

        # Verify in calendar that booking is now at slot 2
        cal_resp = await client.get(
            f"/api/v1/business/calendar?date={target_date.isoformat()}&branch_id={branch_id}",
            headers=owner_headers
        )
        assert cal_resp.status_code == 200
        cal_b = next(b for b in cal_resp.json()["bookings"] if b["id"] == booking_id)
        assert cal_b["starts_at_utc"] == slot2_utc.isoformat()

        # Slot 1 is now free: booking another client at slot 1 must succeed
        reuse_slot1 = await client.post(
            "/api/v1/business/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": staff_id,
                "service_ids": [service_id],
                "starts_at_utc": slot1_utc.isoformat(),
                "customer_name": "Новый Клиент на Слот 1",
                "customer_phone": f"+7703{random.randint(1000000, 9999999)}"
            },
            headers=owner_headers
        )
        assert reuse_slot1.status_code == 201, f"Failed to reuse released slot: {reuse_slot1.text}"

        # Trying to book again at slot 2 must fail due to conflict with rescheduled booking
        conflict_attempt = await client.post(
            "/api/v1/business/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": staff_id,
                "service_ids": [service_id],
                "starts_at_utc": slot2_utc.isoformat(),
                "customer_name": "Конфликтный Запрос",
                "customer_phone": f"+7704{random.randint(1000000, 9999999)}"
            },
            headers=owner_headers
        )
        assert conflict_attempt.status_code in (400, 409), "Overlapping booking must be rejected"
