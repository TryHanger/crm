import pytest
import datetime
import uuid
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app

@pytest.mark.asyncio
async def test_auth_rejection_on_invalid_password():
    """Validates that password bypass is completely eliminated and wrong passwords return 401."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Wrong password
        resp_bad = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "WrongPassword999!"
        })
        assert resp_bad.status_code == 401

        # Attempt dev_secret_hash bypass
        resp_bypass = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "dev_secret_hash"
        })
        assert resp_bypass.status_code == 401

        # Correct password succeeds
        resp_good = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert resp_good.status_code == 200
        assert "access_token" in resp_good.json()


@pytest.mark.asyncio
async def test_public_booking_rejection_on_suspended_tenant():
    """Validates that public booking is blocked for suspended companies."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Platform Owner
        login_p = await client.post("/api/v1/auth/login", json={
            "email": "owner@platform.example.kz",
            "password": "Password123!"
        })
        assert login_p.status_code == 200
        p_headers = {"Authorization": f"Bearer {login_p.json()['access_token']}"}

        # 2. Create a new test tenant
        slug = f"susp_{uuid.uuid4().hex[:6]}"
        create_resp = await client.post("/api/v1/platform/tenants", json={
            "slug": slug,
            "display_name": "Suspended Test Shop",
            "owner_email": f"{slug}@example.kz",
            "owner_name": "Тест Владелец",
            "vertical": "barbershop",
            "plan_code": "start"
        }, headers=p_headers)
        assert create_resp.status_code == 201
        tenant_id = create_resp.json()["tenant_id"]

        # 3. Suspend tenant
        susp_resp = await client.post(f"/api/v1/platform/tenants/{tenant_id}/suspend", json={
            "reason": "Test suspension"
        }, headers=p_headers)
        assert susp_resp.status_code == 200

        # 4. Attempt public site resolution -> 403 TENANT_SUSPENDED
        pub_resp = await client.get("/api/v1/public/site", headers={"Host": f"{slug}.book.example.kz"})
        assert pub_resp.status_code == 403


@pytest.mark.asyncio
async def test_public_booking_rejections_past_and_too_soon():
    """Validates that direct POST /public/bookings in past or violating min_advance is rejected."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        headers = {"Host": "barberhouse.book.example.kz"}

        # Get branch, service, staff
        resp_b = await client.get("/api/v1/public/branches", headers=headers)
        branch_id = resp_b.json()[0]["id"]

        resp_s = await client.get("/api/v1/public/services", headers=headers)
        service_id = resp_s.json()[0]["id"]

        resp_st = await client.get(f"/api/v1/public/staff?branch_id={branch_id}&service_ids={service_id}", headers=headers)
        staff_id = resp_st.json()[0]["id"]

        now = datetime.datetime.now(datetime.timezone.utc)

        # 1. Past slot
        past_slot = now - datetime.timedelta(hours=2)
        resp_past = await client.post("/api/v1/public/bookings", json={
            "branch_id": branch_id,
            "staff_id": staff_id,
            "service_ids": [service_id],
            "starts_at_utc": past_slot.isoformat(),
            "customer_name": "Клиент Прошлого",
            "customer_phone": "+77019998877"
        }, headers=headers)
        assert resp_past.status_code == 400
        assert resp_past.json()["code"] == "SLOT_IN_PAST"

        # 2. Too soon (e.g. 5 minutes from now when policy requires 120 min)
        soon_slot = now + datetime.timedelta(minutes=5)
        resp_soon = await client.post("/api/v1/public/bookings", json={
            "branch_id": branch_id,
            "staff_id": staff_id,
            "service_ids": [service_id],
            "starts_at_utc": soon_slot.isoformat(),
            "customer_name": "Клиент Спешки",
            "customer_phone": "+77019998877"
        }, headers=headers)
        assert resp_soon.status_code == 400
        assert resp_soon.json()["code"] == "SLOT_TOO_SOON"


@pytest.mark.asyncio
async def test_public_booking_rejections_shift_and_breaks():
    """Validates that direct POST outside working shift or during lunch break is rejected."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        headers = {"Host": "barberhouse.book.example.kz"}

        resp_b = await client.get("/api/v1/public/branches", headers=headers)
        branch_id = resp_b.json()[0]["id"]

        resp_s = await client.get("/api/v1/public/services", headers=headers)
        service_id = resp_s.json()[0]["id"]

        resp_st = await client.get(f"/api/v1/public/staff?branch_id={branch_id}&service_ids={service_id}", headers=headers)
        # Find Damir
        damir = next(s for s in resp_st.json() if "Дамир" in s["display_name"])
        damir_id = damir["id"]

        today = datetime.datetime.now(datetime.timezone.utc).date()
        target_date = today + datetime.timedelta(days=14)
        while target_date.isoweekday() not in (1, 2, 3, 4, 5):
            target_date += datetime.timedelta(days=1)

        # 1. Night time (03:00 UTC+5 is 22:00 previous day UTC) -> outside 10:00 - 20:00 shift
        # 03:00 Asia/Almaty = 22:00 UTC previous day
        night_utc = datetime.datetime.combine(target_date - datetime.timedelta(days=1), datetime.time(22, 0), tzinfo=datetime.timezone.utc)
        resp_night = await client.post("/api/v1/public/bookings", json={
            "branch_id": branch_id,
            "staff_id": damir_id,
            "service_ids": [service_id],
            "starts_at_utc": night_utc.isoformat(),
            "customer_name": "Ночной Клиент",
            "customer_phone": "+77019998877"
        }, headers=headers)
        assert resp_night.status_code == 400
        assert resp_night.json()["code"] == "STAFF_OUTSIDE_SHIFT"

        # 2. During Damir's break (14:00 - 15:00 Asia/Almaty = 09:00 - 10:00 UTC)
        break_utc = datetime.datetime.combine(target_date, datetime.time(9, 15), tzinfo=datetime.timezone.utc)
        resp_break = await client.post("/api/v1/public/bookings", json={
            "branch_id": branch_id,
            "staff_id": damir_id,
            "service_ids": [service_id],
            "starts_at_utc": break_utc.isoformat(),
            "customer_name": "Обеденный Клиент",
            "customer_phone": "+77019998877"
        }, headers=headers)
        assert resp_break.status_code == 400
        assert resp_break.json()["code"] == "STAFF_ON_BREAK"


