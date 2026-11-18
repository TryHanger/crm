"""Smoke-тест M07 на живом стеке: 20 клиентов одновременно бронируют один слот.

Ожидание: ровно одна бронь (201), остальные 19 получают 409 SLOT_CONFLICT с новыми слотами;
двойная отправка с тем же Idempotency-Key возвращает ту же бронь, а не конфликт.
Запросы идут параллельно через origin Booking Web (Vite-прокси), как из браузеров.
"""
import argparse
import datetime as dt
import sys
import urllib.error
import urllib.parse
import uuid
import zoneinfo
from concurrent.futures import ThreadPoolExecutor

from smoke_two_tenants import SmokeFailure, call, check

ALMATY = zoneinfo.ZoneInfo("Asia/Almaty")


def setup(console, crm):
    _, op = call("POST", f"{console}/api/v1/auth/login", body={"email": "owner@platform.example.kz", "password": "Password123!"})
    slug = f"smoke-race-{uuid.uuid4().hex[:6]}"
    _, created = call("POST", f"{console}/api/v1/platform/tenants", token=op["access_token"], body={
        "slug": slug, "display_name": f"Smoke {slug}", "owner_name": "Smoke", "owner_email": f"{slug}@example.kz", "plan_code": "start"})
    token = urllib.parse.parse_qs(urllib.parse.urlparse(created["invite_url"]).query)["token"][0]
    _, acc = call("POST", f"{crm}/api/v1/auth/accept-invite", body={"token": token, "password": "Smoke-Owner-1"})
    t = acc["access_token"]
    _, br = call("POST", f"{crm}/api/v1/business/branches", token=t, body={"name": "Центр", "address": "пр. Абая 1", "timezone_iana": "Asia/Almaty"})
    _, st = call("POST", f"{crm}/api/v1/business/staff", token=t, body={"display_name": "Мастер", "branch_ids": [br["id"]]})
    call("PUT", f"{crm}/api/v1/business/staff/{st['id']}/schedule?branch_id={br['id']}", token=t,
         body={"shifts": [{"weekday_iso": d, "local_start": "10:00", "local_end": "14:00"} for d in range(1, 8)]})
    _, svc = call("POST", f"{crm}/api/v1/business/services", token=t, body={"name": "Стрижка", "base_price_minor": 600000, "base_duration_minutes": 60})
    call("PATCH", f"{crm}/api/v1/business/booking-settings", token=t, body={"min_advance_minutes": 0})
    call("PATCH", f"{crm}/api/v1/business/booking-publication", token=t, body={"is_published": True})
    return slug, br["id"], st["id"], svc["id"]


def run(console, crm, booking, n):
    port = booking.rsplit(":", 1)[-1]
    slug, branch, staff, svc = setup(console, crm)
    host = f"{slug}.localhost:{port}"
    day = dt.date.today() + dt.timedelta(days=5)
    start = dt.datetime.combine(day, dt.time(10), tzinfo=ALMATY).astimezone(dt.timezone.utc).isoformat()
    print(f"1. {n} клиентов одновременно на {day} 10:00")

    def attempt(i, key=None):
        return call("POST", f"{booking}/api/v1/public/bookings", host=host,
                    headers={"Idempotency-Key": key or str(uuid.uuid4())}, body={
                        "branch_id": branch, "staff_id": staff, "service_ids": [svc], "starts_at_utc": start,
                        "expected_price_minor": 600000, "customer_name": f"Гонка {i}", "customer_phone": f"+770111{i:05d}"})

    with ThreadPoolExecutor(max_workers=n) as pool:
        results = list(pool.map(attempt, range(n)))
    codes = [c for c, _ in results]
    check(codes.count(201) == 1, f"одна бронь из {n} (201 x{codes.count(201)})")
    losers = [b for c, b in results if c != 201]
    check(all(c in (201, 409) for c in codes), f"остальные 409 (x{codes.count(409)})")
    with_alts = [b for b in losers if isinstance(b, dict) and b.get("detail", {}).get("details", {}).get("alternatives")]
    check(len(with_alts) == len(losers), f"всем {len(losers)} показаны новые слоты, например "
          f"{dt.datetime.fromisoformat(with_alts[0]['detail']['details']['alternatives'][0]['starts_at_utc']).astimezone(ALMATY):%H:%M}")

    print("2. Двойная отправка с одним ключом")
    alt = with_alts[0]["detail"]["details"]["alternatives"][0]["starts_at_utc"]
    key = f"smoke-{uuid.uuid4()}"

    def resend(_):
        return call("POST", f"{booking}/api/v1/public/bookings", host=host, headers={"Idempotency-Key": key}, body={
            "branch_id": branch, "staff_id": staff, "service_ids": [svc], "starts_at_utc": alt,
            "expected_price_minor": 600000, "customer_name": "Двойной тап", "customer_phone": "+77011199999"})

    with ThreadPoolExecutor(max_workers=5) as pool:
        twice = list(pool.map(resend, range(5)))
    ids = {b.get("booking_id") for c, b in twice if c == 201}
    check([c for c, _ in twice] == [201] * 5 and len(ids) == 1, "5 одинаковых запросов = одна бронь, без конфликтов")


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--console", default="http://127.0.0.1:3002")
    p.add_argument("--crm", default="http://127.0.0.1:3001")
    p.add_argument("--booking", default="http://127.0.0.1:3000")
    p.add_argument("-n", type=int, default=20)
    a = p.parse_args()
    try:
        run(a.console.rstrip("/"), a.crm.rstrip("/"), a.booking.rstrip("/"), a.n)
    except SmokeFailure as e:
        print(f"FAIL {e}")
        return 1
    except (urllib.error.URLError, ConnectionError, KeyError, IndexError) as e:
        print(f"FAIL {type(e).__name__}: {e}")
        return 1
    print(f"SMOKE PASSED: из {a.n} одновременных запросов одна бронь, остальным новые слоты")
    return 0


if __name__ == "__main__":
    sys.exit(main())
