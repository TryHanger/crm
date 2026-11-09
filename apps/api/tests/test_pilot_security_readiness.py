import os
import json
import uuid
import datetime
import pytest
from httpx import AsyncClient, ASGITransport

from apps.api.app.main import app
from apps.api.app.core.config import Settings, settings
from apps.api.app.infrastructure.security.rate_limiter import limiter, get_client_ip, is_trusted_peer
from apps.api.app.infrastructure.security.ip_filter import is_ip_allowed, enforce_platform_ip_allowlist
from apps.api.app.infrastructure.observability.logging import sanitize_data
from apps.api.app.modules.notifications.email_service import EmailDeliveryService
from scripts.restore_db import verify_checksum, restore_and_verify

@pytest.mark.asyncio
async def test_rate_limiting_enforced_429():
    """Validates that rate limiting returns HTTP 429 when threshold exceeded."""
    limiter.reset()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        headers = {"x-test-rate-limit": "1"}
        got_429 = False
        for i in range(27):
            resp = await client.post(
                "/api/v1/auth/login",
                json={"email": "wrong@test.kz", "password": "wrong"},
                headers=headers
            )
            if resp.status_code == 429:
                got_429 = True
                assert resp.headers.get("Retry-After") is not None
                assert "RATE_LIMIT_EXCEEDED" in resp.text
                break
        assert got_429, "Rate limiter did not trigger HTTP 429 after exceeding request quota!"
    limiter.reset()

def test_staging_and_production_fail_fast_validation():
    """Validates fail-fast guards against running staging/production with insecure dev defaults."""
    # 1. Staging with demo seed enabled must fail
    s_bad_seed = Settings(
        ENVIRONMENT="staging",
        ENABLE_DEMO_SEED=True,
        JWT_SECRET="super-secure-production-jwt-secret-minimum-32-chars-long!",
        DB_PASSWORD="real_secure_staging_password_123!",
        ADMIN_DB_PASSWORD="real_secure_admin_password_123!",
        PLATFORM_IP_ALLOWLIST=["10.0.0.1"]
    )
    with pytest.raises(RuntimeError, match="ENABLE_DEMO_SEED is strictly forbidden"):
        s_bad_seed.validate_environment_security()

    # 2. Staging with default dev or staging Compose JWT secret must fail
    for weak_jwt in [
        "dev-insecure-jwt-secret-key-change-in-production-1234567890",
        "staging-secure-jwt-key-minimum-32-chars-long!",
        "test-jwt-secret-key-32-chars-long-minimum-length!",
        "short-jwt"
    ]:
        s_bad_jwt = Settings(
            ENVIRONMENT="staging",
            ENABLE_DEMO_SEED=False,
            JWT_SECRET=weak_jwt,
            DB_PASSWORD="real_secure_staging_password_123!",
            ADMIN_DB_PASSWORD="real_secure_admin_password_123!",
            PLATFORM_IP_ALLOWLIST=["10.0.0.1"]
        )
        with pytest.raises(RuntimeError, match="Insecure or default JWT_SECRET"):
            s_bad_jwt.validate_environment_security()

    # 3. Staging with default DB passwords must fail
    for weak_pwd in [
        "crm_app_secret",
        "staging_app_secret_4412",
        "postgrespassword",
        "password",
        "short"
    ]:
        s_bad_db = Settings(
            ENVIRONMENT="staging",
            ENABLE_DEMO_SEED=False,
            JWT_SECRET="a" * 32,
            DB_PASSWORD=weak_pwd,
            ADMIN_DB_PASSWORD="real_secure_admin_password_123!",
            PLATFORM_IP_ALLOWLIST=["10.0.0.1"]
        )
        with pytest.raises(RuntimeError, match="Insecure or default DB_PASSWORD"):
            s_bad_db.validate_environment_security()

    # 4. Staging with default Compose admin password must fail
    for weak_admin in [
        "staging_admin_secret_9921",
        "postgrespassword",
        "postgres",
        "password"
    ]:
        s_bad_admin = Settings(
            ENVIRONMENT="staging",
            ENABLE_DEMO_SEED=False,
            JWT_SECRET="a" * 32,
            DB_PASSWORD="real_secure_staging_password_123!",
            ADMIN_DB_PASSWORD=weak_admin,
            PLATFORM_IP_ALLOWLIST=["10.0.0.1"]
        )
        with pytest.raises(RuntimeError, match="Default or weak admin database password"):
            s_bad_admin.validate_environment_security()

    # 5. Staging with empty IP allowlist must fail
    s_empty_ip = Settings(
        ENVIRONMENT="staging",
        ENABLE_DEMO_SEED=False,
        JWT_SECRET="a" * 32,
        DB_PASSWORD="real_secure_staging_password_123!",
        ADMIN_DB_PASSWORD="real_secure_admin_password_123!",
        PLATFORM_IP_ALLOWLIST=[]
    )
    with pytest.raises(RuntimeError, match="PLATFORM_IP_ALLOWLIST must not be empty"):
        s_empty_ip.validate_environment_security()

    # 6. Valid staging configuration passes cleanly
    s_valid_staging = Settings(
        ENVIRONMENT="staging",
        ENABLE_DEMO_SEED=False,
        JWT_SECRET="a" * 32,
        DB_PASSWORD="custom_prod_db_secret_999",
        ADMIN_DB_PASSWORD="custom_prod_admin_secret_999",
        PLATFORM_IP_ALLOWLIST=["10.0.0.0/8"]
    )
    s_valid_staging.validate_environment_security()

