"""Smoke-тест M06 на живом стеке: три сценария клиентской записи создают настоящую запись.

  по услуге   -> /availability/search (любой мастер)            -> /bookings по quote
  по мастеру  -> /staff, /staff/{id}/services -> search(мастер) -> /bookings по quote
  по времени  -> /availability/time-first -> search(at_utc)     -> /bookings по quote

Компания создаётся заново (оператор + приглашение), демо-данные не трогаются.
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


def setup(console, crm):
    code, op = call("POST", f"{console}/api/v1/auth/login", body={"email": "owner@platform.example.kz", "password": "Password123!"})
    slug = f"smoke-flow-{uuid.uuid4().hex[:6]}"
    code, created = call("POST", f"{console}/api/v1/platform/tenants", token=op["access_token"], body={
        "slug": slug, "display_name": f"Smoke {slug}", "owner_name": "Smoke", "owner_email": f"{slug}@example.kz", "plan_code": "start"})
    token = urllib.parse.parse_qs(urllib.parse.urlparse(created["invite_url"]).query)["token"][0]
    _, acc = call("POST", f"{crm}/api/v1/auth/accept-invite", body={"token": token, "password": "Smoke-Owner-1"})
    t = acc["access_token"]
    _, br = call("POST", f"{crm}/api/v1/business/branches", token=t, body={"name": "Центр", "address": "пр. Абая 1", "timezone_iana": "Asia/Almaty"})
    masters = []
    for name in ("Айдана", "Ерлан"):
        _, st = call("POST", f"{crm}/api/v1/business/staff", token=t, body={"display_name": name, "branch_ids": [br["id"]]})
        call("PUT", f"{crm}/api/v1/business/staff/{st['id']}/schedule?branch_id={br['id']}", token=t,
             body={"shifts": [{"weekday_iso": d, "local_start": "10:00", "local_end": "18:00"} for d in range(1, 8)]})
        masters.append(st["id"])
    _, s1 = call("POST", f"{crm}/api/v1/business/services", token=t, body={"name": "Стрижка", "base_price_minor": 800000, "base_duration_minutes": 60})
    _, s2 = call("POST", f"{crm}/api/v1/business/services", token=t, body={"name": "Борода", "base_price_minor": 400000, "base_duration_minutes": 30})
    call("PUT", f"{crm}/api/v1/business/staff/{masters[1]}/services", token=t,
         body=[{"branch_id": br["id"], "service_id": s1["id"], "price_override_minor": 1000000}])
    call("PATCH", f"{crm}/api/v1/business/booking-settings", token=t, body={"min_advance_minutes": 0})
    code, _ = call("PATCH", f"{crm}/api/v1/business/booking-publication", token=t, body={"is_published": True})
    check(code == 200, f"компания {slug}: 2 мастера, 2 услуги, запись опубликована")
    return slug, br["id"], masters, s1["id"], s2["id"]


def book(booking, host, branch, slot, services, name):
    code, res = call("POST", f"{booking}/api/v1/public/bookings", host=host, headers={"Idempotency-Key": str(uuid.uuid4())}, body={
        "branch_id": branch, "staff_id": slot["staff_id"], "service_ids": services, "starts_at_utc": slot["starts_at_utc"],
        "quote_id": slot["quote_id"], "expected_price_minor": slot["price_minor"],
        "customer_name": name, "customer_phone": "+77010000" + str(uuid.uuid4().int)[:3]})
    return code, res


def run(console, crm, booking):
    port = booking.rsplit(":", 1)[-1]
    slug, branch, masters, s1, s2 = setup(console, crm)
    host = f"{slug}.localhost:{port}"
    day = (dt.date.today() + dt.timedelta(days=4)).isoformat()

    print("1. По услуге: Стрижка + Борода, любой мастер")
    code, res = call("POST", f"{booking}/api/v1/public/availability/search", host=host, body={
        "branch_id": branch, "service_ids": [s1, s2], "staff_mode": "any", "from_date": day, "to_date": day})
    slot = res["slots"][0]
    check(slot["duration_minutes"] == 90 and slot["price_minor"] == 1200000, "90 мин, 12 000 ₸ у более выгодного мастера")
    code, res = book(booking, host, branch, slot, [s1, s2], "По услуге")
    check(code == 201 and res["total_amount_minor"] == 1200000 and res["management_token"], f"запись {res.get('public_ref')}")

    print("2. По мастеру: Ерлан, его цена")
    code, staff = call("GET", f"{booking}/api/v1/public/staff?branch_id={branch}", host=host)
    check(code == 200 and masters[1] in {s['id'] for s in staff}, "мастер в списке")
    code, svcs = call("GET", f"{booking}/api/v1/public/staff/{masters[1]}/services?branch_id={branch}", host=host)
    price = {s["id"]: s["base_price_minor"] for s in svcs}[s1]
    code, res = call("POST", f"{booking}/api/v1/public/availability/search", host=host, body={
        "branch_id": branch, "service_ids": [s1], "staff_id": masters[1], "staff_mode": "specific", "from_date": day, "to_date": day})
    slot = res["slots"][-1]
    check(price == slot["price_minor"] == 1000000, "цена мастера в каталоге = цена слота = 10 000 ₸")
    code, res = book(booking, host, branch, slot, [s1], "По мастеру")
    check(code == 201, f"запись {res.get('public_ref')}")

    print("3. По времени: сначала 15:00, потом услуга")
    code, res = call("POST", f"{booking}/api/v1/public/availability/time-first", host=host,
                     body={"branch_id": branch, "from_date": day, "to_date": day})
    at = dt.datetime.combine(dt.date.fromisoformat(day), dt.time(15), tzinfo=ALMATY).astimezone(dt.timezone.utc).isoformat()
    check(code == 200 and at in {s["starts_at_utc"] for s in res["slots"]}, f"15:00 в списке времени ({res.get('total_count')} вариантов)")
    code, res = call("POST", f"{booking}/api/v1/public/availability/search", host=host, body={
        "branch_id": branch, "service_ids": [s2], "staff_mode": "any", "from_date": day, "to_date": day, "at_utc": at})
    check(code == 200 and res["exact_match"] and res["slots"], "Борода на 15:00 подтверждена quote")
    code, res = book(booking, host, branch, res["slots"][0], [s2], "По времени")
    check(code == 201 and res["status"] == "confirmed", f"запись {res.get('public_ref')}")


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
    except (urllib.error.URLError, ConnectionError, KeyError, IndexError) as e:
        print(f"FAIL {type(e).__name__}: {e}")
        return 1
    print("SMOKE PASSED: все три сценария записи завершаются бронью")
    return 0


if __name__ == "__main__":
    sys.exit(main())
