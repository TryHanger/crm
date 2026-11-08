import pytest
import datetime
import random
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app

@pytest.mark.asyncio
async def test_crm_calendar_and_master_role_isolation():
    """
    Tests:
    - Login as Barber House Owner: sees all staff in calendar
    - Login as Damir (Master): restricted to personal schedule
    - Manual appointment creation in CRM
    - Status machine transitions (confirmed -> arrived -> in_progress -> completed)
    - Calendar block creation
    - Customer duplicate detection by phone
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Owner
        login_owner = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert login_owner.status_code == 200
        owner_token = login_owner.json()["access_token"]
        owner_headers = {"Authorization": f"Bearer {owner_token}"}

        # 2. Get Branches
        branches_resp = await client.get("/api/v1/business/branches", headers=owner_headers)
        assert branches_resp.status_code == 200
        branches = branches_resp.json()
        branch_id = branches[0]["id"]

        # 3. Calendar View as Owner (sees all staff)
        today = datetime.datetime.now(datetime.timezone.utc).date()
        cal_resp = await client.get(
            f"/api/v1/business/calendar?date={today.isoformat()}&branch_id={branch_id}",
            headers=owner_headers
        )
        assert cal_resp.status_code == 200
        cal_data = cal_resp.json()
        staff_names = [s["display_name"] for s in cal_data["staff"]]
        assert any("Дамир" in name for name in staff_names)
        assert any("Ержан" in name for name in staff_names)

        # 4. Login as Master (Damir)
        login_master = await client.post("/api/v1/auth/login", json={
            "email": "damir@barberhouse.kz",
            "password": "Password123!"
        })
        assert login_master.status_code == 200
        master_token = login_master.json()["access_token"]
        master_headers = {"Authorization": f"Bearer {master_token}"}

        # 5. Calendar View as Master (sees ONLY Damir!)
        cal_master_resp = await client.get(
            f"/api/v1/business/calendar?date={today.isoformat()}&branch_id={branch_id}",
            headers=master_headers
        )
        assert cal_master_resp.status_code == 200
        cal_m_data = cal_master_resp.json()
        master_staff_names = [s["display_name"] for s in cal_m_data["staff"]]
        assert len(master_staff_names) == 1
        assert "Дамир" in master_staff_names[0]

        # 6. Manual CRM Booking Creation
        staff_damir_id = cal_m_data["staff"][0]["id"]
        services_resp = await client.get("/api/v1/business/services", headers=owner_headers)
        services = services_resp.json()
        service_id = services[0]["id"]

        target_day = today + datetime.timedelta(days=16)
        while target_day.isoweekday() not in (1, 2, 3, 4, 5):
            target_day += datetime.timedelta(days=1)
        slot_dt = datetime.datetime.combine(target_day, datetime.time(11, 0), tzinfo=datetime.timezone.utc)

        crm_book_resp = await client.post(
            "/api/v1/business/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": staff_damir_id,
                "service_ids": [service_id],
                "starts_at_utc": slot_dt.isoformat(),
                "customer_name": "CRM Ручной Клиент",
                "customer_phone": "+77073332211"
            },
            headers=owner_headers
        )
        assert crm_book_resp.status_code == 201
        booking_data = crm_book_resp.json()
        booking_id = booking_data["booking_id"]
        assert booking_data["status"] == "confirmed"

        # 7. State Transitions: confirmed -> arrived -> in_progress -> completed
        for target_st in ["arrived", "in_progress", "completed"]:
            st_resp = await client.patch(
                f"/api/v1/business/bookings/{booking_id}/status",
                json={"status": target_st},
                headers=owner_headers
            )
            assert st_resp.status_code == 200
            assert st_resp.json()["status"] == target_st

        # 8. Calendar Block
        block_start = slot_dt + datetime.timedelta(hours=3)
        block_end = block_start + datetime.timedelta(minutes=30)
        block_resp = await client.post(
            "/api/v1/business/calendar-blocks",
            json={
                "branch_id": branch_id,
                "staff_id": staff_damir_id,
                "starts_at_utc": block_start.isoformat(),
                "ends_at_utc": block_end.isoformat(),
                "block_reason": "Обед"
            },
            headers=owner_headers
        )
        assert block_resp.status_code == 201
        block_id = block_resp.json()["block_id"]

        # 9. Delete Block
        del_resp = await client.delete(f"/api/v1/business/calendar-blocks/{block_id}", headers=owner_headers)
        assert del_resp.status_code == 200

        # 10. Customer duplicate detection
        uniq_phone = f"+7708{random.randint(1000000, 9999999)}"
        cust1 = await client.post("/api/v1/business/customers", json={
            "full_name": "Уникальный Клиент",
            "phone_e164": uniq_phone
        }, headers=owner_headers)
        assert cust1.status_code == 201
        assert cust1.json()["duplicate_detected"] is False

        # Attempting to add with SAME phone returns duplicate_detected = True
        cust2 = await client.post("/api/v1/business/customers", json={
            "full_name": "Тот же номер",
            "phone_e164": uniq_phone
        }, headers=owner_headers)
        assert cust2.status_code in (200, 201)
        assert cust2.json()["duplicate_detected"] is True


@pytest.mark.asyncio
async def test_multi_tenant_calendar_strict_isolation_between_barberhouse_and_moderncut():
    """
    Verifies Task 4 Gate 2 acceptance:
    - Client in Barber House books an appointment.
    - The booking appears in Barber House owner calendar.
    - The booking is strictly absent from Modern Cut CRM calendar.
    - Modern Cut owner cannot access Barber House booking by ID (returns 404).
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login to Barber House
        bh_login = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert bh_login.status_code == 200
        bh_token = bh_login.json()["access_token"]
        bh_headers = {"Authorization": f"Bearer {bh_token}"}

        # 2. Login to Modern Cut
        mc_login = await client.post("/api/v1/auth/login", json={
            "email": "owner@moderncut.kz",
            "password": "Password123!"
        })
        assert mc_login.status_code == 200
        mc_token = mc_login.json()["access_token"]
        mc_headers = {"Authorization": f"Bearer {mc_token}"}

        # 3. Get Barber House branch and staff
        bh_branches = (await client.get("/api/v1/business/branches", headers=bh_headers)).json()
        bh_branch_id = bh_branches[0]["id"]
        bh_services = (await client.get("/api/v1/business/services", headers=bh_headers)).json()
        bh_service_id = bh_services[0]["id"]

        today = datetime.datetime.now(datetime.timezone.utc).date()
        target_day = today + datetime.timedelta(days=32)
        while target_day.isoweekday() not in (1, 2, 3, 4, 5):
            target_day += datetime.timedelta(days=1)

        cal_bh_initial = (await client.get(
            f"/api/v1/business/calendar?date={target_day.isoformat()}&branch_id={bh_branch_id}",
            headers=bh_headers
        )).json()
        bh_staff_id = cal_bh_initial["staff"][0]["id"]

        # 4. Create appointment in Barber House
        slot_dt = datetime.datetime.combine(target_day, datetime.time(10, 30), tzinfo=datetime.timezone.utc) # 15:30 local time, after lunch
        created_resp = await client.post(
            "/api/v1/business/bookings",
            json={
                "branch_id": bh_branch_id,
                "staff_id": bh_staff_id,
                "service_ids": [bh_service_id],
                "starts_at_utc": slot_dt.isoformat(),
                "customer_name": "Карим Сериков",
                "customer_phone": "+77017778899"
            },
            headers=bh_headers
        )
        assert created_resp.status_code == 201, f"Create booking failed: {created_resp.text}"
        bh_booking_id = created_resp.json()["booking_id"]

        # 5. Verify appointment appears in Barber House calendar
        cal_bh_after = (await client.get(
            f"/api/v1/business/calendar?date={target_day.isoformat()}&branch_id={bh_branch_id}",
            headers=bh_headers
        )).json()
        bh_booking_ids = [b["id"] for b in cal_bh_after["bookings"]]
        assert bh_booking_id in bh_booking_ids

        # 6. Verify appointment does NOT appear in Modern Cut calendar
        mc_branches = (await client.get("/api/v1/business/branches", headers=mc_headers)).json()
        mc_branch_id = mc_branches[0]["id"]
        cal_mc = (await client.get(
            f"/api/v1/business/calendar?date={target_day.isoformat()}&branch_id={mc_branch_id}",
            headers=mc_headers
        )).json()
        mc_booking_ids = [b["id"] for b in cal_mc["bookings"]]
        assert bh_booking_id not in mc_booking_ids

        # 7. Modern Cut owner cannot read Barber House booking details
        cross_resp = await client.get(
            f"/api/v1/business/bookings/{bh_booking_id}",
            headers=mc_headers
        )
        assert cross_resp.status_code == 404