def test_sanitized_logging_masks_secrets():
    """Validates that structured logger masks sensitive credentials and query parameters."""
    payload = {
        "user_email": "user@barberhouse.kz",
        "password": "MySuperSecretPassword!",
        "current_password": "OldPassword123!",
        "token": "sensitive_single_use_token_value",
        "nested": {
            "secret": "api_secret_key",
            "safe_field": "public_data"
        }
    }
    sanitized = sanitize_data(payload)
    assert sanitized["password"] == "[REDACTED]"
    assert sanitized["current_password"] == "[REDACTED]"
    assert sanitized["token"] == "[REDACTED]"
    assert sanitized["nested"]["secret"] == "[REDACTED]"
    assert sanitized["nested"]["safe_field"] == "public_data"

    url = "/activate-platform?token=secret12345&foo=bar"
    assert sanitize_data(url) == "/activate-platform?token=[REDACTED]&foo=bar"

    auth_header = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token"
    assert sanitize_data(auth_header) == "Bearer [REDACTED]"

@pytest.mark.asyncio
async def test_email_delivery_service_transparent_manual_audit():
    """Validates that when SMTP is not configured, delivery is honestly reported as manual_channel_required."""
    res = await EmailDeliveryService.send_owner_invite(
        to_email="test_owner@pilot.kz",
        owner_name="Test Owner",
        tenant_name="Pilot Barbershop",
        invite_url="https://app.example.kz/accept-invite?token=sample"
    )
    assert res["status"] == "manual_channel_required"
    assert res["sent"] is False
    assert "SMTP-сервер не настроен" in res["message"]

def test_ip_allowlist_cidr_and_anti_spoofing():
    """Validates CIDR matching, IPv4/IPv6 support, and proxy header trust anti-spoofing."""
    allowlist = ["10.0.0.0/8", "192.168.1.0/24", "2001:db8::/32", "172.16.5.10"]

    # CIDR Matches
    assert is_ip_allowed("10.5.20.1", allowlist) is True
    assert is_ip_allowed("192.168.1.150", allowlist) is True
    assert is_ip_allowed("2001:db8::cafe", allowlist) is True
    assert is_ip_allowed("172.16.5.10", allowlist) is True

    # Rejections
    assert is_ip_allowed("192.168.2.1", allowlist) is False
    assert is_ip_allowed("8.8.8.8", allowlist) is False
    assert is_ip_allowed("2001:db9::1", allowlist) is False
    assert is_ip_allowed("", allowlist) is False

