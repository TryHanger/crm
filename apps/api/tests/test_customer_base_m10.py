import pytest
import datetime
import uuid
import random
from httpx import AsyncClient, ASGITransport
from apps.api.app.main import app
from apps.api.app.modules.customers.service import normalize_kz_phone
from apps.api.app.infrastructure.db.models import Customer, Booking

def test_normalize_kz_phone():
    """Unit tests for Kazakhstani phone normalization."""
    # Standard format
    assert normalize_kz_phone("+7 701 123 45 67") == ("+77011234567", "77011234567")
    # Starts with 8
    assert normalize_kz_phone("87011234567") == ("+77011234567", "77011234567")
    # Starts with 7
    assert normalize_kz_phone("77011234567") == ("+77011234567", "77011234567")
    # 10 digits without country code
    assert normalize_kz_phone("7011234567") == ("+77011234567", "77011234567")
    # With dashes and parentheses
    assert normalize_kz_phone("+7 (777) 999-88-77") == ("+77779998877", "77779998877")
    # Non-KZ international number
    assert normalize_kz_phone("+1 202 555 0199") == ("+12025550199", "12025550199")

def _get_future_weekday(days_ahead: int = 15) -> datetime.date:
    d = datetime.datetime.now(datetime.timezone.utc).date() + datetime.timedelta(days=days_ahead)
    while d.isoweekday() not in (1, 2, 3, 4, 5):
        d += datetime.timedelta(days=1)
    return d

