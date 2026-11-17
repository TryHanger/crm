"""Smoke-тест M05 на живом стеке: у двух мастеров разные цены и смены, сайт показывает их часы.

  1. Оператор создаёт новую компанию, владелец активирует доступ (как в M02).
  2. Владелец заводит филиал (Asia/Almaty), двух мастеров: 10–14 и 15–19, услугу и цены 9 000 / 12 000 ₸.
  3. Сайт записи компании показывает мастеру «Утро» слоты 10:00–13:00 по 9 000 ₸, «Вечер» — 15:00–18:00 по 12 000 ₸.
  4. Запись «Утра» на 15:00 отклоняется (вне смены).
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
    print("1. Новая компания")
    code, op = call("POST", f"{console}/api/v1/auth/login", body={"email": "owner@platform.example.kz", "password": "Password123!"})
    check(code == 200, "вход оператора")
    slug = f"smoke-tz-{uuid.uuid4().hex[:6]}"
    code, created = call("POST", f"{console}/api/v1/platform/tenants", token=op["access_token"], body={
        "slug": slug, "display_name": f"Smoke {slug}", "owner_name": "Smoke", "owner_email": f"{slug}@example.kz", "plan_code": "start"})
    check(code == 201, f"компания {slug}")
    token = urllib.parse.parse_qs(urllib.parse.urlparse(created["invite_url"]).query)["token"][0]
    code, acc = call("POST", f"{crm}/api/v1/auth/accept-invite", body={"token": token, "password": "Smoke-Owner-1"})
    check(code == 200, "владелец активировал доступ")
    t = acc["access_token"]

    print("2. Филиал, мастера, услуга, цены")
    code, br = call("POST", f"{crm}/api/v1/business/branches", token=t, body={"name": "Центр", "address": "пр. Абая 1", "timezone_iana": "Asia/Almaty"})
    check(code == 201, "филиал в Asia/Almaty")
    branch = br["id"]
    masters = {}
    for name, start, end in (("Утро", "10:00", "14:00"), ("Вечер", "15:00", "19:00")):
        code, st = call("POST", f"{crm}/api/v1/business/staff", token=t, body={"display_name": name, "branch_ids": [branch]})
        code2, _ = call("PUT", f"{crm}/api/v1/business/staff/{st['id']}/schedule?branch_id={branch}", token=t,
                        body={"shifts": [{"weekday_iso": d, "local_start": start, "local_end": end} for d in range(1, 8)]})
        check(code == 201 and code2 == 200, f"мастер «{name}» {start}–{end}")
        masters[name] = st["id"]
    code, svc = call("POST", f"{crm}/api/v1/business/services", token=t,
                     body={"name": "Стрижка", "base_price_minor": 800000, "base_duration_minutes": 60})
    check(code == 201, "услуга 8 000 ₸")
    for name, price in (("Утро", 900000), ("Вечер", 1200000)):
        code, _ = call("PUT", f"{crm}/api/v1/business/staff/{masters[name]}/services", token=t,
                       body=[{"branch_id": branch, "service_id": svc["id"], "price_override_minor": price}])
        check(code == 200, f"цена «{name}» {price // 100} ₸")
    call("PATCH", f"{crm}/api/v1/business/booking-settings", token=t, body={"min_advance_minutes": 0})
    code, _ = call("PATCH", f"{crm}/api/v1/business/booking-publication", token=t, body={"is_published": True})
    check(code == 200, "запись опубликована")

    print("3. Сайт показывает часы и цены мастеров")
    host = f"{slug}.localhost:{port}"
    day = dt.date.today() + dt.timedelta(days=3)
    expect = {"Утро": (dt.time(10), dt.time(13), 900000), "Вечер": (dt.time(15), dt.time(18), 1200000)}
    for name, (first, last, price) in expect.items():
        code, res = call("POST", f"{booking}/api/v1/public/availability/search", host=host, body={
            "branch_id": branch, "service_ids": [svc["id"]], "staff_id": masters[name], "staff_mode": "specific",
            "from_date": day.isoformat(), "to_date": day.isoformat()})
        slots = res.get("slots", []) if code == 200 else []
        local = sorted(dt.datetime.fromisoformat(s["starts_at_utc"]).astimezone(ALMATY).time() for s in slots)
        prices = {s["price_minor"] for s in slots}
        check(slots and local[0] == first and local[-1] == last and prices == {price},
              f"«{name}»: {local[0].strftime('%H:%M') if local else '-'}–{local[-1].strftime('%H:%M') if local else '-'}, {price // 100} ₸")

    print("4. Вне смены записать нельзя")
    evening = dt.datetime.combine(day, dt.time(15), tzinfo=ALMATY).astimezone(dt.timezone.utc)
    code, body = call("POST", f"{booking}/api/v1/public/bookings", host=host, headers={"Idempotency-Key": str(uuid.uuid4())}, body={
        "branch_id": branch, "staff_id": masters["Утро"], "service_ids": [svc["id"]], "starts_at_utc": evening.isoformat(),
        "customer_name": "Smoke", "customer_phone": "+77010000999", "expected_price_minor": 900000})
    check(code == 400 and "STAFF_OUTSIDE_SHIFT" in str(body), "«Утро» на 15:00 отклонено")


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
    except (urllib.error.URLError, ConnectionError) as e:
        print(f"FAIL стек недоступен: {e}. Запустите python scripts/dev_stack.py")
        return 1
    print("SMOKE PASSED: у мастеров свои смены и цены на сайте записи")
    return 0


if __name__ == "__main__":
    sys.exit(main())