@pytest.mark.asyncio
async def test_master_role_scoping_and_object_permissions():
    """Validates that a Master role is strictly prohibited from viewing or altering other masters' bookings."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Owner to create an appointment for Erzhan
        login_o = await client.post("/api/v1/auth/login", json={"email": "owner@barberhouse.kz", "password": "Password123!"})
        owner_headers = {"Authorization": f"Bearer {login_o.json()['access_token']}"}

        branches = (await client.get("/api/v1/business/branches", headers=owner_headers)).json()
        b_id = branches[0]["id"]
        services = (await client.get("/api/v1/business/services", headers=owner_headers)).json()
        s_id = services[0]["id"]
        staff_all = (await client.get("/api/v1/business/staff", headers=owner_headers)).json()
        erzhan = next(s for s in staff_all if "Ержан" in s["display_name"])

        # Create booking for Erzhan at 11:00 Almaty (06:00 UTC)
        today = datetime.datetime.now(datetime.timezone.utc).date()
        target_slot = datetime.datetime.combine(today + datetime.timedelta(days=25), datetime.time(6, 0), tzinfo=datetime.timezone.utc)
        resp_b = await client.post("/api/v1/business/bookings", json={
            "branch_id": b_id,
            "staff_id": erzhan["id"],
            "service_ids": [s_id],
            "starts_at_utc": target_slot.isoformat(),
            "customer_name": "Клиент Ержана",
            "customer_phone": "+77011112233"
        }, headers=owner_headers)
        assert resp_b.status_code == 201
        erzhan_booking_id = resp_b.json()["booking_id"]

        # 2. Login as Master Damir
        login_m = await client.post("/api/v1/auth/login", json={"email": "damir@barberhouse.kz", "password": "Password123!"})
        master_headers = {"Authorization": f"Bearer {login_m.json()['access_token']}"}

        # Damir attempts to GET Erzhan's booking card -> 403 Forbidden!
        resp_card = await client.get(f"/api/v1/business/bookings/{erzhan_booking_id}", headers=master_headers)
        assert resp_card.status_code == 403

        # Damir attempts to change status of Erzhan's booking -> 403 Forbidden!
        resp_st = await client.patch(f"/api/v1/business/bookings/{erzhan_booking_id}/status", json={"status": "completed"}, headers=master_headers)
        assert resp_st.status_code == 403

        # Damir attempts to reschedule Erzhan's booking -> 403 Forbidden!
        new_slot = target_slot + datetime.timedelta(hours=1)
        resp_resch = await client.post(f"/api/v1/business/bookings/{erzhan_booking_id}/reschedule", json={"new_starts_at_utc": new_slot.isoformat()}, headers=master_headers)
        assert resp_resch.status_code == 403

        # Damir attempts to cancel Erzhan's booking -> 403 Forbidden!
        resp_cancel = await client.post(f"/api/v1/business/bookings/{erzhan_booking_id}/cancel", json={"reason": "Взлом"}, headers=master_headers)
        assert resp_cancel.status_code == 403

        # Damir attempts to view company financial reports -> 403 Forbidden!
        resp_rep = await client.get(f"/api/v1/business/reports/overview?from_date={today.isoformat()}&to_date={today.isoformat()}", headers=master_headers)
        assert resp_rep.status_code == 403


@pytest.mark.asyncio
async def test_idempotent_replay_preserves_valid_management_link():
    """Validates that network retries with same Idempotency-Key return a valid working token, not 'IDEMPOTENT_REPLAY'."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        headers = {"Host": "barberhouse.book.example.kz"}

        resp_b = await client.get("/api/v1/public/branches", headers=headers)
        b_id = resp_b.json()[0]["id"]
        resp_s = await client.get("/api/v1/public/services", headers=headers)
        s_id = resp_s.json()[0]["id"]
        resp_st = await client.get(f"/api/v1/public/staff?branch_id={b_id}&service_ids={s_id}", headers=headers)
        staff_id = resp_st.json()[0]["id"]

        today = datetime.datetime.now(datetime.timezone.utc).date()
        target_day = today + datetime.timedelta(days=10)
        while target_day.isoweekday() not in (1, 2, 3, 4, 5):
            target_day += datetime.timedelta(days=1)
        # 16:00 Almaty (11:00 UTC) - outside 14:00-15:00 break
        slot_utc = datetime.datetime.combine(target_day, datetime.time(11, 0), tzinfo=datetime.timezone.utc)
        idem_key = f"key-replay-{uuid.uuid4()}"

        payload = {
            "branch_id": b_id,
            "staff_id": staff_id,
            "service_ids": [s_id],
            "starts_at_utc": slot_utc.isoformat(),
            "customer_name": "Клиент Повтора",
            "customer_phone": "+77078887766"
        }

        # First request
        resp1 = await client.post("/api/v1/public/bookings", json=payload, headers={**headers, "Idempotency-Key": idem_key})
        assert resp1.status_code == 201
        data1 = resp1.json()
        assert data1["management_token"] != "IDEMPOTENT_REPLAY"

        # Replay request with exact same idempotency key
        resp2 = await client.post("/api/v1/public/bookings", json=payload, headers={**headers, "Idempotency-Key": idem_key})
        assert resp2.status_code in (200, 201)
        data2 = resp2.json()
        assert data2["public_ref"] == data1["public_ref"]
        assert data2["management_token"] != "IDEMPOTENT_REPLAY"
        assert len(data2["management_token"]) >= 20

        # Verify that management token works!
        resp_mgmt = await client.get(f"/api/v1/public/manage/{data2['management_token']}")
        assert resp_mgmt.status_code == 200
        assert resp_mgmt.json()["public_ref"] == data1["public_ref"]