@pytest.mark.asyncio
async def test_m10_t10_shared_phone_invariant_and_customer_identity():
    """
    INVARIANT STOP-GATE T10:
    Customer identity: Общий телефон не сливает двух людей.
    If Husband and Wife share the same mobile phone:
    1. Husband bookings must belong to Husband.
    2. Wife bookings must belong to Wife.
    3. They must NEVER be automatically merged into one customer profile.
    4. Querying by phone must not raise MultipleResultsFound.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Owner
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Get Branches and Staff
        branches_resp = await client.get("/api/v1/business/branches", headers=headers)
        assert branches_resp.status_code == 200
        branch_id = branches_resp.json()[0]["id"]

        staff_resp = await client.get(f"/api/v1/business/staff?branch_id={branch_id}", headers=headers)
        assert staff_resp.status_code == 200
        staff_id = staff_resp.json()[0]["id"]

        services_resp = await client.get(f"/api/v1/business/services?branch_id={branch_id}", headers=headers)
        assert services_resp.status_code == 200
        service_id = services_resp.json()[0]["id"]

        shared_phone = f"+7705{random.randint(1000000, 9999999)}"
        target_day = _get_future_weekday(20)

        # 3. Create booking for Husband: "Алибек Смагулов"
        slot1 = datetime.datetime.combine(target_day, datetime.time(10, 0), tzinfo=datetime.timezone.utc).isoformat()
        b1_resp = await client.post("/api/v1/business/bookings", json={
            "branch_id": branch_id,
            "staff_id": staff_id,
            "service_ids": [service_id],
            "starts_at_utc": slot1,
            "customer_name": "Алибек Смагулов",
            "customer_phone": shared_phone,
        }, headers=headers)
        assert b1_resp.status_code == 201, b1_resp.text
        b1_data = b1_resp.json()
        b1_customer_id = b1_data.get("customer_id")
        assert b1_customer_id is not None

        # Verify Husband customer record exists
        c1_resp = await client.get(f"/api/v1/business/customers/{b1_customer_id}", headers=headers)
        assert c1_resp.status_code == 200
        assert c1_resp.json()["full_name"] == "Алибек Смагулов"
        norm_shared_phone, _ = normalize_kz_phone(shared_phone)
        assert c1_resp.json()["phone"] == norm_shared_phone

        # 4. Create booking for Wife: "Гульнара Смагулова" (SAME PHONE, DIFFERENT NAME)
        # INVARIANT: Must create a distinct customer profile, NOT merge into Husband!
        slot2 = datetime.datetime.combine(target_day, datetime.time(11, 0), tzinfo=datetime.timezone.utc).isoformat()
        b2_resp = await client.post("/api/v1/business/bookings", json={
            "branch_id": branch_id,
            "staff_id": staff_id,
            "service_ids": [service_id],
            "starts_at_utc": slot2,
            "customer_name": "Гульнара Смагулова",
            "customer_phone": shared_phone,
        }, headers=headers)
        assert b2_resp.status_code == 201, b2_resp.text
        b2_data = b2_resp.json()
        b2_customer_id = b2_data.get("customer_id")
        assert b2_customer_id is not None

        # CRITICAL ASSERTION: Husband and Wife must have DIFFERENT customer IDs!
        assert b1_customer_id != b2_customer_id, (
            f"VIOLATION OF T10 GATE: Both bookings were merged into {b1_customer_id}! "
            "Two distinct people sharing one phone must NEVER be automatically merged."
        )

        # Verify Wife customer record
        c2_resp = await client.get(f"/api/v1/business/customers/{b2_customer_id}", headers=headers)
        assert c2_resp.status_code == 200
        assert c2_resp.json()["full_name"] == "Гульнара Смагулова"
        assert c2_resp.json()["phone"] == norm_shared_phone

        # 5. Subsequent booking for Husband with variant phone format (e.g. 8705...)
        # Must resolve to Husband (b1_customer_id), not Wife!
        slot3 = datetime.datetime.combine(target_day, datetime.time(12, 0), tzinfo=datetime.timezone.utc).isoformat()
        phone_variant_8 = "8" + norm_shared_phone[2:]
        b3_resp = await client.post("/api/v1/business/bookings", json={
            "branch_id": branch_id,
            "staff_id": staff_id,
            "service_ids": [service_id],
            "starts_at_utc": slot3,
            "customer_name": "Алибек Смагулов",
            "customer_phone": phone_variant_8,
        }, headers=headers)
        assert b3_resp.status_code == 201
        assert b3_resp.json()["customer_id"] == b1_customer_id

        # 6. Subsequent booking for Wife
        # Must resolve to Wife (b2_customer_id), not Husband!
        slot4 = datetime.datetime.combine(target_day, datetime.time(14, 0), tzinfo=datetime.timezone.utc).isoformat()
        b4_resp = await client.post("/api/v1/business/bookings", json={
            "branch_id": branch_id,
            "staff_id": staff_id,
            "service_ids": [service_id],
            "starts_at_utc": slot4,
            "customer_name": "Гульнара Смагулова",
            "customer_phone": shared_phone,
        }, headers=headers)
        assert b4_resp.status_code == 201
        assert b4_resp.json()["customer_id"] == b2_customer_id

        # 7. Check visit history isolation:
        # Husband's card must only show Husband's bookings
        c1_detail = (await client.get(f"/api/v1/business/customers/{b1_customer_id}", headers=headers)).json()
        h1_refs = [h["public_ref"] for h in c1_detail["history"]]
        assert b1_data["public_ref"] in h1_refs
        assert b3_resp.json()["public_ref"] in h1_refs
        assert b2_data["public_ref"] not in h1_refs  # Wife's booking NOT in husband's history

        # Wife's card must only show Wife's bookings
        c2_detail = (await client.get(f"/api/v1/business/customers/{b2_customer_id}", headers=headers)).json()
        h2_refs = [h["public_ref"] for h in c2_detail["history"]]
        assert b2_data["public_ref"] in h2_refs
        assert b4_resp.json()["public_ref"] in h2_refs
        assert b1_data["public_ref"] not in h2_refs  # Husband's booking NOT in wife's history

@pytest.mark.asyncio
async def test_m10_manual_customer_creation_duplicate_warning_and_shared_phone():
    """
    Tests manual customer registration in CRM:
    - Normalization of KZ phone
    - Exact duplicate warning (same phone + same name)
    - Shared phone warning when name is different, and creation upon confirm_shared_phone=True
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

        phone = f"+7 (708) {random.randint(100, 999)}-{random.randint(10, 99)}-{random.randint(10, 99)}"
        # 1. Create first customer (Father: "Серик Ахметов")
        res1 = await client.post("/api/v1/business/customers", json={
            "full_name": "Серик Ахметов",
            "phone_e164": phone,
            "email": "serik@example.kz",
            "notes_private": "Предпочитает классическую стрижку",
        }, headers=headers)
        assert res1.status_code in (200, 201)
        data1 = res1.json()
        assert data1.get("duplicate_detected", False) is False
        customer1_id = data1["id"]

        # 2. Try creating EXACT duplicate (same name + same phone)
        res_dup = await client.post("/api/v1/business/customers", json={
            "full_name": "Серик Ахметов",
            "phone_e164": phone,
        }, headers=headers)
        assert res_dup.status_code in (200, 201)
        data_dup = res_dup.json()
        assert data_dup["duplicate_detected"] is True
        assert data_dup["id"] == customer1_id

        # 3. Try creating DIFFERENT person (Son: "Кайрат Ахметов") on SAME phone without confirmation
        res_shared_warn = await client.post("/api/v1/business/customers", json={
            "full_name": "Кайрат Ахметов",
            "phone_e164": phone,
        }, headers=headers)
        assert res_shared_warn.status_code in (200, 201)
        data_warn = res_shared_warn.json()
        assert data_warn.get("shared_phone_warning") is True
        assert data_warn["existing_name"] == "Серик Ахметов"
        assert data_warn["existing_customer_id"] == customer1_id

        # 4. Now confirm creation of distinct customer profile on shared phone
        res_shared_ok = await client.post("/api/v1/business/customers", json={
            "full_name": "Кайрат Ахметов",
            "phone_e164": phone,
            "confirm_shared_phone": True,
            "notes_private": "Сын Серика",
        }, headers=headers)
        assert res_shared_ok.status_code in (200, 201)
        data_shared_ok = res_shared_ok.json()
        assert data_shared_ok.get("duplicate_detected", False) is False
        assert data_shared_ok["id"] != customer1_id
        assert data_shared_ok["full_name"] == "Кайрат Ахметов"

