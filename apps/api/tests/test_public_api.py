import pytest
import datetime
import uuid
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app

@pytest.mark.asyncio
async def test_public_site_resolution_and_policies():
    """
    Tests that:
    - Verified subdomain barberhouse.book.example.kz resolves successfully.
    - Cancellation cutoff policy is dynamic (180 minutes).
    - Unknown domain returns 404 SITE_NOT_FOUND without leaking other tenants.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Valid verified domain
        resp = await client.get("/api/v1/public/site", headers={"Host": "barberhouse.book.example.kz"})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["slug"] == "barberhouse"
        assert data["display_name"] == "Barber House"
        assert data["cancellation_cutoff_minutes"] == 180  # Resolves design contradiction dynamically!
        assert data["is_published"] is True

        # 2. Unknown domain
        resp_404 = await client.get("/api/v1/public/site", headers={"Host": "unknown-barbershop.example.kz"})
        assert resp_404.status_code == 404
        err = resp_404.json()
        assert err["detail"]["code"] == "SITE_NOT_FOUND"


@pytest.mark.asyncio
async def test_public_booking_flow_and_management():
    """
    Tests complete client booking flow:
    - Get branches, services, staff
    - Search availability
    - Create booking
    - View via management link (masked PII)
    - Self-cancellation
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        headers = {"Host": "barberhouse.book.example.kz"}

        # 1. Branches
        resp_b = await client.get("/api/v1/public/branches", headers=headers)
        assert resp_b.status_code == 200
        branches = resp_b.json()
        assert len(branches) >= 1
        branch_id = branches[0]["id"]

        # 2. Services
        resp_s = await client.get("/api/v1/public/services", headers=headers)
        assert resp_s.status_code == 200
        services = resp_s.json()
        assert len(services) >= 2
        service_id = services[0]["id"]

        # 3. Staff
        resp_st = await client.get(f"/api/v1/public/staff?branch_id={branch_id}&service_ids={service_id}", headers=headers)
        assert resp_st.status_code == 200
        staff_list = resp_st.json()
        assert len(staff_list) >= 1
        staff_id = staff_list[0]["id"]

        # 4. Search Availability
        import random
        today = datetime.datetime.now(datetime.timezone.utc).date()
        offset_day = random.randint(10, 35)
        search_req = {
            "branch_id": branch_id,
            "service_ids": [service_id],
            "from_date": (today + datetime.timedelta(days=offset_day)).isoformat(),
            "to_date": (today + datetime.timedelta(days=offset_day + 3)).isoformat(),
            "staff_id": staff_id,
            "staff_mode": "specific"
        }
        resp_av = await client.post("/api/v1/public/availability/search", json=search_req, headers=headers)
        assert resp_av.status_code == 200
        av_data = resp_av.json()
        assert "slots" in av_data
        assert len(av_data["slots"]) > 0
        first_slot = av_data["slots"][0]

        # 5. Create Booking
        booking_payload = {
            "branch_id": branch_id,
            "staff_id": staff_id,
            "service_ids": [service_id],
            "starts_at_utc": first_slot["starts_at_utc"],
            "customer_name": "Ерлан Клиент",
            "customer_phone": "+77015554433",
            "customer_email": "erlan@example.kz",
            "expected_price_minor": first_slot["price_minor"]
        }
        resp_create = await client.post(
            "/api/v1/public/bookings",
            json=booking_payload,
            headers={"Host": "barberhouse.book.example.kz", "Idempotency-Key": f"key-{uuid.uuid4()}"}
        )
        assert resp_create.status_code == 201, resp_create.text
        created_data = resp_create.json()
        assert created_data["status"] == "confirmed"
        assert created_data["public_ref"].startswith("BH-")
        mgmt_token = created_data["management_token"]

        # 6. View via Management Link
        resp_mgmt = await client.get(f"/api/v1/public/manage/{mgmt_token}")
        assert resp_mgmt.status_code == 200
        mgmt_data = resp_mgmt.json()
        assert mgmt_data["public_ref"] == created_data["public_ref"]
        # Verify customer phone is masked for security
        assert "***" in mgmt_data["customer_phone_masked"]
        assert mgmt_data["can_cancel"] is True

        # 7. Self-cancellation
        resp_cancel = await client.post(
            f"/api/v1/public/manage/{mgmt_token}/cancel",
            json={"reason": "Планы изменились"}
        )
        assert resp_cancel.status_code == 200
        assert resp_cancel.json()["status"] == "cancelled"
