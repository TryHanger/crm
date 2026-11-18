"""M16-D2: выпускная конфигурация продакшена и мониторинг проверяются автотестом, а не глазами.

- nginx: все хосты на TLS с HSTS, ACME на 80, нет имён стенда, нет `if`;
- compose: production без демо-данных и Mailpit, БД не опубликована наружу, воркер и бэкап есть;
- .env.production.example: перечислены все обязательные переменные compose, секреты пустые;
- monitor_check: пороги сертификата и возраста бэкапа, код выхода.
"""
import datetime as dt
import re
import sys
from pathlib import Path

NL = chr(10)
ROOT = Path(__file__).resolve().parents[3]
PROD = ROOT / "deploy" / "production"
sys.path.insert(0, str(ROOT))

from scripts import monitor_check as mc  # noqa: E402
from scripts.s3_client import S3Config  # noqa: E402


def render_nginx():
    raw = (PROD / "nginx" / "default.conf.template").read_text(encoding="utf-8")
    env = {"ROOT_DOMAIN": "example.kz", "BOOKING_ROOT": "book.example.kz", "BOOKING_ROOT_REGEX": r"book\.example\.kz"}
    return re.sub(r"\$\{([A-Z_]+)\}", lambda m: env[m.group(1)], raw)


def test_nginx_template_tls_everywhere():
    conf = render_nginx()
    assert "${" not in conf and "staging" not in conf
    assert re.search(r"\bif\s*\(", conf) is None
    servers = re.split(r"\nserver \{", conf)[1:]
    tls = [s for s in servers if "listen 443 ssl" in s]
    assert len(tls) == 5
    for s in tls:
        assert "ssl_certificate " in s and "ssl_certificate_key " in s
    for name in ("console.example.kz", "app.example.kz", "api.example.kz", r"\.book\.example\.kz$"):
        block = next(s for s in tls if name in s)
        assert "Strict-Transport-Security" in block, name
    plain = next(s for s in servers if "listen 80 default_server" in s)
    assert "/.well-known/acme-challenge/" in plain and "return 301 https://$host$request_uri" in plain
    assert "ssl_protocols TLSv1.2 TLSv1.3" in conf
    # each host exposes only its own API group (the API enforces the same, host_policy)
    console = next(s for s in tls if "server_name console." in s)
    assert "/api/v1/business/" not in console and "/api/v1/platform/" in console
    crm = next(s for s in tls if "server_name app." in s)
    assert "/api/v1/platform/" not in crm and "/api/v1/business/" in crm
    booking = next(s for s in tls if 'server_name "~^' in s)
    assert "/api/v1/public/" in booking and "/api/v1/business/" not in booking


def compose_services():
    """Top-level service blocks of the production compose file (no YAML dependency in CI)."""
    text = (PROD / "docker-compose.production.yml").read_text(encoding="utf-8")
    anchor, rest = text.split(NL + "services:" + NL, 1)
    body = rest.split(NL + "volumes:" + NL, 1)[0]
    parts = re.split(r"^  ([a-z][a-z0-9-]*):$", body, flags=re.M)[1:]
    return anchor, dict(zip(parts[0::2], parts[1::2]))


def test_production_compose_is_production():
    anchor, services = compose_services()
    assert {"postgres", "migrate", "api", "outbox-worker", "frontend", "proxy", "certbot", "backup"} <= set(services)
    assert "mailpit" not in services
    assert "ports:" not in services["postgres"], "PostgreSQL must not be published"
    assert "ENVIRONMENT: production" in anchor and 'ENABLE_DEMO_SEED: "false"' in anchor
    assert "SMTP_SECURITY: ${SMTP_SECURITY:-starttls}" in anchor
    for name in ("migrate", "api", "outbox-worker", "backup"):
        assert "<<: *app-env" in services[name], name
    assert '"python", "scripts/outbox_worker.py"' in services["outbox-worker"]
    assert 'profiles: ["ops"]' in services["backup"] and "--drill" not in services["backup"]
    assert "/health/ready" in services["api"]


def test_env_example_lists_every_required_variable_without_values():
    text = (PROD / "docker-compose.production.yml").read_text(encoding="utf-8")
    required = set(re.findall(r"\$\{([A-Z_]+):\?", text))
    example = {}
    for line in (PROD / ".env.production.example").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            example[k] = v
    assert required - set(example) == set(), required - set(example)
    for secret in ("POSTGRES_PASSWORD", "DB_PASSWORD", "JWT_SECRET_KEY", "SMTP_PASSWORD", "BACKUP_ENCRYPTION_KEY",
                   "OFFSITE_S3_SECRET_KEY", "INITIAL_PLATFORM_OWNER_PASSWORD"):
        assert example[secret] == "", f"{secret} must be empty in the example"
    assert example["SMTP_SECURITY"] == "starttls"


def test_monitor_thresholds_and_exit_code():
    assert mc.classify_tls("a", 30).status == mc.OK
    assert mc.classify_tls("a", 10).status == mc.WARN
    assert mc.classify_tls("a", 3).status == mc.CRIT
    assert mc.classify_tls("a", None, "invalid certificate").status == mc.CRIT
    now = dt.datetime(2026, 11, 18, 12, tzinfo=dt.timezone.utc)
    assert mc.classify_backup(now - dt.timedelta(hours=25), now).status == mc.OK
    assert mc.classify_backup(now - dt.timedelta(hours=27), now).status == mc.CRIT
    assert mc.classify_backup(None, now).status == mc.CRIT
    ok, warn, crit = mc.Check("x", mc.OK, ""), mc.Check("y", mc.WARN, ""), mc.Check("z", mc.CRIT, "")
    assert (mc.exit_code([ok]), mc.exit_code([ok, warn]), mc.exit_code([warn, crit])) == (0, 1, 2)


def test_s3_config_never_prints_the_secret(monkeypatch):
    for k in ("OFFSITE_S3_ENDPOINT", "OFFSITE_S3_BUCKET", "OFFSITE_S3_ACCESS_KEY", "OFFSITE_S3_SECRET_KEY"):
        monkeypatch.delenv(k, raising=False)
    assert S3Config.from_env() is None
    monkeypatch.setenv("OFFSITE_S3_ENDPOINT", "https://s3.example.kz/")
    monkeypatch.setenv("OFFSITE_S3_BUCKET", "b")
    monkeypatch.setenv("OFFSITE_S3_ACCESS_KEY", "AKIDEXAMPLE")
    monkeypatch.setenv("OFFSITE_S3_SECRET_KEY", "very-secret-value")
    cfg = S3Config.from_env()
    assert cfg.endpoint == "https://s3.example.kz" and cfg.prefix == "crm/"
    assert "very-secret-value" not in repr(cfg) and "very-secret-value" not in str(cfg)