@pytest.mark.asyncio
async def test_tariff_limits_enforced_on_branch_creation():
    """Validates that Start plan with max_branches: 1 blocks creating a 2nd active branch."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        login_o = await client.post("/api/v1/auth/login", json={"email": "owner@barberhouse.kz", "password": "Password123!"})
        headers = {"Authorization": f"Bearer {login_o.json()['access_token']}"}

        # Barber House is on Start plan (max_branches: 1) and already has 1 branch
        resp_2nd_branch = await client.post("/api/v1/business/branches", json={
            "name": "Второй Филиал",
            "address": "ул. Достык, 15",
            "city": "Астана"
        }, headers=headers)
        assert resp_2nd_branch.status_code == 403
        assert "max_branches" in resp_2nd_branch.json()["detail"]


@pytest.mark.asyncio
async def test_partial_payment_does_not_mark_charge_paid():
    """Validates that recording partial payment updates charge to 'partially_paid', not 'paid'."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        login_p = await client.post("/api/v1/auth/login", json={"email": "owner@platform.example.kz", "password": "Password123!"})
        p_headers = {"Authorization": f"Bearer {login_p.json()['access_token']}"}

        # 1. Get first tenant subscription
        ov = (await client.get("/api/v1/platform/overview", headers=p_headers)).json()
        tenants = (await client.get("/api/v1/platform/tenants", headers=p_headers)).json()
        t_id = tenants[0]["id"]
        t_detail = (await client.get(f"/api/v1/platform/tenants/{t_id}", headers=p_headers)).json()
        sub_id = t_detail["subscription"]["id"]

        # 2. Issue a charge for 10 000 KZT (1 000 000 minor)
        today = datetime.datetime.now(datetime.timezone.utc).date()
        charge_resp = await client.post(f"/api/v1/platform/subscriptions/{sub_id}/charges", json={
            "period_start": today.isoformat(),
            "period_end": (today + datetime.timedelta(days=30)).isoformat(),
            "amount_minor": 1000000,
            "currency": "KZT",
            "evidence_reference": "INV-TEST-001"
        }, headers=p_headers)
        assert charge_resp.status_code == 201
        charge_id = charge_resp.json()["charge_id"]

        # 3. Pay only 4 000 KZT (400 000 minor)
        pmt_resp = await client.post(f"/api/v1/platform/charges/{charge_id}/record-payment", json={
            "amount_minor": 400000,
            "payment_method": "bank_transfer",
            "evidence_reference": "PP-TEST-PARTIAL"
        }, headers=p_headers)
        assert pmt_resp.status_code == 201
        assert pmt_resp.json()["status"] == "partially_paid"


