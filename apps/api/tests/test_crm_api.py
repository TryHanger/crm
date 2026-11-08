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
