import pytest
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app

@pytest.mark.asyncio
async def test_role_enforcement_and_permission_boundaries():
    """
    CRITICAL P0 SECURITY TEST:
    - Master cannot perform Owner/Admin operations
    - Support cannot record payments (Finance only)
    - Regular tenant staff cannot call Platform Console endpoints
    - Support temporary assistance request requires explicit Owner approval
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Master
        login_master = await client.post("/api/v1/auth/login", json={
            "email": "damir@barberhouse.kz",
            "password": "Password123!"
        })
        master_token = login_master.json()["access_token"]
        master_headers = {"Authorization": f"Bearer {master_token}"}

        # Master attempting to create branch -> 403 Forbidden!
        resp_m_branch = await client.post(
            "/api/v1/business/branches",
            json={"name": "Неавторизованный филиал", "address": "ул. Тест"},
            headers=master_headers
        )
        assert resp_m_branch.status_code == 403

        # Master attempting to access Platform Console -> 403 Forbidden!
        resp_m_platform = await client.get("/api/v1/platform/overview", headers=master_headers)
        assert resp_m_platform.status_code == 403

        # 2. Login as Platform Support
        login_support = await client.post("/api/v1/auth/login", json={
            "email": "support@platform.example.kz",
            "password": "Password123!"
        })
        support_token = login_support.json()["access_token"]
        support_headers = {"Authorization": f"Bearer {support_token}"}

        # Support attempting to record payment -> 403 Forbidden (Finance/Owner only)!
        import uuid
        dummy_charge_id = str(uuid.uuid4())
        resp_s_pmt = await client.post(
            f"/api/v1/platform/charges/{dummy_charge_id}/record-payment",
            json={"amount_minor": 100000, "evidence_reference": "fake"},
            headers=support_headers
        )
        assert resp_s_pmt.status_code == 403

        # 3. Support Assistance Access Flow (Requires Owner Consent)
        # Login as Platform Owner to find Tenant ID
        login_powner = await client.post("/api/v1/auth/login", json={
            "email": "owner@platform.example.kz",
            "password": "Password123!"
        })
        powner_headers = {"Authorization": f"Bearer {login_powner.json()['access_token']}"}
        tenants_resp = await client.get("/api/v1/platform/tenants?query=barberhouse", headers=powner_headers)
        tenant_id = tenants_resp.json()[0]["id"]

        # Support requests diagnostic access
        req_resp = await client.post(
            "/api/v1/platform/access-requests",
            json={"tenant_id": tenant_id, "reason": "Диагностика синхронизации расписания"},
            headers=support_headers
        )
        assert req_resp.status_code == 201
        request_id = req_resp.json()["request_id"]
        assert req_resp.json()["status"] == "pending"

        # Tenant Owner approves request
        login_owner = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        owner_headers = {"Authorization": f"Bearer {login_owner.json()['access_token']}"}

        appr_resp = await client.post(
            f"/api/v1/business/access-requests/{request_id}/approve",
            headers=owner_headers
        )
        assert appr_resp.status_code == 200
        assert "30 минут" in appr_resp.json()["message"]
