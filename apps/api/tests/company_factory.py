"""Тестовые компании через настоящий онбординг (M02) — каждый тест получает свою, демо-данные не трогаются."""
import datetime as dt
import uuid
import zoneinfo

from httpx import ASGITransport, AsyncClient

from apps.api.app.main import app

ALL_DAYS = range(1, 8)


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


class Company:
    def __init__(self, c, slug, token, tenant_id, branch_id, tz):
        self.c, self.slug, self.h, self.tenant_id, self.branch_id = c, slug, {"Authorization": f"Bearer {token}"}, tenant_id, branch_id
        self.tz = zoneinfo.ZoneInfo(tz)
        self.host = {"Host": f"{slug}.book.example.kz"}

    async def staff(self, name, start, end, price_minor=None, service_id=None):
        r = await self.c.post("/api/v1/business/staff", headers=self.h, json={"display_name": name, "branch_ids": [self.branch_id]})
        assert r.status_code == 201, r.text
        sid = r.json()["id"]
        r = await self.c.put(f"/api/v1/business/staff/{sid}/schedule?branch_id={self.branch_id}", headers=self.h,
                             json={"shifts": [{"weekday_iso": d, "local_start": start, "local_end": end} for d in ALL_DAYS]})
        assert r.status_code == 200, r.text
        return sid

    async def service(self, price_minor, minutes=60):
        r = await self.c.post("/api/v1/business/services", headers=self.h,
                              json={"name": f"Услуга {uuid.uuid4().hex[:4]}", "base_price_minor": price_minor, "base_duration_minutes": minutes})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    async def price(self, staff_id, service_id, price_minor):
        r = await self.c.put(f"/api/v1/business/staff/{staff_id}/services", headers=self.h, json=[
            {"branch_id": self.branch_id, "service_id": service_id, "price_override_minor": price_minor}])
        assert r.status_code == 200, r.text

    async def slots(self, service_id, staff_id, day_from, day_to, mode="specific"):
        body = {"branch_id": self.branch_id, "service_ids": [service_id], "staff_mode": mode,
                "from_date": day_from.isoformat(), "to_date": day_to.isoformat()}
        if staff_id:
            body["staff_id"] = staff_id
        r = await self.c.post("/api/v1/public/availability/search", headers=self.host, json=body)
        assert r.status_code == 200, r.text
        return r.json()["slots"]

    def local(self, slot):
        return dt.datetime.fromisoformat(slot["starts_at_utc"]).astimezone(self.tz)


async def new_company(c, tz) -> Company:
    r = await c.post("/api/v1/auth/login", json={"email": "owner@platform.example.kz", "password": "Password123!"})
    ph = {"Authorization": f"Bearer {r.json()['access_token']}"}
    slug = f"tz-{uuid.uuid4().hex[:8]}"
    r = await c.post("/api/v1/platform/tenants", headers=ph, json={
        "slug": slug, "display_name": f"TZ {slug}", "owner_name": "TZ Owner",
        "owner_email": f"{slug}@example.kz", "plan_code": "start"})
    assert r.status_code == 201, r.text
    tenant_id = r.json()["tenant_id"]
    r = await c.post("/api/v1/auth/accept-invite", json={"token": r.json()["invite_token"], "password": "TzOwner-123"})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    r = await c.post("/api/v1/business/branches", headers=h, json={"name": "Main", "address": "ул. Тестовая 1", "timezone_iana": tz})
    assert r.status_code == 201, r.text
    branch_id = r.json()["id"]
    r = await c.patch("/api/v1/business/booking-settings", headers=h, json={"book_ahead_days": 180, "min_advance_minutes": 0})
    assert r.status_code == 200, r.text
    r = await c.patch("/api/v1/business/booking-publication", headers=h, json={"is_published": True})
    assert r.status_code == 200, r.text
    return Company(c, slug, token, tenant_id, branch_id, tz)
