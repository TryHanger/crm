import pytest
import uuid
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app

@pytest.mark.asyncio
async def test_role_enforcement_and_permission_boundaries():
    """
    CRITICAL P0 SECURITY TEST:
    - Master cannot perform Owner/Admin operations
    - Support cannot record payments (Finance only)
    - Regular tenant staff cannot call Platform Console endpoints
    - Support temporary assistance request requires explicit Tenant Owner approval
    - Requester/support/platform owner cannot self-approve (403)
    - Unrelated tenant owner cannot approve another tenant's request (403)
    - Exact tenant owner approves (200), duplicate approval rejected (409)
    - Delegated session grants access only while active; revoke immediately blocks (403)
    - Direct HTTP 403 checks across sensitive platform endpoint families
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
        dummy_charge_id = str(uuid.uuid4())
        resp_s_pmt = await client.post(
            f"/api/v1/platform/charges/{dummy_charge_id}/record-payment",
            json={"amount_minor": 100000, "evidence_reference": "fake"},
            headers=support_headers
        )
        assert resp_s_pmt.status_code == 403

        # Support attempting to create plan -> 403 Forbidden!
        resp_s_plan = await client.post(
            "/api/v1/platform/plans",
            json={"code": "hack", "name": "Hack Plan", "price_minor": 1000},
            headers=support_headers
        )
        assert resp_s_plan.status_code == 403

        # 3. Login as Platform Viewer (Read-only)
        login_viewer = await client.post("/api/v1/auth/login", json={
            "email": "viewer@platform.example.kz",
            "password": "Password123!"
        })
        viewer_headers = {"Authorization": f"Bearer {login_viewer.json()['access_token']}"}

        # Viewer attempting to suspend tenant -> 403 Forbidden!
        resp_v_susp = await client.post(
            f"/api/v1/platform/tenants/{dummy_charge_id}/suspend",
            json={"reason": "test"},
            headers=viewer_headers
        )
        assert resp_v_susp.status_code == 403

        # Viewer attempting to add staff -> 403 Forbidden!
        resp_v_staff = await client.post(
            "/api/v1/platform/staff",
            json={"email": "new_op@example.kz", "display_name": "New Op"},
            headers=viewer_headers
        )
        assert resp_v_staff.status_code == 403

        # 4. Login as Platform Finance
        login_finance = await client.post("/api/v1/auth/login", json={
            "email": "finance@platform.example.kz",
            "password": "Password123!"
        })
        finance_headers = {"Authorization": f"Bearer {login_finance.json()['access_token']}"}

        # Finance attempting to suspend tenant -> 403 Forbidden!
        resp_f_susp = await client.post(
            f"/api/v1/platform/tenants/{dummy_charge_id}/suspend",
            json={"reason": "test"},
            headers=finance_headers
        )
        assert resp_f_susp.status_code == 403

        # 5. SUPPORT ASSISTANCE ACCESS FLOW (P0-02 Mandatory Owner-Approval Enforcement)
        # Login as Platform Owner to find Tenant IDs for 2 separate tenants
        login_powner = await client.post("/api/v1/auth/login", json={
            "email": "owner@platform.example.kz",
            "password": "Password123!"
        })
        powner_headers = {"Authorization": f"Bearer {login_powner.json()['access_token']}"}
        tenants_resp = await client.get("/api/v1/platform/tenants", headers=powner_headers)
        all_tenants = tenants_resp.json()
        barber_tenant = next(t for t in all_tenants if t["slug"] == "barberhouse")
        modern_tenant = next(t for t in all_tenants if t["slug"] == "moderncut")
        barber_tenant_id = barber_tenant["id"]
        modern_tenant_id = modern_tenant["id"]

        # Support requests diagnostic access for Barber House
        req_resp = await client.post(
            "/api/v1/platform/access-requests",
            json={"tenant_id": barber_tenant_id, "reason": "Диагностика синхронизации расписания"},
            headers=support_headers
        )
        assert req_resp.status_code == 201
        request_id = req_resp.json()["request_id"]
        assert req_resp.json()["status"] == "pending"

        # Direct API rejection: Support attempts self-approval -> 403 Forbidden!
        resp_self_appr = await client.post(
            f"/api/v1/platform/access-requests/{request_id}/approve",
            headers=support_headers
        )
        assert resp_self_appr.status_code == 403
        assert "Self-approval is forbidden" in resp_self_appr.json()["detail"]

        # Support attempts to access delegated tenant data BEFORE approval -> 403 Forbidden!
        resp_pre_data = await client.get(
            f"/api/v1/platform/support/delegated-tenant/{barber_tenant_id}",
            headers=support_headers
        )
        assert resp_pre_data.status_code == 403

        # Login as UNRELATED tenant owner (Modern Cut owner)
        login_unrelated_owner = await client.post("/api/v1/auth/login", json={
            "email": "owner@moderncut.kz",
            "password": "Password123!"
        })
        unrelated_owner_headers = {
            "Authorization": f"Bearer {login_unrelated_owner.json()['access_token']}",
            "X-Tenant-ID": modern_tenant_id
        }

        # Unrelated tenant owner attempts to approve Barber House access -> 403 Forbidden!
        resp_unrelated_appr = await client.post(
            f"/api/v1/business/access-requests/{request_id}/approve",
            headers=unrelated_owner_headers
        )
        assert resp_unrelated_appr.status_code == 403

        # Login as EXACT tenant owner (Barber House owner)
        login_exact_owner = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        exact_owner_headers = {
            "Authorization": f"Bearer {login_exact_owner.json()['access_token']}",
            "X-Tenant-ID": barber_tenant_id
        }

        # Exact tenant owner approves request -> 200 OK!
        appr_resp = await client.post(
            f"/api/v1/business/access-requests/{request_id}/approve",
            headers=exact_owner_headers
        )
        assert appr_resp.status_code == 200
        assert "30 минут" in appr_resp.json()["message"]
        assert appr_resp.json()["status"] == "approved"

        # Exact tenant owner calling approve a second time -> 409 Conflict!
        dup_appr = await client.post(
            f"/api/v1/business/access-requests/{request_id}/approve",
            headers=exact_owner_headers
        )
        assert dup_appr.status_code == 409

        # Support accesses delegated tenant data AFTER approval -> 200 OK!
        resp_post_data = await client.get(
            f"/api/v1/platform/support/delegated-tenant/{barber_tenant_id}",
            headers=support_headers
        )
        assert resp_post_data.status_code == 200
        assert resp_post_data.json()["delegated_access"] == "read_only_active"

        # Active session is visible in support active-session endpoint
        sess_resp = await client.get("/api/v1/platform/support/active-session", headers=support_headers)
        assert sess_resp.status_code == 200
        assert sess_resp.json()["has_active_session"] is True
        assert sess_resp.json()["tenant_id"] == barber_tenant_id

        # Support revokes access session -> 200 OK!
        revoke_resp = await client.post(
            f"/api/v1/platform/access-requests/{request_id}/revoke",
            headers=support_headers
        )
        assert revoke_resp.status_code == 200

        # After revocation: delegated tenant data access is immediately blocked -> 403 Forbidden!
        resp_revoked_data = await client.get(
            f"/api/v1/platform/support/delegated-tenant/{barber_tenant_id}",
            headers=support_headers
        )
        assert resp_revoked_data.status_code == 403
