"""M02-D2: создание компании, приглашение владельца и вход без dev-login.

Проверяем инварианты онбординга:
- компания создаётся атомарно (сбой посередине не оставляет ни tenant, ни пользователя, ни инвайта);
- письмо уходит только после коммита;
- slug — валидная DNS-метка, системные имена и дубли отклоняются, в том числе при гонке;
- ссылка одноразовая, параллельная активация проходит один раз, ошибка ввода ссылку не тратит;
- повторная отправка ротирует ссылку, не создаёт приглашений и не работает после активации;
- просроченное приглашение видно в «Доступах» и перевыпускается;
- при доставленном письме токен не возвращается в ответе API.
"""
import asyncio
import datetime
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from apps.api.app.api.v1.platform import routes as platform_routes
from apps.api.app.core.config import settings
from apps.api.app.main import app
from apps.api.app.modules.notifications.email_service import EmailDeliveryService

PLATFORM_OWNER = {"email": "owner@platform.example.kz", "password": "Password123!"}


def admin_scalar(sql: str, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            return conn.execute(text(sql), params).scalar()
    finally:
        engine.dispose()


def new_company(**over):
    slug = over.pop("slug", f"m02-{uuid.uuid4().hex[:8]}")
    body = {"slug": slug, "display_name": "Салон M02", "vertical": "barbershop",
            "owner_name": "Владелец M02", "owner_email": f"owner-{slug}@example.kz", "plan_code": "start"}
    body.update(over)
    return body


async def platform_headers(client):
    r = await client.post("/api/v1/auth/login", json=PLATFORM_OWNER)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def client(raise_errors=True):
    return AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=raise_errors),
                       base_url="http://testserver")


async def test_create_invite_login_without_dev_login():
    async with client() as c:
        h = await platform_headers(c)
        body = new_company()
        r = await c.post("/api/v1/platform/tenants", json=body, headers=h)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["owner_status"] == "invited" and data["invite_expires_at"]
        tid = data["tenant_id"]

        # всё, что нужно компании, создано вместе
        assert admin_scalar("SELECT count(*) FROM tenant_domains WHERE tenant_id = :t", t=tid) == 1
        assert admin_scalar("SELECT lifecycle_status FROM subscriptions WHERE tenant_id = :t", t=tid) == "trial"
        assert admin_scalar("SELECT status FROM tenant_memberships WHERE tenant_id = :t AND role = 'owner'", t=tid) == "invited"
        assert admin_scalar("SELECT is_published FROM booking_publications WHERE tenant_id = :t", t=tid) is False

        # до активации войти нельзя
        r = await c.post("/api/v1/auth/login", json={"email": body["owner_email"], "password": "OwnerPass123!"})
        assert r.status_code == 401

        r = await c.post("/api/v1/auth/accept-invite", json={"token": data["invite_token"], "password": "OwnerPass123!"})
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "owner"

        r = await c.post("/api/v1/auth/login", json={"email": body["owner_email"], "password": "OwnerPass123!"})
        assert r.status_code == 200 and r.json()["role"] == "owner"
        me = (await c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})).json()
        assert [m["tenant_id"] for m in me["crm_memberships"]] == [tid]


async def test_failure_mid_creation_leaves_nothing(monkeypatch):
    original = platform_routes.record_audit_event

    async def failing_audit(*args, **kwargs):
        if kwargs.get("action") == "tenant.created":
            raise RuntimeError("simulated failure after all rows were added")
        return await original(*args, **kwargs)

    monkeypatch.setattr(platform_routes, "record_audit_event", failing_audit)
    body = new_company()
    async with client(raise_errors=False) as c:
        h = await platform_headers(c)
        r = await c.post("/api/v1/platform/tenants", json=body, headers=h)
    assert r.status_code == 500
    assert admin_scalar("SELECT count(*) FROM tenants WHERE slug = :s", s=body["slug"]) == 0
    assert admin_scalar("SELECT count(*) FROM identity_users WHERE email_normalized = :e", e=body["owner_email"]) == 0
    assert admin_scalar("SELECT count(*) FROM invites WHERE email = :e", e=body["owner_email"]) == 0
    assert admin_scalar("SELECT count(*) FROM tenant_domains WHERE hostname_normalized LIKE :h", h=body["slug"] + ".%") == 0


async def test_invite_email_is_sent_only_after_commit(monkeypatch):
    seen = {}

    async def fake_send(cls, to_email, owner_name, tenant_name, invite_url):
        seen["tenant_rows"] = admin_scalar("SELECT count(*) FROM tenants WHERE display_name = :n", n=tenant_name)
        seen["invite_rows"] = admin_scalar("SELECT count(*) FROM invites WHERE email = :e", e=to_email)
        return {"status": "sent", "provider": "smtp", "message": "ok", "recipient": to_email, "sent": True}

    monkeypatch.setattr(EmailDeliveryService, "send_owner_invite", classmethod(fake_send))
    async with client() as c:
        h = await platform_headers(c)
        body = new_company(display_name=f"Commit check {uuid.uuid4().hex[:6]}")
        r = await c.post("/api/v1/platform/tenants", json=body, headers=h)
    assert r.status_code == 201, r.text
    assert seen == {"tenant_rows": 1, "invite_rows": 1}