@pytest.mark.asyncio
async def test_owner_invite_and_acceptance_flow():
    """Validates Gate 0 #6: Owner invite issuance, status 'invited', and acceptance flow."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Platform Owner
        login_p = await client.post("/api/v1/auth/login", json={"email": "owner@platform.example.kz", "password": "Password123!"})
        p_headers = {"Authorization": f"Bearer {login_p.json()['access_token']}"}

        # 2. Create New Company
        slug = f"barber-{uuid.uuid4().hex[:6]}"
        owner_email = f"owner-{slug}@example.kz"
        create_resp = await client.post("/api/v1/platform/tenants", json={
            "slug": slug,
            "display_name": "Тестовый Барбершоп",
            "vertical": "barbershop",
            "owner_name": "Новый Владелец",
            "owner_email": owner_email,
            "plan_code": "start"
        }, headers=p_headers)
        assert create_resp.status_code == 201
        data = create_resp.json()
        assert data["owner_status"] == "invited"
        invite_token = data.get("invite_token")
        assert invite_token is not None

        # 3. Try to login before accepting invite -> 401
        login_fail = await client.post("/api/v1/auth/login", json={"email": owner_email, "password": "Password123!"})
        assert login_fail.status_code == 401

        # 4. Accept with invalid token -> 400
        inv_bad = await client.post("/api/v1/auth/accept-invite", json={"token": "invalid_tok_123", "password": "NewSecretPassword123!"})
        assert inv_bad.status_code == 400

        # 5. Accept with short password -> 422
        inv_short = await client.post("/api/v1/auth/accept-invite", json={"token": invite_token, "password": "123"})
        assert inv_short.status_code == 422

        # 6. Accept invite successfully
        inv_ok = await client.post("/api/v1/auth/accept-invite", json={
            "token": invite_token,
            "password": "NewSecurePassword123!",
            "display_name": "Активированный Владелец"
        })
        assert inv_ok.status_code == 200
        ok_data = inv_ok.json()
        assert ok_data["role"] == "owner"
        assert "access_token" in ok_data

        # 7. Login with newly created password -> 200
        login_ok = await client.post("/api/v1/auth/login", json={"email": owner_email, "password": "NewSecurePassword123!"})
        assert login_ok.status_code == 200
        assert login_ok.json()["role"] == "owner"


@pytest.mark.asyncio
async def test_idempotency_key_reuse_rejection_on_payload_mismatch():
    """Validates Gate 1 #8: Reusing Idempotency-Key with different payload is rejected with 409."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        headers = {"Host": "barberhouse.book.example.kz"}
        resp_b = await client.get("/api/v1/public/branches", headers=headers)
        b_id = resp_b.json()[0]["id"]
        resp_s = await client.get("/api/v1/public/services", headers=headers)
        s_id = resp_s.json()[0]["id"]
        resp_st = await client.get(f"/api/v1/public/staff?branch_id={b_id}&service_ids={s_id}", headers=headers)
        staff_id = resp_st.json()[0]["id"]

        today = datetime.datetime.now(datetime.timezone.utc).date()
        target_day = today + datetime.timedelta(days=18)
        while target_day.isoweekday() not in (1, 2, 3, 4, 5):
            target_day += datetime.timedelta(days=1)
        slot1_utc = datetime.datetime.combine(target_day, datetime.time(11, 0), tzinfo=datetime.timezone.utc)
        slot2_utc = datetime.datetime.combine(target_day, datetime.time(12, 0), tzinfo=datetime.timezone.utc)
        idem_key = f"key-test-mismatch-{uuid.uuid4()}"

        payload1 = {
            "branch_id": b_id,
            "staff_id": staff_id,
            "service_ids": [s_id],
            "starts_at_utc": slot1_utc.isoformat(),
            "customer_name": "Идемпотентный Клиент",
            "customer_phone": "+77081112233"
        }

        # Request 1: succeeds
        resp1 = await client.post("/api/v1/public/bookings", json=payload1, headers={**headers, "Idempotency-Key": idem_key})
        assert resp1.status_code == 201

        # Request 2: exact same payload -> replays booking successfully
        resp2 = await client.post("/api/v1/public/bookings", json=payload1, headers={**headers, "Idempotency-Key": idem_key})
        assert resp2.status_code in (200, 201)
        assert resp2.json()["public_ref"] == resp1.json()["public_ref"]

        # Request 3: different payload (different slot time!) with same key -> 409 IDEMPOTENCY_KEY_REUSED
        payload3 = {**payload1, "starts_at_utc": slot2_utc.isoformat()}
        resp3 = await client.post("/api/v1/public/bookings", json=payload3, headers={**headers, "Idempotency-Key": idem_key})
        assert resp3.status_code == 409
        err = resp3.json()
        assert err["code"] == "IDEMPOTENCY_KEY_REUSED" or err.get("detail", {}).get("code") == "IDEMPOTENCY_KEY_REUSED"


