"""Smoke-тест M11 на живом стеке: завершение стрижки на 8000 KZT -> оказано 8000, оплачено 0, долг 8000.
Повторное завершение не создаёт второго начисления.
"""
import argparse
import datetime as dt
import sys
import urllib.error
import urllib.parse
import uuid
import zoneinfo

from smoke_two_tenants import SmokeFailure, call, check

ALMATY = zoneinfo.ZoneInfo("Asia/Almaty")


def new_company(console, crm, prefix):
    _, op = call("POST", f"{console}/api/v1/auth/login", body={"email": "owner@platform.example.kz", "password": "Password123!"})
    slug = f"{prefix}-{uuid.uuid4().hex[:6]}"
    _, created = call("POST", f"{console}/api/v1/platform/tenants", token=op["access_token"], body={
        "slug": slug, "display_name": f"Smoke {slug}", "owner_name": "Smoke", "owner_email": f"{slug}@example.kz", "plan_code": "start"})
    token = urllib.parse.parse_qs(urllib.parse.urlparse(created["invite_url"]).query)["token"][0]
    _, acc = call("POST", f"{crm}/api/v1/auth/accept-invite", body={"token": token, "password": "Smoke-Owner-1"})
    t = acc["access_token"]
    _, br = call("POST", f"{crm}/api/v1/business/branches", token=t, body={"name": "Центр", "address": "пр. Абая 1", "timezone_iana": "Asia/Almaty"})
    _, st = call("POST", f"{crm}/api/v1/business/staff", token=t, body={"display_name": "Мастер", "branch_ids": [br["id"]]})
    call("PUT", f"{crm}/api/v1/business/staff/{st['id']}/schedule?branch_id={br['id']}", token=t,
         body={"shifts": [{"weekday_iso": d, "local_start": "09:00", "local_end": "20:00"} for d in range(1, 8)]})
    _, svc = call("POST", f"{crm}/api/v1/business/services", token=t, body={"name": "Стрижка", "base_price_minor": 800000, "base_duration_minutes": 60})
    call("PATCH", f"{crm}/api/v1/business/booking-settings", token=t, body={"min_advance_minutes": 0})
    call("PATCH", f"{crm}/api/v1/business/booking-publication", token=t, body={"is_published": True})
    return slug, t, br["id"], st["id"], svc["id"]


def book(booking, slug, port, branch, staff, svc, hour, price=800000, phone="+77010009191"):
    day = dt.date.today() + dt.timedelta(days=3)
    start = dt.datetime.combine(day, dt.time(hour), tzinfo=ALMATY).astimezone(dt.timezone.utc).isoformat()
    code, b = call("POST", f"{booking}/api/v1/public/bookings", host=f"{slug}.localhost:{port}",
                   headers={"Idempotency-Key": str(uuid.uuid4())}, body={
                       "branch_id": branch, "staff_id": staff, "service_ids": [svc], "starts_at_utc": start,
                       "expected_price_minor": price, "customer_name": "Клиент", "customer_phone": phone})
    if code != 201:
        raise SmokeFailure(f"бронь: {code} {b}")
    return b


def run(console, crm, booking):
    port = booking.rsplit(":", 1)[-1]
    slug, t, branch, staff, svc = new_company(console, crm, "smoke-acc")
    b = book(booking, slug, port, branch, staff, svc, 10)
    check(True, f"запись {b['public_ref']} на 8 000 ₸")
    code, _ = call("PATCH", f"{crm}/api/v1/business/bookings/{b['booking_id']}/status", token=t, body={"status": "completed"})
    check(code == 200, "визит завершён")
    _, card = call("GET", f"{crm}/api/v1/business/bookings/{b['booking_id']}", token=t)
    f = card["finance"]
    check((f["rendered_minor"], f["received_minor"], f["debt_minor"]) == (800000, 0, 800000),
          f"оказано {f['rendered_minor'] // 100}, оплачено {f['received_minor'] // 100}, долг {f['debt_minor'] // 100}")
    code, _ = call("PATCH", f"{crm}/api/v1/business/bookings/{b['booking_id']}/status", token=t, body={"status": "completed"})
    _, card = call("GET", f"{crm}/api/v1/business/bookings/{b['booking_id']}", token=t)
    check(code == 409 and card["finance"]["rendered_minor"] == 800000, "повтор завершения: 409, начисление одно")


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--console", default="http://127.0.0.1:3002")
    p.add_argument("--crm", default="http://127.0.0.1:3001")
    p.add_argument("--booking", default="http://127.0.0.1:3000")
    a = p.parse_args()
    try:
        run(a.console.rstrip("/"), a.crm.rstrip("/"), a.booking.rstrip("/"))
    except SmokeFailure as e:
        print(f"FAIL {e}")
        return 1
    except (urllib.error.URLError, ConnectionError, KeyError, IndexError, TypeError) as e:
        print(f"FAIL {type(e).__name__}: {e}")
        return 1
    print("SMOKE PASSED: оказано 8000, оплачено 0, долг 8000")
    return 0


if __name__ == "__main__":
    sys.exit(main())
