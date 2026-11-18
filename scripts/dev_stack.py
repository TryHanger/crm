"""Единый локальный запуск: PostgreSQL + миграции/демо-данные + API + 3 SPA (M01-D2-02).

    python scripts/dev_stack.py            # всё поднять и держать, Ctrl+C останавливает
    python scripts/dev_stack.py --smoke    # после старта прогнать smoke A/B и остаться работать
    python scripts/dev_stack.py --smoke --exit   # для CI/проверки: smoke и выход с его кодом
    python scripts/dev_stack.py --no-docker      # PostgreSQL уже запущен сам

PostgreSQL берётся из docker-compose.yml (сервис postgres) на порту POSTGRES_PORT, по умолчанию 5433,
потому что 5432 часто занят локальным PostgreSQL. Все переменные можно переопределить окружением.
Требуется: Python-зависимости из requirements.txt, `npm ci` в корне, Docker (если без --no-docker).
"""
import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IS_WIN = os.name == "nt"

SPAS = [
    ("booking-web", "@crm/booking-web", 3000),
    ("business-crm", "@crm/business-crm", 3001),
    ("platform-console", "@crm/platform-console", 3002),
]
API_PORT = 8000
# smoke-сценарии спринтов, по порядку
SMOKES = ["smoke_two_tenants.py", "smoke_onboarding.py", "smoke_pricing.py", "smoke_schedules.py", "smoke_booking_flows.py", "smoke_slot_race.py", "smoke_calendar_block.py", "smoke_visit_lifecycle.py", "smoke_customers.py", "smoke_accrual.py", "smoke_cash.py"]


def build_env(db_port: int) -> dict:
    env = dict(os.environ)
    db = env.get("DB_NAME", "saas_crm")
    defaults = {
        "ENVIRONMENT": "development",
        "ENABLE_DEMO_SEED": "true",
        "POSTGRES_PORT": str(db_port),
        "DB_HOST": "127.0.0.1",
        "DB_PORT": str(db_port),
        "DB_NAME": db,
        "DB_USER": "crm_app_user",
        "DB_PASSWORD": "crm_app_secret",
        "ADMIN_DB_USER": "postgres",
        "ADMIN_DB_PASSWORD": "postgrespassword",
        "JWT_SECRET_KEY": "dev-insecure-jwt-secret-key-change-in-production-1234567890",
    }
    for k, v in defaults.items():
        env.setdefault(k, v)
    env.setdefault("DATABASE_URL",
                   f"postgresql+asyncpg://{env['DB_USER']}:{env['DB_PASSWORD']}@127.0.0.1:{env['DB_PORT']}/{db}")
    env.setdefault("ADMIN_DATABASE_URL",
                   f"postgresql://{env['ADMIN_DB_USER']}:{env['ADMIN_DB_PASSWORD']}@127.0.0.1:{env['DB_PORT']}/{db}")
    env["PYTHONUNBUFFERED"] = "1"
    return env


def port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def wait_for(what: str, ok, timeout: float, procs=()) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if ok():
            print(f"  ready  {what}")
            return
        for name, p in procs:
            if p.poll() is not None:
                sys.exit(f"{name} завершился с кодом {p.returncode} до готовности ({what})")
        time.sleep(0.5)
    sys.exit(f"не дождались: {what} ({timeout:.0f} с)")


def start_postgres(env: dict) -> None:
    if not shutil.which("docker"):
        sys.exit("docker не найден: запустите Docker Desktop или используйте --no-docker")
    print(f"PostgreSQL 17 (docker compose, порт {env['DB_PORT']})")
    subprocess.run(["docker", "compose", "up", "-d", "--wait", "postgres"], cwd=ROOT, env=env, check=True)


def wait_postgres(env: dict) -> None:
    import psycopg2

    def ready():
        try:
            psycopg2.connect(env["ADMIN_DATABASE_URL"], connect_timeout=2).close()
            return True
        except psycopg2.OperationalError:
            return False

    wait_for(f"PostgreSQL :{env['DB_PORT']}", ready, 60)


def migrate_and_seed(env: dict) -> None:
    print("Миграции (alembic upgrade head) и демо-данные")
    code = ("from apps.api.app.infrastructure.db.init_db import init_database, seed_database;"
            "init_database(); seed_database()")
    subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, check=True)


def spawn(name: str, cmd: list, env: dict) -> subprocess.Popen:
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WIN else 0
    return subprocess.Popen(cmd, cwd=ROOT, env=env, creationflags=flags,
                            start_new_session=not IS_WIN, shell=False)


def stop(procs) -> None:
    for name, p in procs:
        if p.poll() is not None:
            continue
        if IS_WIN:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True)
        else:
            os.killpg(os.getpgid(p.pid), signal.SIGTERM)
    for _, p in procs:
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db-port", type=int, default=int(os.environ.get("POSTGRES_PORT", "5433")))
    ap.add_argument("--no-docker", action="store_true", help="не запускать PostgreSQL через docker compose")
    ap.add_argument("--smoke", action="store_true", help="после старта прогнать все scripts/smoke_*.py")
    ap.add_argument("--exit", action="store_true", help="с --smoke: остановить стек после smoke")
    args = ap.parse_args()

    busy = [p for p in [API_PORT] + [s[2] for s in SPAS] if port_open(p)]
    if busy:
        sys.exit(f"порты уже заняты: {busy}. Остановите прошлый запуск.")
    npm = shutil.which("npm.cmd" if IS_WIN else "npm")
    if not npm:
        sys.exit("npm не найден: нужен Node.js 20+")
    if not (ROOT / "node_modules").exists():
        sys.exit("нет node_modules: выполните `npm ci` в корне репозитория")

    env = build_env(args.db_port)
    if not args.no_docker:
        start_postgres(env)
    wait_postgres(env)
    migrate_and_seed(env)

    procs = []
    try:
        print("Запуск API и фронтендов")
        procs.append(("api", spawn("api", [sys.executable, "-m", "uvicorn", "apps.api.app.main:app",
                                           "--host", "127.0.0.1", "--port", str(API_PORT)], env)))
        for name, ws, port in SPAS:
            procs.append((name, spawn(name, [npm, "run", "dev", f"--workspace={ws}", "--",
                                             "--port", str(port), "--strictPort"], env)))
        wait_for(f"API :{API_PORT}", lambda: port_open(API_PORT), 60, procs)
        for name, _, port in SPAS:
            wait_for(f"{name} :{port}", lambda port=port: port_open(port), 90, procs)

        print(f"""
Стек запущен (БД {env['DB_NAME']} на :{env['DB_PORT']}, ENVIRONMENT={env['ENVIRONMENT']})
  Запись, компания A   http://barberhouse.localhost:3000
  Запись, компания B   http://moderncut.localhost:3000
  CRM                  http://localhost:3001   owner@barberhouse.kz / owner@moderncut.kz, Password123!
  Platform Console     http://localhost:3002
  API docs             http://localhost:{API_PORT}/docs
""")
        if args.smoke:
            rc = 0
            for smoke in SMOKES:
                print(f"--- {smoke}")
                rc |= subprocess.run([sys.executable, str(ROOT / "scripts" / smoke)], cwd=ROOT).returncode
            if args.exit:
                return rc
        print("Ctrl+C для остановки")
        while all(p.poll() is None for _, p in procs):
            time.sleep(1)
        dead = [(n, p.returncode) for n, p in procs if p.poll() is not None]
        print(f"процесс завершился: {dead}")
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        print("Остановка API и фронтендов (PostgreSQL продолжает работать: docker compose stop postgres)")
        stop(procs)


if __name__ == "__main__":
    sys.exit(main())