@pytest.mark.asyncio
async def test_master_cannot_create_booking_for_another_master():
    """Validates Gate 1 #10: Master is forbidden from creating appointments for other staff members in CRM."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Master (Damir)
        login_m = await client.post("/api/v1/auth/login", json={"email": "damir@barberhouse.kz", "password": "Password123!"})
        m_headers = {"Authorization": f"Bearer {login_m.json()['access_token']}"}

        # Login as Owner to get Erzhan's ID
        login_o = await client.post("/api/v1/auth/login", json={"email": "owner@barberhouse.kz", "password": "Password123!"})
        o_headers = {"Authorization": f"Bearer {login_o.json()['access_token']}"}
        branches = (await client.get("/api/v1/business/branches", headers=o_headers)).json()
        b_id = branches[0]["id"]
        services = (await client.get("/api/v1/business/services", headers=o_headers)).json()
        s_id = services[0]["id"]
        staff_list = (await client.get("/api/v1/business/staff", headers=o_headers)).json()
        erzhan = next(s for s in staff_list if "Ержан" in s["display_name"])
        erzhan_id = erzhan["id"]

        today = datetime.datetime.now(datetime.timezone.utc).date()
        target_day = today + datetime.timedelta(days=20)
        while target_day.isoweekday() not in (1, 2, 3, 4, 5):
            target_day += datetime.timedelta(days=1)
        slot_utc = datetime.datetime.combine(target_day, datetime.time(11, 0), tzinfo=datetime.timezone.utc)

        # Damir attempts to create booking for Erzhan in CRM -> 403 Forbidden!
        crm_resp = await client.post("/api/v1/business/bookings", json={
            "branch_id": b_id,
            "staff_id": erzhan_id,
            "service_ids": [s_id],
            "starts_at_utc": slot_utc.isoformat(),
            "customer_name": "Попытка Чужой Записи",
            "customer_phone": "+77095554433"
        }, headers=m_headers)
        assert crm_resp.status_code == 403


@pytest.mark.asyncio
async def test_plans_catalog_api():
    """Validates Gate 1 #12: Platform plans catalog GET/POST endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        login_p = await client.post("/api/v1/auth/login", json={"email": "owner@platform.example.kz", "password": "Password123!"})
        p_headers = {"Authorization": f"Bearer {login_p.json()['access_token']}"}

        # 1. GET /plans
        plans_resp = await client.get("/api/v1/platform/plans", headers=p_headers)
        assert plans_resp.status_code == 200
        plan_codes = [p["code"] for p in plans_resp.json()]
        assert "start" in plan_codes
        assert "pro" in plan_codes

        # 2. POST /plans (Create Enterprise)
        new_code = f"ent-{uuid.uuid4().hex[:4]}"
        create_p = await client.post("/api/v1/platform/plans", json={
            "code": new_code,
            "name": "Enterprise Plan",
            "description": "Для крупных сетей",
            "price_minor": 5000000,
            "max_branches": 10,
            "max_active_staff": 50
        }, headers=p_headers)
        assert create_p.status_code == 201
        assert create_p.json()["code"] == new_code
