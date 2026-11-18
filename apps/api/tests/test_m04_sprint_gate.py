import pytest
import datetime
import uuid
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from apps.api.app.main import app
from apps.api.app.infrastructure.db.models import (
    Service,
    ServiceCategory,
    Branch,
    Tenant
)
from apps.api.app.infrastructure.db.session import set_tenant_context

@pytest.mark.asyncio
async def test_m04_gate_catalog_update_and_branch_separation(db_session):
    """
    SPRINT M04 GATE ACCEPTANCE TEST:
    T04 · M04 · Catalog update: Цена 8000 появляется публично.
    Демо / приёмка:
    - Владелец самостоятельно заводит филиал и реально доступные услуги.
    - Владелец создал услугу за 8000 KZT, клиент видит её в своём филиале.
    - Нельзя выпускать, если: Формы сохраняют только UI-состояние или нет разделения филиалов.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Barber House Owner
        login_resp = await client.post("/api/v1/auth/login", json={
            "email": "owner@barberhouse.kz",
            "password": "Password123!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Get current tenant info
        me_resp = await client.get("/api/v1/auth/me", headers=headers)
        assert me_resp.status_code == 200
        me_data = me_resp.json()
        tenant_id = me_data["crm_memberships"][0]["tenant_id"]
        tenant_headers = {**headers, "X-Tenant-ID": tenant_id}

        # 3. Get Existing Branches and Update Branch Details (City, Address, Weekly Hours)
        branches_resp = await client.get("/api/v1/business/branches", headers=tenant_headers)
        assert branches_resp.status_code == 200
        branches = branches_resp.json()
        assert len(branches) > 0
        main_branch_id = branches[0]["id"]

        patch_br_resp = await client.patch(
            f"/api/v1/business/branches/{main_branch_id}",
            json={
                "name": "Barber House Центр (Достык)",
                "city": "Астана",
                "address": "пр. Достык, 16, ЖК Премиум",
                "phone": "+7 701 555 01 23",
                "timezone_iana": "Asia/Almaty"
            },
            headers=tenant_headers
        )
        assert patch_br_resp.status_code == 200, f"Branch patch failed: {patch_br_resp.text}"
        updated_br = patch_br_resp.json()
        assert updated_br["city"] == "Астана"
        assert updated_br["address"] == "пр. Достык, 16, ЖК Премиум"

        # 4. Create Category (M04 Categories Form)
        cat_resp = await client.post("/api/v1/business/service-categories", json={
            "name": "Премиум уход M04",
            "sort_order": 1
        }, headers=tenant_headers)
        assert cat_resp.status_code == 201, f"Category create failed: {cat_resp.text}"
        category = cat_resp.json()
        category_id = category["id"]

        # Rename Category (Edit category test)
        patch_cat_resp = await client.patch(f"/api/v1/business/service-categories/{category_id}", json={
            "name": "Премиум уход и бритьё M04"
        }, headers=tenant_headers)
        assert patch_cat_resp.status_code == 200
        assert patch_cat_resp.json()["name"] == "Премиум уход и бритьё M04"

        # 5. Create Service with Price 8 000 KZT (800 000 minor units) and Duration 45 min
        svc_name = f"Королевское бритьё M04-{uuid.uuid4().hex[:6]}"
        svc_payload = {
            "name": svc_name,
            "description": "Традиционное бритьё опасной бритвой с распариванием горячими полотенцами",
            "base_price_minor": 800000,  # 8 000 KZT
            "base_duration_minutes": 45,  # 45 минут
            "category_id": category_id,
            "active": True,
            "online_visible": True
        }
        create_svc_resp = await client.post("/api/v1/business/services", json=svc_payload, headers=tenant_headers)
        assert create_svc_resp.status_code == 201, f"Service create failed: {create_svc_resp.text}"
        svc_data = create_svc_resp.json()
        svc_id = svc_data["id"]
        assert svc_data["name"] == svc_name
        assert svc_data["base_price_minor"] == 800000
        assert svc_data["base_duration_minutes"] == 45

        # 6. Verify DB Persistence with strict RLS (NOT just UI state!)
        await set_tenant_context(db_session, uuid.UUID(tenant_id))
        db_svc_res = await db_session.execute(select(Service).where(Service.id == uuid.UUID(svc_id)))
        db_svc = db_svc_res.scalar_one()
        assert db_svc is not None
        assert db_svc.name == svc_name
        assert db_svc.base_price_minor == 800000
        assert db_svc.base_duration_minutes == 45
        assert db_svc.currency == "KZT"
        assert db_svc.active is True
        assert db_svc.online_visible is True

        # 7. T04 GATE: Public Client requests Catalog without rebuild
        # Host: barberhouse.book.example.kz
        pub_headers = {"Host": "barberhouse.book.example.kz"}
        pub_services_resp = await client.get("/api/v1/public/services", headers=pub_headers)
        assert pub_services_resp.status_code == 200, f"Public services failed: {pub_services_resp.text}"
        pub_services = pub_services_resp.json()

        # Find our newly created service
        target_pub_svc = next((s for s in pub_services if s["id"] == svc_id), None)
        assert target_pub_svc is not None, "Created service MUST appear publicly in catalog immediately without manual rebuild!"
        assert target_pub_svc["base_price_minor"] == 800000
        assert target_pub_svc["price_formatted"] == "8 000 ₸"
        assert target_pub_svc["base_duration_minutes"] == 45
        assert target_pub_svc["category_name"] == "Премиум уход и бритьё M04"

        # 8. Check Branch details in public API
        pub_branches_resp = await client.get("/api/v1/public/branches", headers=pub_headers)
        assert pub_branches_resp.status_code == 200
        pub_branches = pub_branches_resp.json()
        main_pub_branch = next((b for b in pub_branches if b["id"] == main_branch_id), None)
        assert main_pub_branch is not None
        assert main_pub_branch["city"] == "Астана"
        assert main_pub_branch["address"] == "пр. Достык, 16, ЖК Премиум"

        # 9. Verify Multi-Tenant Isolation: Modern Cut public site cannot see Barber House service
        mc_pub_headers = {"Host": "moderncut.book.example.kz"}
        mc_services_resp = await client.get("/api/v1/public/services", headers=mc_pub_headers)
        assert mc_services_resp.status_code == 200
        mc_services = mc_services_resp.json()
        assert not any(s["id"] == svc_id for s in mc_services), "Barber House service must NEVER leak to Modern Cut!"
