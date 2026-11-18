"""M03-D2: домены и публикация.

- каждый домен обслуживает только свою группу API (строгий режим, как в staging/production);
- неизвестный Host не обслуживается как существующая компания;
- X-Forwarded-Host принимается только от доверенного прокси;
- системная ссылка открывает только свою компанию, пауза публикации блокирует новую запись.
"""
import datetime
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request

from apps.api.app.core.config import settings
from apps.api.app.infrastructure.domain_resolution import host_policy
from apps.api.app.main import app

BOOK = settings.BOOKING_DOMAIN_SUFFIX if settings.BOOKING_DOMAIN_SUFFIX.startswith(".") else f".{settings.BOOKING_DOMAIN_SUFFIX}"
BH = f"barberhouse{BOOK}"
MC = f"moderncut{BOOK}"
CRM = settings.CRM_DOMAIN
CONSOLE = settings.PLATFORM_DOMAIN
API = settings.API_DOMAIN
DEMO = {"email": "owner@barberhouse.kz", "password": "Password123!"}


@pytest.fixture
def strict(monkeypatch):
    monkeypatch.setattr(settings, "STRICT_HOST_ROUTING", True)


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


@pytest.mark.parametrize("host,path,allowed", [
    (BH, "/api/v1/public/site", True),
    (BH, "/api/v1/auth/login", False),
    (BH, "/api/v1/business/branches", False),
    (BH, "/api/v1/platform/overview", False),
    (CRM, "/api/v1/auth/login", True),
    (CRM, "/api/v1/business/branches", True),
    (CRM, "/api/v1/platform/overview", False),
    (CRM, "/api/v1/public/site", False),
    (CONSOLE, "/api/v1/platform/overview", True),
    (CONSOLE, "/api/v1/auth/login", True),
    (CONSOLE, "/api/v1/business/branches", False),
    (CONSOLE, "/api/v1/public/site", False),
    (API, "/api/v1/business/branches", True),
    (API, "/api/v1/platform/overview", True),
    (API, "/api/v1/public/site", False),
    ("evil.example.com", "/api/v1/public/site", False),
    ("evil.example.com", "/api/v1/auth/login", False),
    (f"a.b{BOOK}", "/api/v1/public/site", False),   # не одна метка
    (f"-x{BOOK}", "/api/v1/public/site", False),
    ("localhost", "/api/v1/public/site", False),    # localhost только вне строгого режима
    ("barberhouse.localhost", "/api/v1/public/site", False),
    ("evil.example.com", "/health/live", True),     # пробы балансировщика
    (BH, "/docs", False),
    (API, "/openapi.json", True),
])
def test_host_group_matrix_strict(host, path, allowed):
    assert (host_policy.check(host, path, strict=True) is None) is allowed


def test_local_hosts_allowed_only_outside_strict():
    for host in ("localhost", "127.0.0.1", "barberhouse.localhost", "testserver"):
        assert host_policy.check(host, "/api/v1/business/branches", strict=False) is None
        assert host_policy.check(host, "/api/v1/business/branches", strict=True) is not None


def test_hostname_normalization():
    n = host_policy.normalize_hostname
    assert n("BarberHouse.Book.Example.KZ:443") == "barberhouse.book.example.kz"
    assert n(f"{BH}.") == BH
    assert n("[::1]:8000") == "::1"
    assert n("") == ""


def _request(headers, client_ip):
    scope = {"type": "http", "method": "GET", "path": "/", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
             "client": (client_ip, 50000), "query_string": b""}
    return Request(scope)


