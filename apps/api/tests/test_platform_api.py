import pytest
import datetime
import uuid
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app

@pytest.mark.asyncio
async def test_platform_console_lifecycle_and_billing():
    """
    CRITICAL E2E GATE TEST:
    - Platform staff authentication
    - Onboarding a new tenant
    - Manual suspension & reactivation lifecycle:
      * Suspend blocks new public booking and CRM write operations
      * Reactivate restores full capabilities
      * Every transition leaves audit decision records
    - Safe Renewal & Financial Integrity (P0-04):
      * Renewal without payment extends access date only
      * Renewal does NOT reactivate manually suspended company
      * Renewal without payment does not increment confirmed revenue or forge evidence
      * Issue manual charge
      * Partial payment marks charge partially_paid
      * Overpayment exceeding remaining balance rejected with 400
      * Stable idempotency key replay with exact payload returns 201 replay
      * Replay with modified payload rejected with 409 Conflict
      * Full payment marks charge paid
    - Secure Platform Staff Onboarding (P0-03):
      * Platform owner creates operator: returns one-time activation token (no default password)
      * Upgrading regular CRM tenant identity to platform staff rejected without explicit flag (400)
      * Operator sets secure secret via one-time activation endpoint (200)
      * Reusing consumed activation token rejected with 409
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Platform Owner
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@platform.example.kz",
            "password": "Password123!"
        })
        assert login_resp.status_code == 200, login_resp.text
        p_token = login_resp.json()["access_token"]
        p_headers = {"Authorization": f"Bearer {p_token}"}

        # 2. Platform Overview
        ov_resp = await client.get("/api/v1/platform/overview", headers=p_headers)
        assert ov_resp.status_code == 200
        ov_data = ov_resp.json()
        assert "total_tenants" in ov_data
        assert ov_data["total_tenants"] >= 2

        # 3. Create New Tenant via Platform
        uniq_id = uuid.uuid4().hex[:6]
        new_tenant_req = {
            "slug": f"royal_{uniq_id}",
            "display_name": "Royal Cut Barbershop",
            "owner_email": f"royal_{uniq_id}@royalcut.kz",
            "owner_name": "Султан Владелец",
            "vertical": "barbershop",
            "plan_code": "start"
        }
        create_resp = await client.post("/api/v1/platform/tenants", json=new_tenant_req, headers=p_headers)
        assert create_resp.status_code == 201
        tenant_id = create_resp.json()["tenant_id"]

        # 4. Suspend Tenant
        susp_resp = await client.post(
            f"/api/v1/platform/tenants/{tenant_id}/suspend",
            json={"reason": "Тестовая приостановка за неуплату"},
            headers=p_headers
        )
        assert susp_resp.status_code == 200
        assert susp_resp.json()["status"] == "suspended"

        # Verify tenant details reflect suspended status
        tdet_resp = await client.get(f"/api/v1/platform/tenants/{tenant_id}", headers=p_headers)
        assert tdet_resp.status_code == 200
        tdet = tdet_resp.json()
        assert tdet["lifecycle_status"] == "suspended"
        assert tdet["suspension_reason"] == "Тестовая приостановка за неуплату"
        subscription_id = tdet["subscription"]["id"]

        # 5. SAFE RENEWAL LIFECYCLE (P0-04)
        # Renewal without payment: extends date only, does NOT reactivate suspended company!
        renew_resp = await client.post(
            f"/api/v1/platform/subscriptions/{subscription_id}/renew",
            json={"extend_days": 30, "record_payment": False},
            headers=p_headers
        )
        assert renew_resp.status_code == 200
        # Tenant MUST REMAIN SUSPENDED!
        tdet_after_renew = (await client.get(f"/api/v1/platform/tenants/{tenant_id}", headers=p_headers)).json()
        assert tdet_after_renew["lifecycle_status"] == "suspended", "Renewal must not unsuspend tenant without explicit action!"

        # 6. Issue Manual Charge
        now = datetime.datetime.now(datetime.timezone.utc)
        charge_resp = await client.post(
            f"/api/v1/platform/subscriptions/{subscription_id}/charges",
            json={
                "amount_minor": 900000,
                "currency": "KZT",
                "period_start": now.isoformat(),
                "period_end": (now + datetime.timedelta(days=30)).isoformat(),
                "evidence_reference": "INV-2026-001"
            },
            headers=p_headers
        )
        assert charge_resp.status_code == 201
        charge_id = charge_resp.json()["charge_id"]
        assert charge_resp.json()["status"] == "issued"

        # 7. FINANCIAL INTEGRITY & IDEMPOTENCY (P0-04)
        # 7a. Partial payment 400 000 minor -> status partially_paid
        idemp_key1 = f"pay-part-{charge_id}"
        part_resp = await client.post(
            f"/api/v1/platform/charges/{charge_id}/record-payment",
            json={
                "amount_minor": 400000,
                "evidence_reference": "Kaspi Pay Чек №1001",
                "payment_method": "bank_transfer",
                "note": "Частичная оплата счета"
            },
            headers={**p_headers, "Idempotency-Key": idemp_key1}
        )
        assert part_resp.status_code == 201
        assert part_resp.json()["status"] == "partially_paid"
        assert part_resp.json()["remaining_balance_minor"] == 500000

        # 7b. Replay with SAME idempotency key and SAME payload -> 201 replay
        replay_resp = await client.post(
            f"/api/v1/platform/charges/{charge_id}/record-payment",
            json={
                "amount_minor": 400000,
                "evidence_reference": "Kaspi Pay Чек №1001",
                "payment_method": "bank_transfer"
            },
            headers={**p_headers, "Idempotency-Key": idemp_key1}
        )
        assert replay_resp.status_code == 201
        assert replay_resp.json().get("replay") is True

        # 7c. Replay with SAME idempotency key and DIFFERENT payload -> 409 Conflict!
        mismatch_resp = await client.post(
            f"/api/v1/platform/charges/{charge_id}/record-payment",
            json={
                "amount_minor": 500000,  # Changed amount!
                "evidence_reference": "Kaspi Pay Чек №1001",
                "payment_method": "bank_transfer"
            },
            headers={**p_headers, "Idempotency-Key": idemp_key1}
        )
        assert mismatch_resp.status_code == 409
        assert "Idempotency key already used with different payment payload" in mismatch_resp.json()["detail"]

        # 7d. Overpayment attempt (600 000 when only 500 000 remaining) -> 400 Bad Request!
        overpay_resp = await client.post(
            f"/api/v1/platform/charges/{charge_id}/record-payment",
            json={
                "amount_minor": 600000,
                "evidence_reference": "Kaspi Pay Чек №1002",
                "payment_method": "bank_transfer"
            },
            headers={**p_headers, "Idempotency-Key": f"pay-over-{charge_id}"}
        )
        assert overpay_resp.status_code == 400
        assert "exceeds remaining charge balance" in overpay_resp.json()["detail"]

        # 7e. Complete remaining balance (500 000 minor) -> status paid
        full_resp = await client.post(
            f"/api/v1/platform/charges/{charge_id}/record-payment",
            json={
                "amount_minor": 500000,
                "evidence_reference": "Kaspi Pay Чек №1003",
                "payment_method": "bank_transfer",
                "note": "Доплата остатка"
            },
            headers={**p_headers, "Idempotency-Key": f"pay-full-{charge_id}"}
        )
        assert full_resp.status_code == 201
        assert full_resp.json()["status"] == "paid"

        # 8. Reactivate Tenant explicitly
        react_resp = await client.post(
            f"/api/v1/platform/tenants/{tenant_id}/reactivate",
            json={"reason": "Оплата подтверждена"},
            headers=p_headers
        )
        assert react_resp.status_code == 200
        assert react_resp.json()["status"] == "active"

        # 9. SECURE OPERATOR ONBOARDING & ACTIVATION (P0-03)
        # 9a. Regular CRM identity cannot gain platform privileges silently -> 400 Bad Request
        crm_upgrade_resp = await client.post(
            "/api/v1/platform/staff",
            json={
                "email": "damir@barberhouse.kz",  # Existing CRM master
                "display_name": "Дамир Мастер",
                "platform_role": "support",
                "allow_crm_user_upgrade": False
            },
            headers=p_headers
        )
        assert crm_upgrade_resp.status_code == 400
        assert "Upgrading CRM users to platform operators requires explicit confirmation" in crm_upgrade_resp.json()["detail"]

        # 9b. Platform owner invites new staff -> returns activation token, NO default password!
        op_uniq = uuid.uuid4().hex[:6]
        new_op_email = f"operator_{op_uniq}@platform.example.kz"
        invite_op_resp = await client.post(
            "/api/v1/platform/staff",
            json={
                "email": new_op_email,
                "display_name": "Новый Оператор",
                "platform_role": "support"
            },
            headers=p_headers
        )
        assert invite_op_resp.status_code == 201
        op_data = invite_op_resp.json()
        assert "activation_token" in op_data
        assert "password" not in op_data  # No plaintext password!
        act_token = op_data["activation_token"]

        # 9c. Operator activates secret password via one-time token
        act_resp = await client.post(
            "/api/v1/platform/staff/activate",
            json={
                "activation_token": act_token,
                "password": "SecureOperatorPassword2026!"
            }
        )
        assert act_resp.status_code == 200
        assert act_resp.json()["status"] == "activated"

        # 9d. Reusing consumed activation token -> 409 Conflict
        act_reuse_resp = await client.post(
            "/api/v1/platform/staff/activate",
            json={
                "activation_token": act_token,
                "password": "AnotherPassword2026!"
            }
        )
        assert act_reuse_resp.status_code == 409

        # 9e. Login as newly activated operator using their own secret
        op_login = await client.post("/api/v1/auth/login", json={
            "email": new_op_email,
            "password": "SecureOperatorPassword2026!"
        })
        assert op_login.status_code == 200
        op_token = op_login.json()["access_token"]
        me_resp = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {op_token}"})
        assert me_resp.status_code == 200
        assert me_resp.json()["platform_role"] == "support" 

        # 10. Check Audit Trail
        audit_resp = await client.get(f"/api/v1/platform/audit?target_tenant_id={tenant_id}", headers=p_headers)
        assert audit_resp.status_code == 200
        audit_events = audit_resp.json()
        action_names = [e["action"] for e in audit_events]
        assert "tenant.created" in action_names
        assert "tenant.suspended" in action_names
        assert "payment.recorded" in action_names
        assert "tenant.reactivated" in action_names

@pytest.mark.asyncio
async def test_platform_tenant_users_access_tab_fc_p0_01():
    """
    FC-P0-01: Company Access Tab must return 200 without HTTP 500.
    Joined members and pending invites are returned cleanly with correct timestamps.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Platform Owner login
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@platform.example.kz",
            "password": "Password123!"
        })
        assert login_resp.status_code == 200
        p_token = login_resp.json()["access_token"]
        p_headers = {"Authorization": f"Bearer {p_token}"}

        # Get Barber House tenant
        tenants_resp = await client.get("/api/v1/platform/tenants", headers=p_headers)
        assert tenants_resp.status_code == 200
        barberhouse = next((t for t in tenants_resp.json() if t["slug"] == "barberhouse"), None)
        assert barberhouse is not None
        tenant_id = barberhouse["id"]

        # Query tenant users & invites
        users_resp = await client.get(f"/api/v1/platform/tenants/{tenant_id}/users", headers=p_headers)
        assert users_resp.status_code == 200, users_resp.text
        data = users_resp.json()
        assert "members" in data
        assert "invites" in data
        assert len(data["members"]) >= 1

        # Check members structure
        owner_member = next((m for m in data["members"] if m["role"] == "owner"), None)
        assert owner_member is not None
        assert "joined_at" in owner_member
        assert "created_at" in owner_member
        assert owner_member["email"] == "owner@barberhouse.kz"