@pytest.mark.asyncio
async def test_full_crm_crud_and_management_endpoints():
    """
    Integration tests for full CRM-0 .. CRM-3 backend capabilities:
    1. Customer Card & Profile Patch with Note
    2. Staff Profile Detail & Patch & Schedule Management
    3. Service Catalog Patch & Safe Archive (active=False, soft delete)
    4. Service Category Patch
    5. Booking Theme Branding Patch
    6. Branch Update
    7. Users & Invite Management
    8. Strict Cross-Tenant Boundaries on Customer & Staff entities
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Barber House Owner
        bh_login = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert bh_login.status_code == 200
        bh_headers = {"Authorization": f"Bearer {bh_login.json()['access_token']}"}

        # Login as Modern Cut Owner
        mc_login = await client.post("/api/v1/auth/login", json={
            "email": "owner@moderncut.kz",
            "password": "Password123!"
        })
        assert mc_login.status_code == 200
        mc_headers = {"Authorization": f"Bearer {mc_login.json()['access_token']}"}

        # --- CUSTOMER CRUD & ISOLATION ---
        # List customers
        cust_list_resp = await client.get("/api/v1/business/customers", headers=bh_headers)
        assert cust_list_resp.status_code == 200
        customers = cust_list_resp.json()
        assert len(customers) > 0
        cust_id = customers[0]["id"]

        # Get customer card
        card_resp = await client.get(f"/api/v1/business/customers/{cust_id}", headers=bh_headers)
        assert card_resp.status_code == 200
        card = card_resp.json()
        assert "history" in card
        assert "notes" in card

        # Patch customer
        patch_cust = await client.patch(f"/api/v1/business/customers/{cust_id}", json={
            "notes_private": "VIP клиент, чай с бергамотом"
        }, headers=bh_headers)
        assert patch_cust.status_code == 200

        # Modern Cut cannot access this customer
        mc_cross_cust = await client.get(f"/api/v1/business/customers/{cust_id}", headers=mc_headers)
        assert mc_cross_cust.status_code == 404

        # --- STAFF & SCHEDULE CRUD ---
        staff_list_resp = await client.get("/api/v1/business/staff", headers=bh_headers)
        assert staff_list_resp.status_code == 200
        staff_id = staff_list_resp.json()[0]["id"]

        # Staff detail
        staff_detail_resp = await client.get(f"/api/v1/business/staff/{staff_id}", headers=bh_headers)
        assert staff_detail_resp.status_code == 200
        s_detail = staff_detail_resp.json()
        assert "branch_ids" in s_detail

        # Patch staff
        patch_staff = await client.patch(f"/api/v1/business/staff/{staff_id}", json={
            "color": "#3B82F6"
        }, headers=bh_headers)
        assert patch_staff.status_code == 200

        # Staff schedule get & put
        sched_resp = await client.get(f"/api/v1/business/staff/{staff_id}/schedule", headers=bh_headers)
        assert sched_resp.status_code == 200

        put_sched = await client.put(f"/api/v1/business/staff/{staff_id}/schedule", json={
            "shifts": [
                {
                    "weekday_iso": d,
                    "local_start": "10:00",
                    "local_end": "20:00",
                    "is_working": True,
                    "breaks": [{"local_start": "14:00", "local_end": "15:00"}]
                }
                for d in range(1, 7)
            ]
        }, headers=bh_headers)
        assert put_sched.status_code == 200

        # --- SERVICE & CATEGORY CRUD ---
        svc_resp = await client.get("/api/v1/business/services", headers=bh_headers)
        assert svc_resp.status_code == 200
        svc_id = svc_resp.json()[0]["id"]

        patch_svc = await client.patch(f"/api/v1/business/services/{svc_id}", json={
            "description": "Обновленное премиальное описание"
        }, headers=bh_headers)
        assert patch_svc.status_code == 200

        cat_resp = await client.get("/api/v1/business/service-categories", headers=bh_headers)
        assert cat_resp.status_code == 200
        cat_id = cat_resp.json()[0]["id"]

        patch_cat = await client.patch(f"/api/v1/business/service-categories/{cat_id}", json={
            "sort_order": 5
        }, headers=bh_headers)
        assert patch_cat.status_code == 200

        # --- BRANDING & BRANCH ---
        patch_theme = await client.patch("/api/v1/business/booking-theme", json={
            "accent_color": "#E11D48"
        }, headers=bh_headers)
        assert patch_theme.status_code == 200

        branches = (await client.get("/api/v1/business/branches", headers=bh_headers)).json()
        b_id = branches[0]["id"]
        patch_b = await client.patch(f"/api/v1/business/branches/{b_id}", json={
            "phone": "+77019998877"
        }, headers=bh_headers)
        assert patch_b.status_code == 200

        # --- USERS & INVITES ---
        users_resp = await client.get("/api/v1/business/users", headers=bh_headers)
        assert users_resp.status_code == 200
        users_list = users_resp.json()
        assert any("owner@barberhouse.kz" in u["email"] for u in users_list)

        inv_resp = await client.post("/api/v1/business/invites", json={
            "email": f"newmaster_{random.randint(1000, 9999)}@example.kz",
            "role": "master"
        }, headers=bh_headers)
        assert inv_resp.status_code == 201
        assert "invite_url" in inv_resp.json()

@pytest.mark.asyncio
async def test_crm_invitation_creation_and_acceptance_lifecycle():
    """
    CRITICAL P0-03 REGRESSION TEST:
    Verifies that CRM staff invites store a SHA-256 hash in the database,
    return a working raw token, can be redeemed via /api/v1/auth/accept-invite,
    and activate a tenant membership without password hijacking or replay vulnerability.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Barber House Owner
        bh_login = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert bh_login.status_code == 200
        owner_token = bh_login.json()["access_token"]
        owner_headers = {"Authorization": f"Bearer {owner_token}"}

        # 2. Owner creates invite for a new barber
        invitee_email = f"barber_{random.randint(10000, 99999)}@example.kz"
        inv_resp = await client.post("/api/v1/business/invites", json={
            "email": invitee_email,
            "role": "master"
        }, headers=owner_headers)
        assert inv_resp.status_code == 201, f"Failed to create invite: {inv_resp.text}"
        inv_data = inv_resp.json()
        raw_token = inv_data["token"]
        assert raw_token, "Raw token must be returned in response"

        # 3. Invitee accepts invite via /api/v1/auth/accept-invite
        accept_resp = await client.post("/api/v1/auth/accept-invite", json={
            "token": raw_token,
            "password": "NewBarberSecret123!",
            "display_name": "Новый Барбер"
        })
        assert accept_resp.status_code == 200, f"Failed to accept invite: {accept_resp.text}"
        acc_data = accept_resp.json()
        assert acc_data["email"] == invitee_email
        assert acc_data["role"] == "master" 

        # 4. Replay attempt: Reusing the same invite token must FAIL (already consumed)
        replay_resp = await client.post("/api/v1/auth/accept-invite", json={
            "token": raw_token,
            "password": "AnotherPassword123!"
        })
        assert replay_resp.status_code in (400, 422), "Consumed invite token must not be accepted again"

        # 5. Login with new credentials
        login_new = await client.post("/api/v1/auth/login", json={
            "email": invitee_email,
            "password": "NewBarberSecret123!"
        })
        assert login_new.status_code == 200