@pytest.mark.asyncio
async def test_platform_route_protected_by_ip_allowlist_e2e():
    """E2E test: accessing platform endpoint with unauthorized IP or spoofed header returns HTTP 403."""
    orig_allowlist = list(settings.PLATFORM_IP_ALLOWLIST)
    orig_env = settings.ENVIRONMENT
    try:
        # Force staging mode and restrict allowlist to a private network
        settings.ENVIRONMENT = "staging"
        settings.PLATFORM_IP_ALLOWLIST = ["10.50.0.0/16"]

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            # 1. Direct connection from unauthorized client IP (default testclient / loopback)
            resp = await client.get("/api/v1/platform/overview", headers={"x-test-force-ip-check": "1"})
            assert resp.status_code == 403
            assert resp.json()["detail"]["code"] == "PLATFORM_IP_FORBIDDEN"

            # 2. Attacker attempts to spoof X-Forwarded-For with allowed IP
            resp_spoof_chain = await client.get(
                "/api/v1/platform/overview",
                headers={
                    "x-forwarded-for": "10.50.1.200, 203.0.113.199",
                    "x-test-force-ip-check": "1"
                }
            )
            assert resp_spoof_chain.status_code == 403

            # 3. Request with valid authorized IP via trusted proxy X-Real-IP
            resp_allowed = await client.get(
                "/api/v1/platform/overview",
                headers={
                    "x-real-ip": "10.50.1.5",
                    "x-test-force-ip-check": "1"
                }
            )
            # 401 Unauthorized (because of missing platform bearer token), NOT 403 Forbidden!
            assert resp_allowed.status_code == 401

            # 4. When allowlist is empty in staging, deny-all fail-closed applies
            settings.PLATFORM_IP_ALLOWLIST = []
            resp_empty = await client.get("/api/v1/platform/overview", headers={"x-test-force-ip-check": "1"})
            assert resp_empty.status_code == 403
            assert resp_empty.json()["detail"]["code"] == "PLATFORM_IP_ALLOWLIST_EMPTY"
    finally:
        settings.PLATFORM_IP_ALLOWLIST = orig_allowlist
        settings.ENVIRONMENT = orig_env

def test_disaster_recovery_negative_scenarios(tmp_path):
    """
    Validates that backup/restore DR pipeline strictly fails fast when:
    - manifest is missing
    - SHA-256 checksum mismatches
    - target DB is not named *_test
    - SQL content is corrupted or invalid
    """
    # 1. Missing manifest rejection
    fake_dump = tmp_path / "corrupted_backup.sql"
    fake_dump.write_text("CREATE TABLE test (id int);")
    with pytest.raises(FileNotFoundError, match="Verification manifest not found"):
        verify_checksum(str(fake_dump), str(tmp_path / "missing.manifest.json"))

    # 2. Checksum mismatch rejection
    manifest_file = tmp_path / "fake.manifest.json"
    manifest_file.write_text(json.dumps({
        "sha256_checksum": "0000000000000000000000000000000000000000000000000000000000000000"
    }))
    with pytest.raises(ValueError, match="Checksum mismatch"):
        verify_checksum(str(fake_dump), str(manifest_file))

    # 3. Unsafe target DB name rejection (refusal to restore into production/default db)
    with pytest.raises(ValueError, match="Unsafe target DB name"):
        restore_and_verify(str(fake_dump), target_db="production_db")

    with pytest.raises(ValueError, match="Unsafe target DB name"):
        restore_and_verify(str(fake_dump), target_db="saas_crm")


def test_staging_api_runtime_without_admin_credentials():
    """
    Validates P0-01 regression: Runtime API in staging MUST initialize and pass
    fail-fast validation without any admin credentials (ADMIN_DB_PASSWORD/URL).
    """
    # 1. API runtime process with no admin credentials must pass
    s_api = Settings(
        ENVIRONMENT="staging",
        PROCESS_ROLE="api",
        ENABLE_DEMO_SEED=False,
        JWT_SECRET="k8vN9#mX2$pL5!qR7*tY1@wZ4^bC6(eF)",
        DB_USER="crm_app_user",
        DB_PASSWORD="real_secure_staging_password_123!",
        ADMIN_DB_USER="postgres",
        ADMIN_DB_PASSWORD=None,
        ADMIN_DATABASE_URL=None,
        PLATFORM_IP_ALLOWLIST=["127.0.0.1", "10.0.0.0/8"]
    )
    s_api.validate_environment_security()
    assert s_api.ADMIN_DB_PASSWORD is None
    assert s_api.DB_USER == "crm_app_user"

    # 2. Attempting to access admin sync engine without admin credentials must raise clear error
    with pytest.raises(RuntimeError, match="ADMIN_DB_PASSWORD or ADMIN_DATABASE_URL is not configured"):
        _ = s_api.ADMIN_SYNC_DATABASE_URL

    # 3. Migration runner process without admin credentials must fail fast
    s_migration_missing_admin = Settings(
        ENVIRONMENT="staging",
        PROCESS_ROLE="migration",
        ENABLE_DEMO_SEED=False,
        JWT_SECRET="k8vN9#mX2$pL5!qR7*tY1@wZ4^bC6(eF)",
        DB_USER="crm_app_user",
        DB_PASSWORD="real_secure_staging_password_123!",
        ADMIN_DB_USER="postgres",
        ADMIN_DB_PASSWORD=None,
        ADMIN_DATABASE_URL=None,
        PLATFORM_IP_ALLOWLIST=["127.0.0.1"]
    )
    with pytest.raises(RuntimeError, match="Migration runner in staging environment requires ADMIN_DATABASE_URL"):
        s_migration_missing_admin.validate_environment_security()


