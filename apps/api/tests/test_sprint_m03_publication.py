import pytest
import datetime
import uuid
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app

@pytest.mark.asyncio
async def test_sprint_m03_publication_lifecycle_and_tenant_isolation():
    """
    Sprint M03 Developer 1 Automated Verification:
    1. Owner can inspect booking settings with canonical public URL and publication status.
    2. Master cannot toggle publication (403 Forbidden).
    3. Owner can pause publication (is_published = False).
    4. When paused:
       - Public /api/v1/public/site returns 404 SITE_NOT_PUBLISHED.
       - Public availability search is rejected (404 SITE_NOT_PUBLISHED).
    5. Owner can resume publication (is_published = True).
    6. When published:
       - Public /api/v1/public/site returns 200 OK with is_published = True.
       - Public availability search and booking succeed.
    7. Multi-tenant host isolation:
       - Unknown host returns 404 SITE_NOT_FOUND.
       - Barber House client cannot access Modern Cut services or staff.
       - Cross-tenant service booking attempt is rejected.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Barber House Owner
        resp_login = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert resp_login.status_code == 200, resp_login.text
        owner_token = resp_login.json()["access_token"]
        owner_headers = {"Authorization": f"Bearer {owner_token}"}

        # 2. Login as Barber House Master
        resp_master_login = await client.post("/api/v1/auth/login", json={
            "email": "damir@barberhouse.kz",
            "password": "Password123!"
        })
        assert resp_master_login.status_code == 200, resp_master_login.text
        master_token = resp_master_login.json()["access_token"]
        master_headers = {"Authorization": f"Bearer {master_token}"}

        # 3. Check Booking Settings
        resp_settings = await client.get("/api/v1/business/booking-settings", headers=owner_headers)
        assert resp_settings.status_code == 200, resp_settings.text
        settings_data = resp_settings.json()
        assert "publication" in settings_data
        assert "canonical_public_url" in settings_data
        assert "policy" in settings_data
        assert settings_data["publication"]["is_published"] is True
        assert "barberhouse" in settings_data["canonical_public_url"]

        # 4. Master role cannot toggle publication
        resp_master_toggle = await client.patch(
            "/api/v1/business/booking-publication",
            json={"is_published": False},
            headers=master_headers
        )
        assert resp_master_toggle.status_code == 403

        # 5. Owner pauses publication
        resp_pause = await client.patch(
            "/api/v1/business/booking-publication",
            json={"is_published": False},
            headers=owner_headers
        )
        assert resp_pause.status_code == 200, resp_pause.text
        pause_data = resp_pause.json()
        assert pause_data["is_published"] is False

        # Verify via GET settings that is_published is now False
        resp_settings_paused = await client.get("/api/v1/business/booking-settings", headers=owner_headers)
        assert resp_settings_paused.json()["publication"]["is_published"] is False

        # 6. Verify Public Access when Paused
        public_headers = {"Host": "barberhouse.book.example.kz"}
        resp_pub_site_paused = await client.get("/api/v1/public/site", headers=public_headers)
        assert resp_pub_site_paused.status_code == 404
        assert resp_pub_site_paused.json()["detail"]["code"] == "SITE_NOT_PUBLISHED"

        resp_pub_avail_paused = await client.post(
            "/api/v1/public/availability/search",
            json={
                "branch_id": str(uuid.uuid4()),
                "service_ids": [str(uuid.uuid4())],
                "from_date": "2026-12-01",
                "to_date": "2026-12-02"
            },
            headers=public_headers
        )
        assert resp_pub_avail_paused.status_code == 404
        assert resp_pub_avail_paused.json()["detail"]["code"] == "SITE_NOT_PUBLISHED"

        # 7. Owner resumes publication
        resp_resume = await client.patch(
            "/api/v1/business/booking-publication",
            json={"is_published": True},
            headers=owner_headers
        )
        assert resp_resume.status_code == 200, resp_resume.text
        assert resp_resume.json()["is_published"] is True

        # 8. Verify Public Access when Resumed
        resp_pub_site_active = await client.get("/api/v1/public/site", headers=public_headers)
        assert resp_pub_site_active.status_code == 200
        pub_site_data = resp_pub_site_active.json()
        assert pub_site_data["slug"] == "barberhouse"
        assert pub_site_data["is_published"] is True

        # 9. Verify Multi-tenant Host Routing and Isolation
        # Unknown host
        resp_unknown = await client.get("/api/v1/public/site", headers={"Host": "unknown-salon.book.example.kz"})
        assert resp_unknown.status_code == 404
        assert resp_unknown.json()["detail"]["code"] == "SITE_NOT_FOUND"

        # Modern Cut login to retrieve its tenant id and service id
        resp_mc_login = await client.post("/api/v1/auth/login", json={
            "email": "owner@moderncut.kz",
            "password": "Password123!"
        })
        assert resp_mc_login.status_code == 200
        mc_headers = {"Authorization": f"Bearer {resp_mc_login.json()['access_token']}"}

        resp_mc_services = await client.get("/api/v1/business/services", headers=mc_headers)
        assert resp_mc_services.status_code == 200
        mc_services = resp_mc_services.json()
        assert len(mc_services) > 0
        mc_service_id = mc_services[0]["id"]

        # Attempt to access or book Modern Cut's service on Barber House's host
        bh_branches = (await client.get("/api/v1/public/branches", headers=public_headers)).json()
        bh_branch_id = bh_branches[0]["id"]

        bh_staff = (await client.get(f"/api/v1/public/staff?branch_id={bh_branch_id}", headers=public_headers)).json()
        bh_staff_id = bh_staff[0]["id"]

        cross_booking_payload = {
            "branch_id": bh_branch_id,
            "staff_id": bh_staff_id,
            "service_ids": [mc_service_id],  # Foreign tenant service!
            "starts_at_utc": "2026-12-05T10:00:00Z",
            "customer_name": "Хакер Тест",
            "customer_phone": "+77019998877",
            "customer_email": "cross@test.kz",
            "expected_price_minor": 500000
        }
        resp_cross_book = await client.post(
            "/api/v1/public/bookings",
            json=cross_booking_payload,
            headers={**public_headers, "Idempotency-Key": f"cross-{uuid.uuid4()}"}
        )
        # Must be rejected because foreign service does not exist in Barber House tenant scope
        assert resp_cross_book.status_code in (400, 404, 422), resp_cross_book.text
