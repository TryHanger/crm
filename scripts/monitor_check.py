"""Мониторинг продакшена (M16): одна проверка — одна строка, код выхода для cron / uptime-сервиса.

  python scripts/monitor_check.py --api https://api.example.kz --hosts app.example.kz,demo.book.example.kz
  python scripts/monitor_check.py --json          # машиночитаемый вывод

Проверки:
  api_ready        GET /health/ready = 200 и база доступна
  tls:<host>       сертификат действителен; < 14 дней — WARN, < 7 — CRIT
  outbox_backlog   письма в очереди дольше 15 мин (нужен ADMIN_DATABASE_URL); > 0 — WARN, > 50 — CRIT
  outbox_failed    письма со статусом failed за 24 ч; > 0 — WARN
  backup_age       последний offsite-бэкап (OFFSITE_S3_*); старше 26 ч — CRIT
Код выхода: 0 — всё OK, 1 — есть WARN, 2 — есть CRIT. Секреты в вывод не попадают.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import socket
import ssl
import sys
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

OK, WARN, CRIT = "OK", "WARN", "CRIT"


@dataclass
class Check:
    name: str
    status: str
    detail: str


def check_api(api: str, timeout: float = 10) -> Check:
    try:
        with urllib.request.urlopen(f"{api.rstrip('/')}/health/ready", timeout=timeout) as r:
            body = json.loads(r.read() or b"{}")
            return Check("api_ready", OK if r.status == 200 else CRIT, f"HTTP {r.status} {body.get('status', '')}".strip())
    except urllib.error.HTTPError as e:
        return Check("api_ready", CRIT, f"HTTP {e.code}")
    except (urllib.error.URLError, OSError, ValueError) as e:
        return Check("api_ready", CRIT, type(e).__name__)


def tls_days_left(host: str, port: int = 443, timeout: float = 10) -> float:
    ctx = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=timeout) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as tls:
            not_after = tls.getpeercert()["notAfter"]
    expires = dt.datetime.fromtimestamp(ssl.cert_time_to_seconds(not_after), dt.timezone.utc)
    return (expires - dt.datetime.now(dt.timezone.utc)).total_seconds() / 86400


def classify_tls(host: str, days: Optional[float], error: Optional[str] = None) -> Check:
    if error is not None:
        return Check(f"tls:{host}", CRIT, error)
    status = CRIT if days < 7 else WARN if days < 14 else OK
    return Check(f"tls:{host}", status, f"{days:.0f} days left")


def check_tls(host: str) -> Check:
    try:
        return classify_tls(host, tls_days_left(host))
    except ssl.SSLCertVerificationError as e:
        return classify_tls(host, None, f"invalid certificate: {e.verify_message}")
    except (OSError, ssl.SSLError) as e:
        return classify_tls(host, None, type(e).__name__)


def check_outbox(admin_url: str) -> List[Check]:
    import psycopg2
    try:
        with psycopg2.connect(admin_url, connect_timeout=5) as conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM outbox_events WHERE status = 'pending' AND created_at < now() - interval '15 minutes'")
            backlog = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM outbox_events WHERE status = 'failed' AND processed_at > now() - interval '24 hours'")
            failed = cur.fetchone()[0]
    except psycopg2.Error as e:
        return [Check("outbox_backlog", CRIT, f"database: {type(e).__name__}")]
    return [Check("outbox_backlog", CRIT if backlog > 50 else WARN if backlog else OK, f"{backlog} events older than 15 min"),
            Check("outbox_failed", WARN if failed else OK, f"{failed} failed in 24 h")]


def classify_backup(last: Optional[dt.datetime], now: Optional[dt.datetime] = None) -> Check:
    if last is None:
        return Check("backup_age", CRIT, "no offsite backups found")
    hours = ((now or dt.datetime.now(dt.timezone.utc)) - last).total_seconds() / 3600
    return Check("backup_age", CRIT if hours > 26 else OK, f"last offsite backup {hours:.1f} h ago")


def check_backup() -> Check:
    from scripts.s3_client import S3Client, S3Config, S3Error
    cfg = S3Config.from_env()
    if cfg is None:
        return Check("backup_age", CRIT, "OFFSITE_S3_* is not configured")
    try:
        objs = [o for o in S3Client(cfg, timeout=20).list_keys(cfg.prefix) if o["key"].endswith(".offsite_manifest.json")]
    except S3Error as e:
        return Check("backup_age", CRIT, str(e))
    stamps = [dt.datetime.fromisoformat(o["last_modified"].replace("Z", "+00:00")) for o in objs if o.get("last_modified")]
    return classify_backup(max(stamps) if stamps else None)


def exit_code(checks: List[Check]) -> int:
    states = {c.status for c in checks}
    return 2 if CRIT in states else 1 if WARN in states else 0


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default=os.getenv("MONITOR_API_URL", ""))
    ap.add_argument("--hosts", default=os.getenv("MONITOR_HOSTS", ""), help="comma separated hosts for TLS checks")
    ap.add_argument("--no-db", action="store_true")
    ap.add_argument("--no-backup", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    checks: List[Check] = []
    if a.api:
        checks.append(check_api(a.api))
    checks += [check_tls(h.strip()) for h in a.hosts.split(",") if h.strip()]
    if not a.no_db and os.getenv("ADMIN_DATABASE_URL"):
        checks += check_outbox(os.environ["ADMIN_DATABASE_URL"])
    if not a.no_backup:
        checks.append(check_backup())
    if a.json:
        print(json.dumps([asdict(c) for c in checks], ensure_ascii=False))
    else:
        for c in checks:
            print(f"{c.status:4} {c.name:28} {c.detail}")
    return exit_code(checks)


if __name__ == "__main__":
    sys.exit(main())