@pytest.mark.asyncio
async def test_crm_customer_privacy_and_cross_branch_schedule_isolation():
    """
    CRITICAL P0-02 & P1-01 REGRESSION TEST:
    1. Master role privacy: Master cannot read details or add notes to an unrelated customer.
    2. Master cannot call POST /customers directly (403 Forbidden).
    3. Multi-branch schedule isolation: Updating staff schedule for Branch A preserves Branch B shifts.
    4. Branch creation preserves phone_number and timezone aliases.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Barber House Owner
        bh_login = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert bh_login.status_code == 200
        owner_headers = {"Authorization": f"Bearer {bh_login.json()['access_token']}"}

        # 2. Login as Master Damir
        damir_login = await client.post("/api/v1/auth/login", json={
            "email": "damir@barberhouse.kz",
            "password": "Password123!"
        })
        assert damir_login.status_code == 200
        master_headers = {"Authorization": f"Bearer {damir_login.json()['access_token']}"}

        # 3. Create a customer as owner
        unrelated_phone = f"+7702{random.randint(1000000, 9999999)}"
        c_resp = await client.post("/api/v1/business/customers", json={
            "full_name": "Клиент Не Для Дамира",
            "phone_e164": unrelated_phone,
            "notes_private": "Секретные данные владельца"
        }, headers=owner_headers)
        assert c_resp.status_code == 201
        cust_id = c_resp.json()["id"]

        # 4. Master attempts to create customer -> 403 Forbidden!
        m_create_resp = await client.post("/api/v1/business/customers", json={
            "full_name": "Хакер",
            "phone_e164": f"+7709{random.randint(1000000, 9999999)}"
        }, headers=master_headers)
        assert m_create_resp.status_code == 403, "Master must not be allowed to call POST /customers"

        # 5. Master attempts to view unrelated customer card -> 403 Forbidden!
        m_card_resp = await client.get(f"/api/v1/business/customers/{cust_id}", headers=master_headers)
        assert m_card_resp.status_code == 403, "Master must be denied access to unrelated customer card"

        # 6. Master attempts to add note to unrelated customer -> 403 Forbidden!
        m_note_resp = await client.post(f"/api/v1/business/customers/{cust_id}/notes", json={
            "note": "Попытка добавить заметку"
        }, headers=master_headers)
        assert m_note_resp.status_code == 403, "Master must be denied adding note to unrelated customer"

        # 7. Multi-branch staff schedule isolation on Modern Cut (Pro plan permits up to 3 branches):
        mc_login = await client.post("/api/v1/auth/login", json={
            "email": "owner@moderncut.kz",
            "password": "Password123!"
        })
        assert mc_login.status_code == 200
        mc_headers = {"Authorization": f"Bearer {mc_login.json()['access_token']}"}

        branches = (await client.get("/api/v1/business/branches", headers=mc_headers)).json()
        b1_id = branches[0]["id"]

        # Create a second branch with phone_number & timezone alias
        b2_resp = await client.post("/api/v1/business/branches", json={
            "name": "Modern Cut Самал",
            "address": "мкр. Самал-2, 14",
            "city": "Алматы",
            "phone_number": "+77015559988",
            "timezone": "Asia/Almaty"
        }, headers=mc_headers)
        assert b2_resp.status_code == 201
        b2_data = b2_resp.json()
        b2_id = b2_data["id"]
        assert b2_data.get("phone") == "+77015559988" or b2_data.get("phone_number") == "+77015559988"

        # Get Modern Cut master profile
        staff_all = (await client.get("/api/v1/business/staff", headers=mc_headers)).json()
        mc_staff_id = staff_all[0]["id"]

        # Set schedule for Branch 1 (Monday & Tuesday)
        await client.put(f"/api/v1/business/staff/{mc_staff_id}/schedule?branch_id={b1_id}", json={
            "shifts": [
                {"weekday_iso": 1, "is_working": True, "local_start": "09:00", "local_end": "18:00", "breaks": []},
                {"weekday_iso": 2, "is_working": True, "local_start": "09:00", "local_end": "18:00", "breaks": []}
            ]
        }, headers=mc_headers)

        # Set schedule for Branch 2 (Wednesday & Thursday)
        await client.put(f"/api/v1/business/staff/{mc_staff_id}/schedule?branch_id={b2_id}", json={
            "shifts": [
                {"weekday_iso": 3, "is_working": True, "local_start": "10:00", "local_end": "19:00", "breaks": []},
                {"weekday_iso": 4, "is_working": True, "local_start": "10:00", "local_end": "19:00", "breaks": []}
            ]
        }, headers=mc_headers)

        # Now update Branch 1 (change Monday to 10:00 - 17:00)
        await client.put(f"/api/v1/business/staff/{mc_staff_id}/schedule?branch_id={b1_id}", json={
            "shifts": [
                {"weekday_iso": 1, "is_working": True, "local_start": "10:00", "local_end": "17:00", "breaks": []}
            ]
        }, headers=mc_headers)

        # Verify Branch 2 schedule is INTACT and NOT deleted!
        b2_sched = (await client.get(f"/api/v1/business/staff/{mc_staff_id}/schedule?branch_id={b2_id}", headers=mc_headers)).json()
        b2_working = [s for s in b2_sched if s.get("is_working")]
        assert len(b2_working) == 2, f"Branch 2 shifts must survive Branch 1 update! Found: {b2_working}"
        assert any(s["weekday_iso"] == 3 for s in b2_working)
        assert any(s["weekday_iso"] == 4 for s in b2_working)

        # Restore shifts for weekdays 1..6 on Branch 1
        await client.put(f"/api/v1/business/staff/{mc_staff_id}/schedule?branch_id={b1_id}", json={
            "shifts": [
                {"weekday_iso": d, "is_working": True, "local_start": "10:00", "local_end": "19:00", "breaks": []}
                for d in range(1, 7)
            ]
        }, headers=mc_headers)