@pytest.mark.parametrize("slug,code", [
    ("my_salon", "SLUG_INVALID"),
    ("ab", "SLUG_INVALID"),
    ("-salon", "SLUG_INVALID"),
    ("salon--x", "SLUG_INVALID"),
    ("салон", "SLUG_INVALID"),
    ("admin", "SLUG_RESERVED"),
    ("api", "SLUG_RESERVED"),
])
async def test_slug_rules(slug, code):
    async with client() as c:
        h = await platform_headers(c)
        body = new_company(slug=slug)
        r = await c.post("/api/v1/platform/tenants", json=body, headers=h)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == code
    assert admin_scalar("SELECT count(*) FROM identity_users WHERE email_normalized = :e", e=body["owner_email"]) == 0


async def test_unknown_plan_and_duplicate_slug_rejected():
    async with client() as c:
        h = await platform_headers(c)
        r = await c.post("/api/v1/platform/tenants", json=new_company(plan_code="no-such-plan"), headers=h)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "PLAN_NOT_FOUND"

        r = await c.post("/api/v1/platform/tenants", json=new_company(slug="barberhouse"), headers=h)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "SLUG_TAKEN"


async def test_parallel_creation_of_same_slug_gives_one_company():
    slug = f"race-{uuid.uuid4().hex[:8]}"
    async with client() as c:
        h = await platform_headers(c)
        bodies = [new_company(slug=slug, owner_email=f"o{i}-{slug}@example.kz") for i in range(6)]
        results = await asyncio.gather(*[c.post("/api/v1/platform/tenants", json=b, headers=h) for b in bodies])
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 1, codes
    assert all(code == 409 for code in codes if code != 201), codes
    assert admin_scalar("SELECT count(*) FROM tenants WHERE slug = :s", s=slug) == 1
    assert admin_scalar("SELECT count(*) FROM invites i JOIN tenants t ON t.id = i.tenant_id WHERE t.slug = :s", s=slug) == 1


async def test_link_is_single_use_even_under_parallel_acceptance():
    async with client() as c:
        h = await platform_headers(c)
        body = new_company()
        token = (await c.post("/api/v1/platform/tenants", json=body, headers=h)).json()["invite_token"]
        results = await asyncio.gather(*[
            c.post("/api/v1/auth/accept-invite", json={"token": token, "password": f"Parallel-{i}-Pass"})
            for i in range(5)
        ])
        codes = sorted(r.status_code for r in results)
        assert codes.count(200) == 1, codes
        assert set(codes) - {200} <= {400}, codes

        again = await c.post("/api/v1/auth/accept-invite", json={"token": token, "password": "Another-Pass-1"})
        assert again.status_code == 400
        assert "уже использовано" in again.json()["detail"]

    winner = next(i for i, r in enumerate(results) if r.status_code == 200)
    async with client() as c:
        r = await c.post("/api/v1/auth/login", json={"email": body["owner_email"], "password": f"Parallel-{winner}-Pass"})
        assert r.status_code == 200
    assert admin_scalar(
        "SELECT count(*) FROM tenant_memberships m JOIN identity_users u ON u.id = m.user_id "
        "WHERE u.email_normalized = :e AND m.status = 'active'", e=body["owner_email"]) == 1


async def test_failed_activation_does_not_burn_the_link():
    async with client() as c:
        h = await platform_headers(c)
        body = new_company()
        token = (await c.post("/api/v1/platform/tenants", json=body, headers=h)).json()["invite_token"]
        r = await c.post("/api/v1/auth/accept-invite", json={"token": token})  # пароль не задан
        assert r.status_code == 400
        r = await c.post("/api/v1/auth/accept-invite", json={"token": token, "password": "short"})
        assert r.status_code == 422
        r = await c.post("/api/v1/auth/accept-invite", json={"token": token, "password": "FinallyGood-1"})
        assert r.status_code == 200, r.text


