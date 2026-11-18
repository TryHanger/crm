"""Smoke-тест M10 на живом стеке: повторный визит находит своего клиента, общий телефон не сливает людей,
чужая компания клиентов не видит.
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


def run(console, crm, booking):
    port = booking.rsplit(":", 1)[-1]
    _, op = call("POST", f"{console}/api/v1/auth/login", body={"email": "owner@platform.example.kz", "password": "Password123!"})
    slug = f"smoke-cust-{uuid.uuid4().hex[:6]}"
    _, created = call("POST", f"{console}/api/v1/platform/tenants", token=op["access_token"], body={
        "slug": slug, "display_name": f"Smoke {slug}", "owner_name": "Smoke", "owner_email": f"{slug}@example.kz", "plan_code": "start"})
    token = urllib.parse.parse_qs(urllib.parse.urlparse(created["invite_url"]).query)["token"][0]
    _, acc = call("POST", f"{crm}/api/v1/auth/accept-invite", body={"token": token, "password": "Smoke-Owner-1"})
    t = acc["access_token"]
    _, br = call("POST", f"{crm}/api/v1/business/branches", token=t, body={"name": "Центр", "address": "пр. Абая 1", "timezone_iana": "Asia/Almaty"})
    _, st = call("POST", f"{crm}/api/v1/business/staff", token=t, body={"display_name": "Мастер", "branch_ids": [br["id"]]})
    call("PUT", f"{crm}/api/v1/business/staff/{st['id']}/schedule?branch_id={br['id']}", token=t,
         body={"shifts": [{"weekday_iso": d, "local_start": "09:00", "local_end": "20:00"} for d in range(1, 8)]})
    _, svc = call("POST", f"{crm}/api/v1/business/services", token=t, body={"name": "Маникюр", "base_price_minor": 500000, "base_duration_minutes": 30})
    call("PATCH", f"{crm}/api/v1/business/booking-settings", token=t, body={"min_advance_minutes": 0})
    call("PATCH", f"{crm}/api/v1/business/booking-publication", token=t, body={"is_published": True})
    host = f"{slug}.localhost:{port}"
    day = dt.date.today() + dt.timedelta(days=4)
    phone_digits = f"701{uuid.uuid4().int % 10_000_000:07d}"

    def book(hour, name, phone):
        start = dt.datetime.combine(day, dt.time(hour), tzinfo=ALMATY).astimezone(dt.timezone.utc).isoformat()
        return call("POST", f"{booking}/api/v1/public/bookings", host=host, headers={"Idempotency-Key": str(uuid.uuid4())}, body={
            "branch_id": br["id"], "staff_id": st["id"], "service_ids": [svc["id"]], "starts_at_utc": start,
            "expected_price_minor": 500000, "customer_name": name, "customer_phone": phone})

    print("1. Записи с одного телефона в разных форматах")
    c1, _ = book(10, "Айгерим", f"8 {phone_digits[:3]} {phone_digits[3:]}")
    c2, _ = book(11, "айгерим", f"+7 ({phone_digits[:3]}) {phone_digits[3:6]}-{phone_digits[6:8]}-{phone_digits[8:]}")
    c3, _ = book(12, "Мама Айгерим", f"8{phone_digits}")
    check((c1, c2, c3) == (201, 201, 201), "три записи созданы")
    code, found = call("GET", f"{crm}/api/v1/business/customers?search={urllib.parse.quote('8 ' + phone_digits[:3])}", token=t)
    by_name = {c["full_name"]: c for c in found}
    check(sorted(by_name) == ["Айгерим", "Мама Айгерим"], f"поиск по «8 {phone_digits[:3]}…» нашёл двух разных клиентов")
    _, card = call("GET", f"{crm}/api/v1/business/customers/{by_name['Айгерим']['id']}", token=t)
    check(card["total_bookings"] == 2 and card["phone"] == "+7" + phone_digits, "у Айгерим 2 визита, номер в одном формате")
    check([x["full_name"] for x in card["same_phone_customers"]] == ["Мама Айгерим"], "подсказка: тот же номер у «Мама Айгерим», без слияния")

    print("2. Чужая компания")
    _, other = call("POST", f"{crm}/api/v1/auth/login", body={"email": "owner@barberhouse.kz", "password": "Password123!"})
    code, found = call("GET", f"{crm}/api/v1/business/customers?search={phone_digits}", token=other["access_token"])
    check(code == 200 and found == [], "Barber House не находит этих клиентов")
    code, _ = call("GET", f"{crm}/api/v1/business/customers/{by_name['Айгерим']['id']}", token=other["access_token"])
    check(code == 404, "карточка чужого клиента — 404")


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
    print("SMOKE PASSED: клиенты по подтверждённым правилам, общий телефон не сливает людей")
    return 0


if __name__ == "__main__":
    sys.exit(main())