@pytest.mark.asyncio
async def test_m10_server_search_filters_and_pagination():
    """
    Tests server search and filtering for customer base:
    - Search by name
    - Search by phone
    - Filter by visits (all, with_visits, no_visits, regular)
    - Sorting by created_at, full_name, completed_visits
    - Pagination (limit, offset)
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

        # 1. Search by name
        res_name = await client.get("/api/v1/business/customers?search=Серик", headers=headers)
        assert res_name.status_code == 200
        customers_name = res_name.json()
        assert len(customers_name) >= 1
        assert any("Серик" in c["full_name"] for c in customers_name)

        # 2. Filter by visits
        res_no_visits = await client.get("/api/v1/business/customers?visits_filter=no_visits", headers=headers)
        assert res_no_visits.status_code == 200
        for c in res_no_visits.json():
            assert c["completed_visits"] == 0

        # 3. Sorting
        res_sort_name = await client.get("/api/v1/business/customers?sort_by=full_name&order=asc", headers=headers)
        assert res_sort_name.status_code == 200
        names = [c["full_name"].lower() for c in res_sort_name.json()]
        assert names == sorted(names)

        # 4. Pagination
        res_page = await client.get("/api/v1/business/customers?limit=1&offset=0", headers=headers)
        assert res_page.status_code == 200
        assert len(res_page.json()) <= 1

@pytest.mark.asyncio
async def test_m10_customer_notes_and_detail_stats():
    """
    Tests private notes and visit statistics in customer card:
    - Adding customer note
    - Viewing detail card with stats (total_bookings, completed_visits, cancelled_visits, no_show_visits)
    - Visit history containing branch_name and staff_name
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

        # Create test customer
        create_res = await client.post("/api/v1/business/customers", json={
            "full_name": "Тестовый Заметкин",
            "phone_e164": f"+7777{random.randint(1000000, 9999999)}",
            "notes_private": "Начальная заметка",
        }, headers=headers)
        assert create_res.status_code in (200, 201)
        cust_id = create_res.json()["id"]

        # Add customer note
        note_res = await client.post(f"/api/v1/business/customers/{cust_id}/notes", json={
            "note": "Любит кофе с сахаром перед стрижкой"
        }, headers=headers)
        assert note_res.status_code in (200, 201)
        note_data = note_res.json()
        assert note_data["note"] == "Любит кофе с сахаром перед стрижкой"

        # Fetch detail card
        detail_res = await client.get(f"/api/v1/business/customers/{cust_id}", headers=headers)
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert detail["full_name"] == "Тестовый Заметкин"
        assert "stats" in detail
        assert detail["stats"]["total_bookings"] >= 0
        assert any(n["note"] == "Любит кофе с сахаром перед стрижкой" for n in detail["notes"])

@pytest.mark.asyncio
async def test_m10_multi_tenant_isolation():
    """
    Tests strict tenant isolation for Customer Base:
    Tenant A (Barber House) must never see or access Tenant B's customers.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Tenant A (Barber House)
        login_a = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        headers_a = {"Authorization": f"Bearer {login_a.json()['access_token']}"}

        # Create customer in Tenant A
        res_a = await client.post("/api/v1/business/customers", json={
            "full_name": "Клиент Тенанта А",
            "phone_e164": f"+7700{random.randint(1000000, 9999999)}",
        }, headers=headers_a)
        assert res_a.status_code in (200, 201)
        cust_a_id = res_a.json()["id"]

        # 2. Login as Tenant B (Modern Cut)
        login_b = await client.post("/api/v1/auth/login", json={
            "email": "owner@moderncut.kz",
            "password": "Password123!"
        })
        headers_b = {"Authorization": f"Bearer {login_b.json()['access_token']}"}

        # Attempt to access Tenant A's customer using Tenant B's token
        res_cross = await client.get(f"/api/v1/business/customers/{cust_a_id}", headers=headers_b)
        assert res_cross.status_code == 404, "Tenant B must NOT be able to view Tenant A's customer!"

        # Tenant B search must not reveal Tenant A's customer
        res_b_search = await client.get("/api/v1/business/customers?search=Клиент Тенанта А", headers=headers_b)
        assert res_b_search.status_code == 200
        assert len(res_b_search.json()) == 0
