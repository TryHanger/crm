"""Ссылки-приглашения ведут в настоящую CRM; телефон филиала хранится в E.164 или не хранится вовсе.

Найдено при ручной проверке добавления компании (20.11.2026):
- на локальном стенде ссылка владельцу вела на https://app.example.kz, а приглашение сотрудника
  в CRM отдавало относительный путь, который нельзя скопировать и отправить;
- недописанный телефон «+7 (701)» из маски формы сохранялся в филиал как есть.
"""
import uuid

import pytest

from apps.api.app.core.config import Settings, settings
from apps.api.app.modules.onboarding import service as onboarding
from apps.api.tests.company_factory import client, new_company


def test_invite_link_uses_public_crm_url(monkeypatch):
    monkeypatch.setattr(settings, "CRM_PUBLIC_URL", "")
    monkeypatch.setattr(settings, "CRM_DOMAIN", "app.example.kz")
    assert onboarding.invite_url("T") == "https://app.example.kz/accept-invite?token=T"
    monkeypatch.setattr(settings, "CRM_PUBLIC_URL", "http://localhost:3001/")
    assert onboarding.invite_url("T") == "http://localhost:3001/accept-invite?token=T"


@pytest.mark.parametrize("env", ["staging", "production"])
def test_public_crm_url_must_be_https_outside_dev(env):
    s = Settings()
    s.ENVIRONMENT, s.CRM_PUBLIC_URL, s.ENABLE_DEMO_SEED = env, "http://app.example.kz", False
    s.JWT_SECRET = "Zx9-" + "q" * 40
    s.DB_PASSWORD = "Strong-Db-Password-" + "w" * 10
    s.ADMIN_DB_PASSWORD = "Strong-Admin-Password-" + "v" * 10
    s.PLATFORM_IP_ALLOWLIST = ["10.0.0.1"]
    s.CORS_ORIGINS = ["https://app.example.kz"]
    with pytest.raises(RuntimeError, match="CRM_PUBLIC_URL"):
        s.validate_environment_security()


async def test_staff_invite_returns_full_link(monkeypatch):
    monkeypatch.setattr(settings, "CRM_PUBLIC_URL", "http://localhost:3001")
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")
        r = await c.post("/api/v1/business/invites", headers=co.h,
                         json={"email": f"adm-{uuid.uuid4().hex[:6]}@example.kz", "role": "admin"})
        assert r.status_code == 201, r.text
        assert r.json()["invite_url"] == f"http://localhost:3001/accept-invite?token={r.json()['invite_token']}"


async def test_branch_phone_is_e164_or_empty():
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")

        async def create(phone):
            return await c.post("/api/v1/business/branches", headers=co.h, json={
                "name": f"Ф-{uuid.uuid4().hex[:4]}", "address": "пр. Абая 10", "timezone_iana": "Asia/Almaty", "phone": phone})

        r = await create("+7 (701) 12")                  # started but incomplete: refused before plan limits
        assert r.status_code == 422 and r.json()["detail"]["code"] == "PHONE_INVALID"
        bid = co.branch_id
        r = await c.patch(f"/api/v1/business/branches/{bid}", headers=co.h, json={"phone": "+7 (701)"})
        assert r.status_code == 200 and r.json()["phone"] is None          # only the form's mask: no phone
        r = await c.patch(f"/api/v1/business/branches/{bid}", headers=co.h, json={"phone": "8 (701) 123-45-67"})
        assert r.status_code == 200 and r.json()["phone"] == "+77011234567"
        r = await c.patch(f"/api/v1/business/branches/{bid}", headers=co.h, json={"phone": "+7 (701) 999"})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "PHONE_INVALID"
        branch = next(b for b in (await c.get("/api/v1/business/branches", headers=co.h)).json() if b["id"] == bid)
        assert branch["phone"] == "+77011234567"         # a refused update changes nothing
        r = await c.patch(f"/api/v1/business/branches/{bid}", headers=co.h, json={"phone": "+7 (777) 000 11 22"})
        assert r.status_code == 200 and r.json()["phone"] == "+77770001122"
        r = await c.patch(f"/api/v1/business/branches/{bid}", headers=co.h, json={"phone": ""})
        assert r.status_code == 200 and r.json()["phone"] is None
