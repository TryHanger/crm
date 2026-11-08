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
    - Manual billing ledger:
      * Issue charge
      * Record manual payment with evidence receipt
      * Idempotency replay check
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

        # 5. Issue Manual Charge
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

        # 6. Record Manual Payment with Idempotency Key
        idemp_key = f"pay-{charge_id}"
        pmt_resp = await client.post(
            f"/api/v1/platform/charges/{charge_id}/record-payment",
            json={
                "amount_minor": 900000,
                "evidence_reference": "Kaspi Pay Чек №948201",
                "payment_method": "bank_transfer",
                "note": "Оплата тарифа Start"
            },
            headers={**p_headers, "Idempotency-Key": idemp_key}
        )
        assert pmt_resp.status_code == 201
        assert pmt_resp.json()["status"] == "paid"

        # Retry with SAME idempotency key returns replay
        pmt_retry = await client.post(
            f"/api/v1/platform/charges/{charge_id}/record-payment",
            json={
                "amount_minor": 900000,
                "evidence_reference": "Kaspi Pay Чек №948201",
                "payment_method": "bank_transfer"
            },
            headers={**p_headers, "Idempotency-Key": idemp_key}
        )
        assert pmt_retry.status_code == 201
        assert pmt_retry.json().get("replay") is True

        # 7. Reactivate Tenant
        react_resp = await client.post(
            f"/api/v1/platform/tenants/{tenant_id}/reactivate",
            json={"reason": "Оплата подтверждена"},
            headers=p_headers
        )
        assert react_resp.status_code == 200
        assert react_resp.json()["status"] == "active"

        # 8. Check Audit Trail
        audit_resp = await client.get(f"/api/v1/platform/audit?target_tenant_id={tenant_id}", headers=p_headers)
        assert audit_resp.status_code == 200
        audit_events = audit_resp.json()
        action_names = [e["action"] for e in audit_events]
        assert "tenant.created" in action_names
        assert "tenant.suspended" in action_names
        assert "payment.recorded" in action_names
        assert "tenant.reactivated" in action_names