async def test_resend_rotates_link_and_never_grants_new_access():
    async with client() as c:
        h = await platform_headers(c)
        body = new_company()
        created = (await c.post("/api/v1/platform/tenants", json=body, headers=h)).json()
        tid, old_token = created["tenant_id"], created["invite_token"]

        r = await c.post(f"/api/v1/platform/tenants/{tid}/resend-invite", json={"email": body["owner_email"]}, headers=h)
        assert r.status_code == 200, r.text
        new_token = r.json()["invite_token"]
        assert new_token and new_token != old_token

        r = await c.post("/api/v1/auth/accept-invite", json={"token": old_token, "password": "OldLink-Pass-1"})
        assert r.status_code == 400, "старая ссылка должна перестать работать"

        # адрес без приглашения: 404, и никакой роли он не получает
        stranger = f"stranger-{uuid.uuid4().hex[:6]}@example.kz"
        r = await c.post(f"/api/v1/platform/tenants/{tid}/resend-invite", json={"email": stranger}, headers=h)
        assert r.status_code == 404 and r.json()["detail"]["code"] == "INVITE_NOT_FOUND"
        assert admin_scalar("SELECT count(*) FROM invites WHERE email = :e", e=stranger) == 0

        r = await c.post(f"/api/v1/platform/tenants/{uuid.uuid4()}/resend-invite", json={"email": body["owner_email"]}, headers=h)
        assert r.status_code == 404 and r.json()["detail"]["code"] == "TENANT_NOT_FOUND"

        r = await c.post("/api/v1/auth/accept-invite", json={"token": new_token, "password": "NewLink-Pass-1"})
        assert r.status_code == 200

        # после активации повторная отправка не выдаёт нерабочую ссылку
        r = await c.post(f"/api/v1/platform/tenants/{tid}/resend-invite", json={"email": body["owner_email"]}, headers=h)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "INVITE_ALREADY_ACCEPTED"
        r = await c.post("/api/v1/auth/login", json={"email": body["owner_email"], "password": "NewLink-Pass-1"})
        assert r.status_code == 200


async def test_expired_invite_is_listed_and_can_be_reissued():
    async with client() as c:
        h = await platform_headers(c)
        body = new_company()
        created = (await c.post("/api/v1/platform/tenants", json=body, headers=h)).json()
        tid, token = created["tenant_id"], created["invite_token"]
        admin_scalar("UPDATE invites SET expires_at = now() - interval '1 minute' WHERE tenant_id = :t RETURNING 1", t=tid)

        r = await c.post("/api/v1/auth/accept-invite", json={"token": token, "password": "Expired-Pass-1"})
        assert r.status_code == 400 and "истёк" in r.json()["detail"]

        users = (await c.get(f"/api/v1/platform/tenants/{tid}/users", headers=h)).json()
        assert [(i["email"], i["status"]) for i in users["invites"]] == [(body["owner_email"], "expired")]

        r = await c.post(f"/api/v1/platform/tenants/{tid}/resend-invite", json={"email": body["owner_email"]}, headers=h)
        assert r.status_code == 200
        users = (await c.get(f"/api/v1/platform/tenants/{tid}/users", headers=h)).json()
        assert [i["status"] for i in users["invites"]] == ["pending"]
        r = await c.post("/api/v1/auth/accept-invite", json={"token": r.json()["invite_token"], "password": "Reissued-Pass-1"})
        assert r.status_code == 200


async def test_delivered_invite_does_not_expose_token(monkeypatch):
    async def delivered(cls, to_email, owner_name, tenant_name, invite_url):
        return {"status": "sent", "provider": "smtp", "message": "ok", "recipient": to_email, "sent": True}

    monkeypatch.setattr(EmailDeliveryService, "send_owner_invite", classmethod(delivered))
    async with client() as c:
        h = await platform_headers(c)
        # production-like environment only for the onboarding decision (keeps the IP allowlist out of the test)
        from apps.api.app.modules.onboarding import service as onboarding

        class StagingSettings:
            ENVIRONMENT = "staging"

            def __getattr__(self, name):
                return getattr(settings, name)

        monkeypatch.setattr(onboarding, "settings", StagingSettings())
        body = new_company()
        r = await c.post("/api/v1/platform/tenants", json=body, headers=h)
        assert r.status_code == 201, r.text
        assert r.json()["invite_token"] is None and r.json()["invite_url"] is None
        r = await c.post(f"/api/v1/platform/tenants/{r.json()['tenant_id']}/resend-invite",
                         json={"email": body["owner_email"]}, headers=h)
        assert r.status_code == 200
        assert r.json()["invite_token"] is None and r.json()["invite_url"] is None


async def test_owner_email_markup_is_escaped(monkeypatch):
    captured = {}

    async def capture(cls, to_email, subject, html_content):
        captured["html"] = html_content
        return {"status": "sent"}

    monkeypatch.setattr(EmailDeliveryService, "is_smtp_configured", staticmethod(lambda: True))
    monkeypatch.setattr(EmailDeliveryService, "_dispatch_smtp_with_retries", classmethod(capture))
    await EmailDeliveryService.send_owner_invite(
        to_email="x@example.kz", owner_name="<script>alert(1)</script>",
        tenant_name="<b>Evil</b>", invite_url='https://app.example.kz/accept-invite?token=a"b')
    assert "<script>" not in captured["html"] and "&lt;script&gt;" in captured["html"]
    assert "<b>Evil</b>" not in captured["html"]
