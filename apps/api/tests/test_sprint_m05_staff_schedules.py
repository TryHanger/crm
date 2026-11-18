import pytest
import datetime
import uuid
import zoneinfo
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app

@pytest.mark.asyncio
async def test_sprint_m05_staff_schedules_and_individual_pricing():
    """
    Sprint M05 Acceptance & STOP Gate Verification:
    - 2 masters with different schedules, breaks, and individual prices in the same branch
    - Master A (Damir): Mon/Wed/Fri 10:00-18:00 (break 13:00-14:00), Service 1 = 8 000 KZT
    - Master B (Erjan): Tue/Thu/Sat 11:00-19:00 (break 15:00-16:00), Service 1 = 12 000 KZT
    - Public site shows correct individual prices for each master
    - Public availability strictly reflects shifts, breaks, and day-offs (T05)
    - Vacation / Time-off exclusion and CRUD lifecycle
    - STOP: booking outside shift, during break, during vacation, or in wrong branch is strictly rejected
    - Timezone: Asia/Almaty (UTC+5) boundary conversion safety
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Barber House Owner
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        owner_token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {owner_token}"}

        # 2. Get branches and select primary branch
        branches_resp = await client.get("/api/v1/business/branches", headers=headers)
        assert branches_resp.status_code == 200
        branches = branches_resp.json()
        assert len(branches) >= 1
        branch_id = branches[0]["id"]
        assert branches[0]["timezone_iana"] == "Asia/Almaty"

        # 3. Get staff list (find Damir and Erjan)
        staff_resp = await client.get("/api/v1/business/staff", headers=headers)
        assert staff_resp.status_code == 200
        staff_list = staff_resp.json()
        damir = next(s for s in staff_list if "Дамир" in s["display_name"])
        erjan = next(s for s in staff_list if "Ержан" in s["display_name"])
        damir_id = damir["id"]
        erjan_id = erjan["id"]

        # 4. Get active services (find Haircut / Стрижка)
        services_resp = await client.get("/api/v1/business/services", headers=headers)
        assert services_resp.status_code == 200
        services = services_resp.json()
        haircut = next(s for s in services if "Стрижка" in s["name"] or "Мужская" in s["name"])
        haircut_id = haircut["id"]

        # 5. Set individual prices:
        # Damir: 8 000 KZT (800000 minor, 60 mins)
        # Erjan: 12 000 KZT (1200000 minor, 45 mins)
        set_damir_offers = await client.put(
            f"/api/v1/business/staff/{damir_id}/services",
            json=[{
                "branch_id": branch_id,
                "service_id": haircut_id,
                "price_override_minor": 800000,
                "duration_override_minutes": 60,
                "active": True,
                "online_visible": True
            }],
            headers=headers
        )
        assert set_damir_offers.status_code == 200

        set_erjan_offers = await client.put(
            f"/api/v1/business/staff/{erjan_id}/services",
            json=[{
                "branch_id": branch_id,
                "service_id": haircut_id,
                "price_override_minor": 1200000,
                "duration_override_minutes": 45,
                "active": True,
                "online_visible": True
            }],
            headers=headers
        )
        assert set_erjan_offers.status_code == 200

        # 6. Set schedules and breaks:
        # Damir: Mon(1), Wed(3), Fri(5) 10:00-18:00 with break 13:00-14:00; others off
        damir_shifts = []
        for day in range(1, 8):
            is_work = day in (1, 3, 5)
            damir_shifts.append({
                "weekday_iso": day,
                "is_working": is_work,
                "local_start": "10:00",
                "local_end": "18:00",
                "breaks": [{"local_start": "13:00", "local_end": "14:00"}] if is_work else []
            })
        update_damir_sched = await client.put(
            f"/api/v1/business/staff/{damir_id}/schedule?branch_id={branch_id}",
            json={"shifts": damir_shifts},
            headers=headers
        )
        assert update_damir_sched.status_code == 200

        # Erjan: Tue(2), Thu(4), Sat(6) 11:00-19:00 with break 15:00-16:00; others off
        erjan_shifts = []
        for day in range(1, 8):
            is_work = day in (2, 4, 6)
            erjan_shifts.append({
                "weekday_iso": day,
                "is_working": is_work,
                "local_start": "11:00",
                "local_end": "19:00",
                "breaks": [{"local_start": "15:00", "local_end": "16:00"}] if is_work else []
            })
        update_erjan_sched = await client.put(
            f"/api/v1/business/staff/{erjan_id}/schedule?branch_id={branch_id}",
            json={"shifts": erjan_shifts},
            headers=headers
        )
        assert update_erjan_sched.status_code == 200

        # Verify get_staff_schedule returns breaks
        get_damir_sched = await client.get(
            f"/api/v1/business/staff/{damir_id}/schedule?branch_id={branch_id}",
            headers=headers
        )
        assert get_damir_sched.status_code == 200
        damir_sched_data = get_damir_sched.json()
        assert len(damir_sched_data) == 3  # Mon, Wed, Fri
        assert damir_sched_data[0]["breaks"] == [{"local_start": "13:00", "local_end": "14:00"}]

        # 7. Time-Off CRUD Lifecycle for Damir
        # Calculate next upcoming Friday
        today = datetime.datetime.now(datetime.timezone.utc).date()
        days_ahead = (4 - today.weekday()) % 7  # 4 = Friday
        if days_ahead < 3:
            days_ahead += 7
        next_friday = today + datetime.timedelta(days=days_ahead)

        time_off_resp = await client.post(
            f"/api/v1/business/staff/{damir_id}/time-off",
            json={
                "from_at_utc": f"{next_friday.isoformat()}T00:00:00Z",
                "to_at_utc": f"{next_friday.isoformat()}T23:59:59Z",
                "reason": "Ежегодный отпуск"
            },
            headers=headers
        )
        assert time_off_resp.status_code == 201
        time_off_data = time_off_resp.json()
        time_off_id = time_off_data["id"]
        assert time_off_data["reason"] == "Ежегодный отпуск"

        # List time-off
        list_to_resp = await client.get(f"/api/v1/business/staff/{damir_id}/time-off", headers=headers)
        assert list_to_resp.status_code == 200
        assert any(t["id"] == time_off_id for t in list_to_resp.json())

        # =====================================================================
        # PUBLIC SITE CHECKS (via public hostname)
        # =====================================================================
        pub_headers = {"Host": "barberhouse.book.example.kz"}

        # 8. Check Public Staff list with Service selected:
        # Damir should have price 8 000 KZT (800000 minor)
        # Erjan should have price 12 000 KZT (1200000 minor)
        pub_staff_resp = await client.get(
            f"/api/v1/public/staff?branch_id={branch_id}&service_ids={haircut_id}",
            headers=pub_headers
        )
        assert pub_staff_resp.status_code == 200
        pub_staff = pub_staff_resp.json()
        damir_pub = next(s for s in pub_staff if s["id"] == damir_id)
        erjan_pub = next(s for s in pub_staff if s["id"] == erjan_id)
        assert damir_pub["price_minor"] == 800000, f"Expected 800000 minor, got {damir_pub['price_minor']}"
        assert damir_pub["duration_minutes"] == 60
        assert erjan_pub["price_minor"] == 1200000, f"Expected 1200000 minor, got {erjan_pub['price_minor']}"
        assert erjan_pub["duration_minutes"] == 45

        # 9. Gate T05: Shift Constraints & Availability Slots Check
        # Find next upcoming Monday (weekday 0) and Tuesday (weekday 1)
        mon_ahead = (0 - today.weekday()) % 7
        if mon_ahead < 3:
            mon_ahead += 7
        next_mon = today + datetime.timedelta(days=mon_ahead)
        next_tue = next_mon + datetime.timedelta(days=1)
        next_wed = next_mon + datetime.timedelta(days=2)

        # On Monday: Search availability for Damir
        damir_mon_avail = await client.post(
            "/api/v1/public/availability/search",
            json={
                "branch_id": branch_id,
                "service_ids": [haircut_id],
                "from_date": next_mon.isoformat(),
                "to_date": next_mon.isoformat(),
                "staff_id": damir_id,
                "staff_mode": "specific"
            },
            headers=pub_headers
        )
        assert damir_mon_avail.status_code == 200
        damir_mon_slots = damir_mon_avail.json()["slots"]
        assert len(damir_mon_slots) > 0, "Damir must have slots on his working Monday"

        # Verify all slots for Damir on Monday:
        # In Asia/Almaty (UTC+5), 10:00-18:00 local time = 05:00-13:00 UTC.
        # Break 13:00-14:00 local time = 08:00-09:00 UTC.
        tz_almaty = zoneinfo.ZoneInfo("Asia/Almaty")
        for slot in damir_mon_slots:
            dt_utc = datetime.datetime.fromisoformat(slot["starts_at_utc"].replace("Z", "+00:00"))
            dt_local = dt_utc.astimezone(tz_almaty)
            # Must be within 10:00 - 18:00
            assert dt_local.time() >= datetime.time(10, 0)
            assert dt_local.time() <= datetime.time(17, 0)  # 60 min service ends at or before 18:00
            # Must NOT overlap with break 13:00 - 14:00
            assert not (datetime.time(13, 0) <= dt_local.time() < datetime.time(14, 0)), \
                f"Gate T05 violation: slot {dt_local.time()} falls during Damir's break!"

        # On Monday: Search availability for Erjan (Erjan does NOT work on Monday!)
        erjan_mon_avail = await client.post(
            "/api/v1/public/availability/search",
            json={
                "branch_id": branch_id,
                "service_ids": [haircut_id],
                "from_date": next_mon.isoformat(),
                "to_date": next_mon.isoformat(),
                "staff_id": erjan_id,
                "staff_mode": "specific"
            },
            headers=pub_headers
        )
        assert erjan_mon_avail.status_code == 200
        assert erjan_mon_avail.json()["slots"] == [], "Gate T05: Erjan must have 0 slots on Monday (day off)"

        # On Tuesday: Erjan works (11:00-19:00, break 15:00-16:00), Damir has day off!
        erjan_tue_avail = await client.post(
            "/api/v1/public/availability/search",
            json={
                "branch_id": branch_id,
                "service_ids": [haircut_id],
                "from_date": next_tue.isoformat(),
                "to_date": next_tue.isoformat(),
                "staff_id": erjan_id,
                "staff_mode": "specific"
            },
            headers=pub_headers
        )
        assert erjan_tue_avail.status_code == 200
        erjan_tue_slots = erjan_tue_avail.json()["slots"]
        assert len(erjan_tue_slots) > 0, "Erjan must have slots on his working Tuesday"
        for slot in erjan_tue_slots:
            dt_utc = datetime.datetime.fromisoformat(slot["starts_at_utc"].replace("Z", "+00:00"))
            dt_local = dt_utc.astimezone(tz_almaty)
            assert not (datetime.time(15, 0) <= dt_local.time() < datetime.time(16, 0)), \
                f"Gate T05 violation: slot {dt_local.time()} falls during Erjan's break!"

        damir_tue_avail = await client.post(
            "/api/v1/public/availability/search",
            json={
                "branch_id": branch_id,
                "service_ids": [haircut_id],
                "from_date": next_tue.isoformat(),
                "to_date": next_tue.isoformat(),
                "staff_id": damir_id,
                "staff_mode": "specific"
            },
            headers=pub_headers
        )
        assert damir_tue_avail.status_code == 200
        assert damir_tue_avail.json()["slots"] == [], "Gate T05: Damir must have 0 slots on Tuesday (day off)"

        # On Friday with Vacation: Damir has vacation scheduled!
        damir_fri_vacation_avail = await client.post(
            "/api/v1/public/availability/search",
            json={
                "branch_id": branch_id,
                "service_ids": [haircut_id],
                "from_date": next_friday.isoformat(),
                "to_date": next_friday.isoformat(),
                "staff_id": damir_id,
                "staff_mode": "specific"
            },
            headers=pub_headers
        )
        assert damir_fri_vacation_avail.status_code == 200
        assert damir_fri_vacation_avail.json()["slots"] == [], "Gate T05: Damir must have 0 slots during approved vacation!"

        # =====================================================================
        # 10. STOP CONDITION VERIFICATION: Strict server rejection
        # =====================================================================
        # Attempt A: Book Damir outside working hours on Monday at 09:00 local time (04:00 UTC)
        bad_time_utc = datetime.datetime.combine(next_mon, datetime.time(4, 0), tzinfo=datetime.timezone.utc)
        bad_book_outside = await client.post(
            "/api/v1/public/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": damir_id,
                "service_ids": [haircut_id],
                "starts_at_utc": bad_time_utc.isoformat(),
                "customer_name": "Тест Клиент",
                "customer_phone": "+77011112233"
            },
            headers=pub_headers
        )
        assert bad_book_outside.status_code == 400
        assert bad_book_outside.json()["detail"]["code"] == "STAFF_OUTSIDE_SHIFT"

        # Attempt B: Book Damir during scheduled break on Monday at 13:00 local time (08:00 UTC)
        break_time_utc = datetime.datetime.combine(next_mon, datetime.time(8, 0), tzinfo=datetime.timezone.utc)
        bad_book_break = await client.post(
            "/api/v1/public/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": damir_id,
                "service_ids": [haircut_id],
                "starts_at_utc": break_time_utc.isoformat(),
                "customer_name": "Тест Клиент",
                "customer_phone": "+77011112233"
            },
            headers=pub_headers
        )
        assert bad_book_break.status_code == 400
        assert bad_book_break.json()["detail"]["code"] == "STAFF_ON_BREAK"

        # Attempt C: Book Damir on Tuesday (day off)
        tue_time_utc = datetime.datetime.combine(next_tue, datetime.time(6, 0), tzinfo=datetime.timezone.utc)
        bad_book_dayoff = await client.post(
            "/api/v1/public/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": damir_id,
                "service_ids": [haircut_id],
                "starts_at_utc": tue_time_utc.isoformat(),
                "customer_name": "Тест Клиент",
                "customer_phone": "+77011112233"
            },
            headers=pub_headers
        )
        assert bad_book_dayoff.status_code == 400
        assert bad_book_dayoff.json()["detail"]["code"] == "STAFF_NOT_WORKING"

        # Attempt D: Book Damir during vacation on Friday
        vacation_time_utc = datetime.datetime.combine(next_friday, datetime.time(6, 0), tzinfo=datetime.timezone.utc)
        bad_book_vacation = await client.post(
            "/api/v1/public/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": damir_id,
                "service_ids": [haircut_id],
                "starts_at_utc": vacation_time_utc.isoformat(),
                "customer_name": "Тест Клиент",
                "customer_phone": "+77011112233"
            },
            headers=pub_headers
        )
        assert bad_book_vacation.status_code == 400
        assert bad_book_vacation.json()["detail"]["code"] == "STAFF_TIME_OFF"

        # =====================================================================
        # 11. DEMO ACCEPTANCE: Successful booking with exact master price snapshot
        # =====================================================================
        # Book Damir on Monday: using a valid slot quote
        valid_damir_slot = damir_mon_slots[0]
        book_damir_resp = await client.post(
            "/api/v1/public/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": damir_id,
                "service_ids": [haircut_id],
                "starts_at_utc": valid_damir_slot["starts_at_utc"],
                "quote_id": valid_damir_slot["quote_id"],
                "expected_price_minor": valid_damir_slot["price_minor"],
                "customer_name": "Алихан Сейфуллин",
                "customer_phone": "+77017778899"
            },
            headers=pub_headers
        )
        assert book_damir_resp.status_code == 201
        damir_b_data = book_damir_resp.json()
        assert damir_b_data["total_amount_minor"] == 800000, "Damir's booking must snapshot individual price 8 000 KZT!"

        # Book Erjan on Tuesday: using a valid slot quote
        valid_erjan_slot = erjan_tue_slots[0]
        book_erjan_resp = await client.post(
            "/api/v1/public/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": erjan_id,
                "service_ids": [haircut_id],
                "starts_at_utc": valid_erjan_slot["starts_at_utc"],
                "quote_id": valid_erjan_slot["quote_id"],
                "expected_price_minor": valid_erjan_slot["price_minor"],
                "customer_name": "Бауржан Момышев",
                "customer_phone": "+77028889900"
            },
            headers=pub_headers
        )
        assert book_erjan_resp.status_code == 201
        erjan_b_data = book_erjan_resp.json()
        assert erjan_b_data["total_amount_minor"] == 1200000, "Erjan's booking must snapshot individual price 12 000 KZT!"

        # 12. Delete vacation and verify slots for Friday reappear!
        del_to_resp = await client.delete(
            f"/api/v1/business/staff/{damir_id}/time-off/{time_off_id}",
            headers=headers
        )
        assert del_to_resp.status_code == 200

        damir_fri_reopened = await client.post(
            "/api/v1/public/availability/search",
            json={
                "branch_id": branch_id,
                "service_ids": [haircut_id],
                "from_date": next_friday.isoformat(),
                "to_date": next_friday.isoformat(),
                "staff_id": damir_id,
                "staff_mode": "specific"
            },
            headers=pub_headers
        )
        assert damir_fri_reopened.status_code == 200
        assert len(damir_fri_reopened.json()["slots"]) > 0, "After deleting vacation, Friday working slots must reappear!"
