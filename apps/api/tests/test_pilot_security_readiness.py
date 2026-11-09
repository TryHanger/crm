import pytest
import uuid
import datetime
from httpx import AsyncClient, ASGITransport

from apps.api.app.main import app
from apps.api.app.core.config import Settings, settings
from apps.api.app.infrastructure.security.rate_limiter import limiter
from apps.api.app.infrastructure.observability.logging import sanitize_data
from apps.api.app.modules.notifications.email_service import EmailDeliveryService

@pytest.mark.asyncio
async def test_rate_limiting_enforced_429():
    """Validates that rate limiting returns HTTP 429 when threshold exceeded."""
    limiter.reset()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Enable test rate limit check via header
        headers = {"x-test-rate-limit": "1"}
        
        # Public booking endpoint limit is 25 req/min. Send 26 requests to trigger 429
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
        ADMIN_DB_PASSWORD="real_secure_admin_password_123!"
    )
    with pytest.raises(RuntimeError, match="ENABLE_DEMO_SEED is strictly forbidden"):
        s_bad_seed.validate_environment_security()

    # 2. Staging with default dev JWT secret must fail
    s_bad_jwt = Settings(
        ENVIRONMENT="staging",
        ENABLE_DEMO_SEED=False,
        JWT_SECRET="dev-insecure-jwt-secret-key-change-in-production-1234567890",
        DB_PASSWORD="real_secure_staging_password_123!",
        ADMIN_DB_PASSWORD="real_secure_admin_password_123!"
    )
    with pytest.raises(RuntimeError, match="Insecure or default JWT_SECRET"):
        s_bad_jwt.validate_environment_security()

    # 3. Staging with default DB password must fail
    s_bad_db = Settings(
        ENVIRONMENT="staging",
        ENABLE_DEMO_SEED=False,
        JWT_SECRET="super-secure-production-jwt-secret-minimum-32-chars-long!",
        DB_PASSWORD="crm_app_secret",
        ADMIN_DB_PASSWORD="real_secure_admin_password_123!"
    )
    with pytest.raises(RuntimeError, match="Insecure or default DB_PASSWORD"):
        s_bad_db.validate_environment_security()

    # 4. Valid staging configuration passes cleanly
    s_valid_staging = Settings(
        ENVIRONMENT="staging",
        ENABLE_DEMO_SEED=False,
        JWT_SECRET="a" * 32,
        DB_PASSWORD="custom_prod_db_secret_999",
        ADMIN_DB_PASSWORD="custom_prod_admin_secret_999"
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

    # URL query string redaction
    url = "/activate-platform?token=secret12345&foo=bar"
    assert sanitize_data(url) == "/activate-platform?token=[REDACTED]&foo=bar"

    # Bearer header redaction
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
