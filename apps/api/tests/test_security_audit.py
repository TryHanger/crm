"""M16-D2: аудит безопасности перед выпуском MVP.

- каждая таблица с tenant_id либо под принудительным RLS, либо в явном списке платформенных таблиц
  с причиной; новая таблица без решения роняет тест;
- runtime-роль БД не суперпользователь и не обходит RLS, без контекста компании не видит ничего;
- ни один маршрут CRM и платформы не отвечает без входа;
- мастер не открывает ни одного денежного, отчётного или административного маршрута.
"""
import re
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.app.infrastructure.db.init_db import TENANT_TABLES
from apps.api.app.main import app
from apps.api.tests.company_factory import client

# tables that carry tenant_id but are read before a tenant context exists (login, host resolution,
# platform console, billing, the cross-tenant outbox worker). Access is enforced in the application.
PLATFORM_LEVEL = {
    "tenant_memberships": "login resolves memberships before the tenant is known",
    "tenant_domains": "host -> tenant resolution runs before the tenant is known",
    "invites": "an invite is accepted by a user who is not a member yet",
    "subscriptions": "platform billing (Platform Console)",
    "subscription_charges": "platform billing",
    "subscription_decisions": "platform billing",
    "payment_records": "platform billing payments (not salon money)",
    "tenant_entitlement_overrides": "plan limits managed by the platform",
    "platform_alerts": "platform console",
    "platform_support_tickets": "platform console",
    "support_access_requests": "owner consent flow between platform and tenant",
    "support_access_sessions": "platform support sessions",
    "idempotency_records": "public idempotency keys are claimed before tenant context; keys are tenant-scoped in queries",
    "outbox_events": "the notification worker claims events across tenants, then sets tenant context per event",
}


def admin_sql(q, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            return conn.execute(text(q), params).fetchall()
    finally:
        engine.dispose()


def test_every_tenant_table_is_rls_forced_or_explicitly_platform_level():
    rows = admin_sql("""
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%app.current_tenant%') AS has_policy
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM information_schema.columns col
                      WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id')""")
    tables = {r[0]: r[1:] for r in rows}
    undecided = set(tables) - set(TENANT_TABLES) - set(PLATFORM_LEVEL)
    assert not undecided, f"tenant tables without an RLS decision: {sorted(undecided)}"
    missing = [t for t in TENANT_TABLES if t not in tables]
    assert not missing, f"TENANT_TABLES lists tables that do not exist: {missing}"
    weak = [t for t in TENANT_TABLES if tables[t] != (True, True, True)]
    assert not weak, f"RLS not enabled+forced with a tenant policy: {weak}"
    assert not set(TENANT_TABLES) & set(PLATFORM_LEVEL)


def test_runtime_role_cannot_bypass_rls():
    [(superuser, bypass)] = admin_sql("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = :r", r=settings.DB_USER)
    assert superuser is False and bypass is False
    owners = admin_sql("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = :r", r=settings.DB_USER)
    assert owners == [], "the runtime role must not own tables"

    engine = create_engine(settings.SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            for table in ("bookings", "customers", "ledger_entries", "cash_shifts", "notification_deliveries"):
                assert conn.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 0, table
            assert conn.execute(text("SELECT count(*) FROM branches")).scalar() == 0
            tenants = admin_sql("SELECT tenant_id FROM branches GROUP BY tenant_id ORDER BY tenant_id LIMIT 2")
            assert len(tenants) == 2, "seed must contain two companies"
            conn.execute(text("SELECT set_config('app.current_tenant', :t, true)"), {"t": str(tenants[0][0])})
            assert conn.execute(text("SELECT count(*) FROM branches")).scalar() > 0
            assert conn.execute(text("SELECT count(*) FROM branches WHERE tenant_id = :o"), {"o": str(tenants[1][0])}).scalar() == 0
    finally:
        engine.dispose()


def _routes(prefix):
    for r in app.routes:
        path = getattr(r, "path", "")
        if path.startswith(prefix):
            for m in sorted(getattr(r, "methods", []) - {"HEAD", "OPTIONS"}):
                yield m, re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)


# public by design: the operator sets a password with a one-time activation token
PUBLIC_BY_DESIGN = {("POST", "/api/v1/platform/staff/activate")}


async def test_no_crm_or_platform_route_answers_without_login():
    routes = [r for r in list(_routes("/api/v1/business/")) + list(_routes("/api/v1/platform/")) if r not in PUBLIC_BY_DESIGN]
    assert len(routes) > 100
    bad = []
    async with client() as c:
        for method, path in routes:
            r = await c.request(method, path, json={} if method in ("POST", "PUT", "PATCH") else None)
            if r.status_code not in (401, 403):
                bad.append((method, path, r.status_code))
    assert not bad, f"answered without login: {bad[:10]}"


MASTER_FORBIDDEN = re.compile(r"/(cash-accounts|payments|refunds|advances?|apply-advance|ledger-entries|cash-shifts|expenses|"
                              r"expense-categories|reports|notification-[a-z]+|invites|users|billing|subscription)\b")


async def test_master_is_denied_every_money_report_and_admin_route():
    async with client() as c:
        r = await c.post("/api/v1/auth/login", json={"email": "damir@barberhouse.kz", "password": "Password123!"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        targets = [(m, p) for m, p in _routes("/api/v1/business/") if MASTER_FORBIDDEN.search(p)]
        assert len(targets) >= 25
        allowed = []
        for method, path in targets:
            r = await c.request(method, path, headers=h, json={} if method in ("POST", "PUT", "PATCH") else None)
            if r.status_code != 403:
                allowed.append((method, path, r.status_code))
        assert not allowed, f"master reached: {allowed}"


@pytest.mark.parametrize("env", ["staging", "production"])
def test_plain_smtp_refused_in_production(env, monkeypatch):
    from apps.api.app.core.config import Settings
    monkeypatch.setenv("ENVIRONMENT", env)
    s = Settings()
    s.ENVIRONMENT, s.SMTP_HOST, s.SMTP_SECURITY = env, "smtp.example.kz", "none"
    s.ENABLE_DEMO_SEED = False
    s.JWT_SECRET = "Zx9-" + "q" * 40
    s.DB_PASSWORD = "Strong-Db-Password-" + "w" * 10
    s.ADMIN_DB_PASSWORD = "Strong-Admin-Password-" + "v" * 10
    s.PLATFORM_IP_ALLOWLIST = ["10.0.0.1"]
    s.CORS_ORIGINS = ["https://app.example.kz"]
    if env == "production":
        with pytest.raises(RuntimeError, match="SMTP_SECURITY=none"):
            s.validate_environment_security()
    else:
        try:
            s.validate_environment_security()
        except RuntimeError as e:
            assert "SMTP_SECURITY" not in str(e)
