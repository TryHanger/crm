import uuid
import datetime
import random
import pytest
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app
from apps.api.app.infrastructure.db.models import Booking, BookingEvent
from apps.api.app.modules.finance.service import FinanceCoreService
from sqlalchemy import select


@pytest.mark.asyncio
async def test_visit_financial_blocks_and_completion_acceptance():
    """
    SPRINT M11 — Acceptance and Regression Test (Developer 1 & Financial Core):
    - D1 Acceptance: Завершение стрижки на 8000 KZT даёт оказано=8000, оплачено=0, долг=8000.
    - Zero fake payments: сменя статуса на completed НЕ создаёт фиктивных платежей и не закрывает долг.
    - Canonical fields: стоимость, оказано, получено, долг разделены.
    - Endpoints contract: GET /bookings/{id}, GET /calendar, PATCH /bookings/{id}/status, GET /customers/{id}.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Barber House owner
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Get branches, staff, and services
        branches_resp = await client.get("/api/v1/business/branches", headers=headers)
        assert branches_resp.status_code == 200
        branch_id = branches_resp.json()[0]["id"]

        staff_resp = await client.get("/api/v1/business/staff", headers=headers)
        assert staff_resp.status_code == 200
        staff_id = staff_resp.json()[0]["id"]

        # Ensure service priced at exactly 8000 KZT (800000 minor)
        services_resp = await client.get("/api/v1/business/services", headers=headers)
        assert services_resp.status_code == 200
        services = services_resp.json()
        target_service = next((s for s in services if s.get("base_price_minor") == 800000), None)

        if not target_service:
            # Create a dedicated 8000 KZT service: "Фирменная стрижка M11"
            svc_create = await client.post("/api/v1/business/services", json={
                "name": "Фирменная стрижка M11",
                "base_price_minor": 800000,
                "base_duration_minutes": 60,
                "online_visible": True
            }, headers=headers)
            assert svc_create.status_code == 201, f"Failed creating service: {svc_create.text}"
            service_id = svc_create.json()["id"]
        else:
            service_id = target_service["id"]

        # 3. Create appointment in future slot (with random offset to avoid slot conflict on repeated runs)
        target_date = datetime.date.today() + datetime.timedelta(days=random.randint(50, 120))
        while target_date.isoweekday() not in (1, 2, 3, 4, 5):
            target_date += datetime.timedelta(days=1)

        slot_hour = random.choice([5, 6, 10, 11])
        slot_start_utc = datetime.datetime.combine(
            target_date, datetime.time(slot_hour, 0), tzinfo=datetime.timezone.utc
        )

        create_booking_resp = await client.post(
            "/api/v1/business/bookings",
            json={
                "branch_id": branch_id,
                "staff_id": staff_id,
                "service_ids": [service_id],
                "starts_at_utc": slot_start_utc.isoformat(),
                "customer_name": "Айдар Ахметов (M11)",
                "customer_phone": f"+7777{random.randint(1000000, 9999999)}"
            },
            headers=headers
        )
        assert create_booking_resp.status_code == 201, f"Booking creation failed: {create_booking_resp.text}"
        booking_id = create_booking_resp.json()["booking_id"]

        # 4. Check initial booking card (Confirmed status)
        card_resp = await client.get(f"/api/v1/business/bookings/{booking_id}", headers=headers)
        assert card_resp.status_code == 200
        card = card_resp.json()
        assert card["status"] == "confirmed"
        assert card["cost_minor"] == 800000, "Cost must be exactly 8000 KZT"
        assert card["rendered_minor"] == 0, "Initial rendered amount must be 0 before completion"
        assert card["paid_minor"] == 0, "Paid amount must be 0"
        assert card["debt_minor"] == 0, "Debt is 0 before service is rendered"
        assert card["payment_status"] == "unpaid"
        assert card["finance"]["currency"] == "KZT"

        # Check calendar endpoint
        cal_resp = await client.get(
            f"/api/v1/business/calendar?date={target_date.isoformat()}&branch_id={branch_id}",
            headers=headers
        )
        assert cal_resp.status_code == 200
        cal_booking = next(b for b in cal_resp.json()["bookings"] if b["id"] == booking_id)
        assert cal_booking["cost_minor"] == 800000
        assert cal_booking["rendered_minor"] == 0
        assert cal_booking["paid_minor"] == 0
        assert cal_booking["debt_minor"] == 0
        assert cal_booking["payment_status"] == "unpaid"

        # 5. Transition to 'arrived' -> Still 0 rendered, 0 paid, 0 debt
        st_arrived = await client.patch(
            f"/api/v1/business/bookings/{booking_id}/status",
            json={"status": "arrived"},
            headers=headers
        )
        assert st_arrived.status_code == 200
        assert st_arrived.json()["rendered_minor"] == 0
        assert st_arrived.json()["paid_minor"] == 0
        assert st_arrived.json()["debt_minor"] == 0

        # 6. Transition to 'in_progress' -> Still 0 rendered, 0 paid, 0 debt
        st_prog = await client.patch(
            f"/api/v1/business/bookings/{booking_id}/status",
            json={"status": "in_progress"},
            headers=headers
        )
        assert st_prog.status_code == 200
        assert st_prog.json()["rendered_minor"] == 0
        assert st_prog.json()["debt_minor"] == 0

        # 7. CRITICAL DEMO ACCEPTANCE: Complete haircut for 8000 KZT!
        # Result MUST be: rendered = 8000, paid = 0, debt = 8000, payment_status = unpaid
        st_completed = await client.patch(
            f"/api/v1/business/bookings/{booking_id}/status",
            json={"status": "completed"},
            headers=headers
        )
        assert st_completed.status_code == 200
        comp_data = st_completed.json()

        assert comp_data["status"] == "completed"
        assert comp_data["cost_minor"] == 800000, "Cost must be 8000 KZT (800000 minor)"
        assert comp_data["rendered_minor"] == 800000, "Delivered amount must be 8000 KZT upon completion"
        assert comp_data["paid_minor"] == 0, "Paid amount must remain 0 (NO fake payment on completion!)"
        assert comp_data["debt_minor"] == 800000, "Customer debt must be 8000 KZT!"
        assert comp_data["payment_status"] == "unpaid", "Payment status must strictly remain unpaid"

        # 8. Verify GET /bookings/{id} returns the exact same authoritative breakdown
        final_card_resp = await client.get(f"/api/v1/business/bookings/{booking_id}", headers=headers)
        assert final_card_resp.status_code == 200
        final_card = final_card_resp.json()
        assert final_card["status"] == "completed"
        assert final_card["cost_minor"] == 800000
        assert final_card["rendered_minor"] == 800000
        assert final_card["paid_minor"] == 0
        assert final_card["debt_minor"] == 800000
        assert final_card["payment_status"] == "unpaid"
        assert final_card["finance"]["cost_minor"] == 800000
        assert final_card["finance"]["rendered_minor"] == 800000
        assert final_card["finance"]["debt_minor"] == 800000

        # 9. Verify GET /calendar returns debt for completed booking
        final_cal_resp = await client.get(
            f"/api/v1/business/calendar?date={target_date.isoformat()}&branch_id={branch_id}",
            headers=headers
        )
        assert final_cal_resp.status_code == 200
        final_cal_b = next(b for b in final_cal_resp.json()["bookings"] if b["id"] == booking_id)
        assert final_cal_b["status"] == "completed"
        assert final_cal_b["rendered_minor"] == 800000
        assert final_cal_b["debt_minor"] == 800000
        assert final_cal_b["paid_minor"] == 0
        assert final_cal_b["payment_status"] == "unpaid"

        # 10. Verify GET /customers/{customer_id} history returns the financial fields
        cust_id = final_card["customer"]["id"]
        cust_resp = await client.get(f"/api/v1/business/customers/{cust_id}", headers=headers)
        assert cust_resp.status_code == 200
        cust_data = cust_resp.json()
        cust_visit = next(v for v in cust_data["history"] if v["id"] == booking_id)
        assert cust_visit["status"] == "completed"
        assert cust_visit["rendered_minor"] == 800000
        assert cust_visit["debt_minor"] == 800000
        assert cust_visit["paid_minor"] == 0


@pytest.mark.asyncio
async def test_visit_completed_event_idempotency_without_duplicate_accrual(db_session):
    """
    Verifies that FinanceCoreService.on_visit_completed is idempotent:
    Retry attempts do not create duplicate events or distort debt calculations.
    """
    from apps.api.app.infrastructure.db.session import set_tenant_context
    from apps.api.app.infrastructure.db.models import Tenant, Branch, StaffProfile, Customer

    stmt_t = select(Tenant).limit(1)
    res_t = await db_session.execute(stmt_t)
    tenant = res_t.scalar_one()
    await set_tenant_context(db_session, tenant.id)

    stmt_b = select(Branch).where(Branch.tenant_id == tenant.id).limit(1)
    branch = (await db_session.execute(stmt_b)).scalar_one()

    stmt_s = select(StaffProfile).where(StaffProfile.tenant_id == tenant.id).limit(1)
    staff = (await db_session.execute(stmt_s)).scalar_one()

    stmt_c = select(Customer).where(Customer.tenant_id == tenant.id).limit(1)
    cust = (await db_session.execute(stmt_c)).scalar_one()

    now = datetime.datetime.now(datetime.timezone.utc)
    booking = Booking(
        tenant_id=tenant.id,
        branch_id=branch.id,
        staff_id=staff.id,
        customer_id=cust.id,
        source="crm_manual",
        status="completed",
        starts_at_utc=now,
        service_ends_at_utc=now + datetime.timedelta(hours=1),
        busy_ends_at_utc=now + datetime.timedelta(hours=1),
        timezone_snapshot="Asia/Almaty",
        currency="KZT",
        amount_minor_snapshot=800000,
        public_ref=f"BK-{random.randint(10000, 99999)}"
    )
    db_session.add(booking)
    await db_session.flush()

    # Call on_visit_completed 3 times
    fin1 = await FinanceCoreService.on_visit_completed(booking, db_session)
    fin2 = await FinanceCoreService.on_visit_completed(booking, db_session)
    fin3 = await FinanceCoreService.on_visit_completed(booking, db_session)

    assert fin1 == fin2 == fin3
    assert fin1["rendered_minor"] == 800000
    assert fin1["paid_minor"] == 0
    assert fin1["debt_minor"] == 800000

    # Check database event count
    stmt_ev = select(BookingEvent).where(
        BookingEvent.booking_id == booking.id,
        BookingEvent.event_type == "visit_completed"
    )
    res_ev = await db_session.execute(stmt_ev)
    events = res_ev.scalars().all()
    assert len(events) == 1, "Only one visit_completed event must exist despite retries"