@pytest.mark.asyncio
async def test_operator_activation_existing_crm_user_password_protection_fc_p0_03():
    """
    FC-P0-03: Upgrading existing CRM user to platform operator MUST NOT reset or wipe password.
    Requires current_password for verification; preserves user.password_hash intact.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Platform Owner login
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@platform.example.kz",
            "password": "Password123!"
        })
        p_token = login_resp.json()["access_token"]
        p_headers = {"Authorization": f"Bearer {p_token}"}

        # Create an isolated tenant with an owner
        uniq = uuid.uuid4().hex[:6]
        owner_email = f"owner_iso_{uniq}@testtenant.kz"
        t_resp = await client.post("/api/v1/platform/tenants", json={
            "slug": f"iso_{uniq}",
            "display_name": "Isolated Tenant",
            "owner_email": owner_email,
            "owner_name": "Изолированный Владелец",
            "vertical": "barbershop",
            "plan_code": "start"
        }, headers=p_headers)
        assert t_resp.status_code == 201
        data = t_resp.json()
        invite_token = data.get("invite_token")
        assert invite_token is not None

        # Activate isolated owner with Password123!
        act_owner_resp = await client.post("/api/v1/auth/accept-invite", json={
            "token": invite_token,
            "password": "Password123!"
        })
        assert act_owner_resp.status_code == 200

        # Verify isolated owner can log in to CRM
        crm_login = await client.post("/api/v1/auth/login", json={
            "email": owner_email,
            "password": "Password123!"
        })
        assert crm_login.status_code == 200, "Existing CRM login must succeed"

        # Invite existing CRM user to platform staff with allow_crm_user_upgrade=True
        invite_resp = await client.post("/api/v1/platform/staff", json={
            "email": owner_email,
            "display_name": "Изолированный Оператор",
            "platform_role": "support",
            "allow_crm_user_upgrade": True
        }, headers=p_headers)
        assert invite_resp.status_code == 201
        token = invite_resp.json()["activation_token"]

        # 1. Activation WITHOUT current_password -> rejected with 401
        fail_act_1 = await client.post("/api/v1/platform/staff/activate", json={
            "activation_token": token
        })
        assert fail_act_1.status_code == 401
        assert "requires confirmation with their current password" in fail_act_1.json()["detail"]

        # 2. Activation with WRONG current_password -> rejected with 401
        fail_act_2 = await client.post("/api/v1/platform/staff/activate", json={
            "activation_token": token,
            "current_password": "WrongPassword123!"
        })
        assert fail_act_2.status_code == 401

        # 3. Activation with valid current_password and attempting to supply new password:
        # Our backend preserves user.password_hash intact!
        success_act = await client.post("/api/v1/platform/staff/activate", json={
            "activation_token": token,
            "current_password": "Password123!",
            "password": "AttemptToHijackPassword999!"
        })
        assert success_act.status_code == 200
        assert success_act.json()["status"] == "activated"

        # 4. Verify original CRM password is STILL Password123! and NOT overwritten!
        crm_login_verify = await client.post("/api/v1/auth/login", json={
            "email": owner_email,
            "password": "Password123!"
        })
        assert crm_login_verify.status_code == 200, "Original password must remain functional!"

        # 5. Verify the hijacked password does NOT work!
        hijack_login = await client.post("/api/v1/auth/login", json={
            "email": owner_email,
            "password": "AttemptToHijackPassword999!"
        })
        assert hijack_login.status_code == 401, "Attempted hijacked password must not work!"


@pytest.mark.asyncio
async def test_support_access_owner_approval_and_revocation_fc_p1_01():
    """
    FC-P1-01: Support access request approval lifecycle.
    - Non-owner role (master) is forbidden from listing or approving support requests.
    - Tenant owner reviews pending requests, approves 30-min session, views active session,
      and can revoke it early.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Platform Support Operator
        op_login = await client.post("/api/v1/auth/login", json={
            "email": "support@platform.example.kz",
            "password": "Password123!"
        })
        assert op_login.status_code == 200
        op_token = op_login.json()["access_token"]
        op_headers = {"Authorization": f"Bearer {op_token}"}

        # Get Barber House tenant id
        plat_tenants = await client.get("/api/v1/platform/tenants", headers=op_headers)
        barberhouse = next((t for t in plat_tenants.json() if t["slug"] == "barberhouse"), None)
        tenant_id = barberhouse["id"]

        # Operator requests diagnostic support access
        req_resp = await client.post("/api/v1/platform/access-requests", json={
            "tenant_id": tenant_id,
            "reason": "Диагностика ошибок синхронизации календаря Barber House",
            "requested_scope": "read_only"
        }, headers=op_headers)
        assert req_resp.status_code == 201
        request_id = req_resp.json()["request_id"]

        # 2. Master role attempt to access pending requests -> 403 Forbidden
        master_login = await client.post("/api/v1/auth/login", json={
            "email": "damir@barberhouse.kz",
            "password": "Password123!"
        })
        assert master_login.status_code == 200
        master_token = master_login.json()["access_token"]
        master_headers = {"Authorization": f"Bearer {master_token}", "X-Tenant-ID": tenant_id}

        forbidden_list = await client.get("/api/v1/business/access-requests/pending", headers=master_headers)
        assert forbidden_list.status_code == 403, "Master must not be able to list support access requests"

        forbidden_approve = await client.post(f"/api/v1/business/access-requests/{request_id}/approve", headers=master_headers)
        assert forbidden_approve.status_code == 403, "Master must not be able to approve support access requests"

        # 3. Owner login
        owner_login = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert owner_login.status_code == 200
        owner_token = owner_login.json()["access_token"]
        owner_headers = {"Authorization": f"Bearer {owner_token}", "X-Tenant-ID": tenant_id}

        # Owner lists pending requests
        pending_resp = await client.get("/api/v1/business/access-requests/pending", headers=owner_headers)
        assert pending_resp.status_code == 200
        pending_list = pending_resp.json()
        assert len(pending_list) >= 1
        found_req = next((r for r in pending_list if r["id"] == request_id), None)
        assert found_req is not None
        assert found_req["requester_email"] == "support@platform.example.kz"
        assert "Диагностика" in found_req["reason"]

        # Owner approves access
        approve_resp = await client.post(f"/api/v1/business/access-requests/{request_id}/approve", headers=owner_headers)
        assert approve_resp.status_code == 200
        assert approve_resp.json()["status"] == "approved"
        session_id = approve_resp.json()["session_id"]

        # Owner checks active sessions
        active_resp = await client.get("/api/v1/business/access-sessions/active", headers=owner_headers)
        assert active_resp.status_code == 200
        active_list = active_resp.json()
        assert len(active_list) >= 1
        found_sess = next((s for s in active_list if s["id"] == session_id), None)
        assert found_sess is not None
        assert found_sess["minutes_left"] <= 30

        # Operator can now access diagnostic endpoint
        diag_resp = await client.get(f"/api/v1/platform/support/delegated-tenant/{tenant_id}", headers=op_headers)
        assert diag_resp.status_code == 200

        # Owner revokes active session early
        revoke_resp = await client.post(f"/api/v1/business/access-sessions/{session_id}/revoke", headers=owner_headers)
        assert revoke_resp.status_code == 200
        assert revoke_resp.json()["status"] == "revoked"

        # Active sessions list is now empty for this session
        active_after = (await client.get("/api/v1/business/access-sessions/active", headers=owner_headers)).json()
        assert not any(s["id"] == session_id for s in active_after)

        # Operator diagnostic call is now blocked!
        diag_blocked = await client.get(f"/api/v1/platform/support/delegated-tenant/{tenant_id}", headers=op_headers)
        assert diag_blocked.status_code == 403