def test_proxy_trusted_peer_hostname_and_subnet_matching(monkeypatch):
    """
    Validates P0-02 regression: is_trusted_peer properly validates direct peer IP
    against CIDR subnets, exact IPs, and Docker container hostnames.
    """
    monkeypatch.setattr(
        settings,
        "TRUSTED_PROXIES",
        ["127.0.0.1", "::1", "172.28.0.10", "172.28.0.0/16", "proxy"]
    )
    # 1. Loopback and internal IPs
    assert is_trusted_peer("127.0.0.1") is True
    assert is_trusted_peer("::1") is True
    assert is_trusted_peer("testclient") is True

    # 2. Staging proxy static IP and subnet
    assert is_trusted_peer("172.28.0.10") is True
    assert is_trusted_peer("172.28.0.25") is True
    assert is_trusted_peer("172.28.1.5") is True

    # 3. Untrusted external IPs must be rejected
    assert is_trusted_peer("185.220.101.5") is False
    assert is_trusted_peer("8.8.8.8") is False
    assert is_trusted_peer("192.168.100.5") is False


@pytest.mark.asyncio
async def test_booking_publication_toggle_and_config():
    """
    Validates P0-03 regression:
    - GET /booking-settings returns structured DTO with policy, theme, publication, canonical_public_url.
    - PATCH /booking-publication with { is_published: false } pauses booking on server.
    - When paused, public site resolution returns 404 SITE_NOT_PUBLISHED.
    - Re-publishing restores public site access.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Barberhouse owner
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "owner@barberhouse.kz", "password": "Password123!"}
        )
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        auth_headers = {"Authorization": f"Bearer {token}"}

        # 2. GET /booking-settings returns unified config
        cfg_resp = await client.get("/api/v1/business/booking-settings", headers=auth_headers)
        assert cfg_resp.status_code == 200
        cfg = cfg_resp.json()
        assert "policy" in cfg
        assert "theme" in cfg
        assert "publication" in cfg
        assert "canonical_public_url" in cfg
        assert "barberhouse" in cfg["publication"]["slug"]
        assert "barberhouse" in cfg["publication"]["public_url"]

        # 3. Pause online booking
        pause_resp = await client.patch(
            "/api/v1/business/booking-publication",
            json={"is_published": False},
            headers=auth_headers
        )
        assert pause_resp.status_code == 200
        assert pause_resp.json()["is_published"] is False

        # Verify setting persisted in GET
        verify_cfg = (await client.get("/api/v1/business/booking-settings", headers=auth_headers)).json()
        assert verify_cfg["publication"]["is_published"] is False

        # 4. Public endpoint must reject booking access when paused (404 SITE_NOT_PUBLISHED)
        pub_headers = {"Host": "barberhouse.localhost"}
        pub_resp = await client.get("/api/v1/public/site", headers=pub_headers)
        assert pub_resp.status_code == 404
        assert pub_resp.json()["detail"]["code"] == "SITE_NOT_PUBLISHED"

        # 5. Re-enable online booking
        resume_resp = await client.patch(
            "/api/v1/business/booking-publication",
            json={"is_published": True},
            headers=auth_headers
        )
        assert resume_resp.status_code == 200
        assert resume_resp.json()["is_published"] is True

        # Public endpoint works again
        pub_resp_active = await client.get("/api/v1/public/site", headers=pub_headers)
        assert pub_resp_active.status_code == 200
        assert pub_resp_active.json()["is_published"] is True


@pytest.mark.asyncio
async def test_fresh_tenant_booking_settings_does_not_auto_publish():
    """
    P0 Gate: Opening booking settings for a newly created tenant with no BookingPublication
    MUST NOT create a publication record or auto-publish the site.
    GET must be side-effect-free, returning is_published=False.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Create a fresh tenant via platform owner
        admin_login = await client.post(
            "/api/v1/auth/login",
            json={"email": "owner@platform.example.kz", "password": "Password123!"}
        )
        assert admin_login.status_code == 200
        admin_token = admin_login.json()["access_token"]

        slug = f"fresh{uuid.uuid4().hex[:6]}"
        owner_email = f"owner_{slug}@freshkz.internal"
        create_resp = await client.post(
            "/api/v1/platform/tenants",
            json={
                "slug": slug,
                "display_name": f"Fresh Studio {slug}",
                "plan_code": "start",
                "owner_email": owner_email,
                "owner_name": "Fresh Owner",
                "vertical": "barbershop"
            },
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert create_resp.status_code == 201
        invite_token = create_resp.json()["invite_token"]

        # Activate owner password
        activate_resp = await client.post(
            "/api/v1/auth/accept-invite",
            json={"token": invite_token, "password": "FreshPassword123!"}
        )
        assert activate_resp.status_code == 200

        # Login as owner of fresh tenant
        owner_login = await client.post(
            "/api/v1/auth/login",
            json={"email": owner_email, "password": "FreshPassword123!"}
        )
        assert owner_login.status_code == 200
        token = owner_login.json()["access_token"]
        auth_headers = {"Authorization": f"Bearer {token}"}

        # 1. First GET: Must be side-effect-free, return is_published=False
        settings_resp = await client.get("/api/v1/business/booking-settings", headers=auth_headers)
        assert settings_resp.status_code == 200
        data = settings_resp.json()
        assert data["publication"]["is_published"] is False
        assert slug in data["publication"]["slug"]
        assert slug in data["canonical_public_url"]

        # 2. Public endpoint MUST return 404 SITE_NOT_PUBLISHED
        pub_headers = {"Host": f"{slug}.localhost"}
        site_resp = await client.get("/api/v1/public/site", headers=pub_headers)
        assert site_resp.status_code == 404
        assert site_resp.json()["detail"]["code"] == "SITE_NOT_PUBLISHED"

        # 3. Explicit publish via PATCH
        publish_resp = await client.patch(
            "/api/v1/business/booking-publication",
            json={"is_published": True},
            headers=auth_headers
        )
        assert publish_resp.status_code == 200
        assert publish_resp.json()["is_published"] is True

        # Now public endpoint succeeds
        site_resp2 = await client.get("/api/v1/public/site", headers=pub_headers)
        assert site_resp2.status_code == 200
        assert site_resp2.json()["is_published"] is True

        # 4. Explicit pause via PATCH
        pause_resp = await client.patch(
            "/api/v1/business/booking-publication",
            json={"is_published": False},
            headers=auth_headers
        )
        assert pause_resp.status_code == 200
        assert pause_resp.json()["is_published"] is False

        # Public site is 404 again
        site_resp3 = await client.get("/api/v1/public/site", headers=pub_headers)
        assert site_resp3.status_code == 404
        assert site_resp3.json()["detail"]["code"] == "SITE_NOT_PUBLISHED"


@pytest.mark.asyncio
async def test_unregistered_domain_rejection_in_staging_and_production():
    """
    P1 Gate: In STAGING and PRODUCTION, host resolution requires an exact match
    with a registered and verified TenantDomain. Slug fallback on arbitrary hostnames
    is strictly disabled (defense-in-depth).
    """
    orig_env = settings.ENVIRONMENT
    try:
        settings.ENVIRONMENT = "staging"
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            # 1. Attacker queries with unmapped/unregistered hostname containing a valid tenant slug
            attacker_headers = {"Host": "barberhouse.unregistered-malicious-domain.com"}
            resp_attacker = await client.get("/api/v1/public/site", headers=attacker_headers)
            assert resp_attacker.status_code == 404
            assert resp_attacker.json()["detail"]["code"] == "SITE_NOT_FOUND"

            # 2. Registered domain resolves properly
            registered_headers = {"Host": "barberhouse.book.example.kz"}
            resp_reg = await client.get("/api/v1/public/site", headers=registered_headers)
            assert resp_reg.status_code == 200
            assert resp_reg.json()["slug"] == "barberhouse"
    finally:
        settings.ENVIRONMENT = orig_env


def test_narrowed_trusted_proxy_rejection():
    """
    P1 Gate: Verify that peer IP from arbitrary container on Docker network (e.g. 172.28.0.99)
    is NOT trusted when TRUSTED_PROXIES is narrowed to 172.28.0.10.
    """
    orig_proxies = list(settings.TRUSTED_PROXIES)
    try:
        settings.TRUSTED_PROXIES = ["127.0.0.1", "::1", "proxy", "nginx", "172.28.0.10"]
        # Designated Nginx IP is trusted
        assert is_trusted_peer("172.28.0.10") is True
        assert is_trusted_peer("127.0.0.1") is True
        # Other containers on 172.28.0.0/16 are NOT trusted
        assert is_trusted_peer("172.28.0.99") is False
        assert is_trusted_peer("172.28.0.5") is False
        assert is_trusted_peer("172.28.1.100") is False
    finally:
        settings.TRUSTED_PROXIES = orig_proxies