def test_forwarded_host_trusted_only_from_proxy(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    spoof = {"host": "evil.example.com", "x-forwarded-host": BH}
    assert host_policy.request_hostname(_request(spoof, "203.0.113.7")) == "evil.example.com"
    assert host_policy.request_hostname(_request(spoof, "127.0.0.1")) == BH


async def test_strict_routing_end_to_end(strict):
    async with client() as c:
        r = await c.get("/api/v1/public/site", headers={"Host": BH})
        assert r.status_code == 200 and r.json()["slug"] == "barberhouse"
        r = await c.get("/api/v1/public/site", headers={"Host": MC})
        assert r.status_code == 200 and r.json()["slug"] == "moderncut"

        # неизвестный салон под системным суффиксом: resolver, не «первая попавшаяся» компания
        r = await c.get("/api/v1/public/site", headers={"Host": f"no-such-{uuid.uuid4().hex[:6]}{BOOK}"})
        assert r.status_code == 404 and r.json()["detail"]["code"] == "SITE_NOT_FOUND"

        # чужой домен
        r = await c.get("/api/v1/public/site", headers={"Host": "evil.example.com"})
        assert r.status_code == 404 and r.json()["code"] == "HOST_NOT_ALLOWED"

        # с сайта записи нельзя достучаться до CRM/платформы
        r = await c.post("/api/v1/auth/login", json=DEMO, headers={"Host": BH})
        assert r.status_code == 404 and r.json()["code"] == "ROUTE_NOT_AVAILABLE_ON_HOST"

        r = await c.post("/api/v1/auth/login", json=DEMO, headers={"Host": CRM})
        assert r.status_code == 200
        token = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = await c.get("/api/v1/business/branches", headers={**token, "Host": CRM})
        assert r.status_code == 200
        r = await c.get("/api/v1/business/branches", headers={**token, "Host": BH})
        assert r.status_code == 404
        r = await c.get("/api/v1/public/site", headers={"Host": CRM})
        assert r.status_code == 404

        r = await c.get("/health/live", headers={"Host": "evil.example.com"})
        assert r.status_code == 200


async def test_publication_pause_blocks_new_bookings(strict):
    async with client() as c:
        login = await c.post("/api/v1/auth/login", json=DEMO, headers={"Host": CRM})
        h = {"Authorization": f"Bearer {login.json()['access_token']}", "Host": CRM}
        branches = (await c.get("/api/v1/public/branches", headers={"Host": BH})).json()
        services = (await c.get("/api/v1/public/services", headers={"Host": BH})).json()
        staff = (await c.get(f"/api/v1/public/staff?branch_id={branches[0]['id']}&service_ids={services[0]['id']}",
                             headers={"Host": BH})).json()
        today = datetime.datetime.now(datetime.timezone.utc).date()
        search = {"branch_id": branches[0]["id"], "service_ids": [services[0]["id"]], "staff_id": staff[0]["id"],
                  "staff_mode": "specific", "from_date": (today + datetime.timedelta(days=20)).isoformat(),
                  "to_date": (today + datetime.timedelta(days=24)).isoformat()}
        slot = (await c.post("/api/v1/public/availability/search", json=search, headers={"Host": BH})).json()["slots"][0]
        booking = {"branch_id": branches[0]["id"], "staff_id": staff[0]["id"], "service_ids": [services[0]["id"]],
                   "starts_at_utc": slot["starts_at_utc"], "customer_name": "Пауза Тест",
                   "customer_phone": "+77010000077", "expected_price_minor": slot["price_minor"]}
        try:
            r = await c.patch("/api/v1/business/booking-publication", json={"is_published": False}, headers=h)
            assert r.status_code == 200 and r.json()["is_published"] is False

            r = await c.get("/api/v1/public/site", headers={"Host": BH})
            assert r.status_code == 404 and r.json()["detail"]["code"] == "SITE_NOT_PUBLISHED"
            r = await c.post("/api/v1/public/bookings", json=booking,
                             headers={"Host": BH, "Idempotency-Key": f"pause-{uuid.uuid4()}"})
            assert r.status_code == 404, r.text
            # пауза одной компании не трогает другую
            r = await c.get("/api/v1/public/site", headers={"Host": MC})
            assert r.status_code == 200
        finally:
            r = await c.patch("/api/v1/business/booking-publication", json={"is_published": True}, headers=h)
            assert r.status_code == 200 and r.json()["is_published"] is True

        r = await c.get("/api/v1/public/site", headers={"Host": BH})
        assert r.status_code == 200
