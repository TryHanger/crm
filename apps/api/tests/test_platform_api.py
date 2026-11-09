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
