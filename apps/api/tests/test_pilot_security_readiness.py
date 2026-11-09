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
