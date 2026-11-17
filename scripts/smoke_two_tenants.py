"""Smoke-тест M01 на живом локальном стеке: две компании, изоляция A/B.

Идёт тем же путём, что и браузер: публичная запись через origin Booking Web (Vite-прокси :3000
с Host <slug>.localhost), вход в CRM через origin CRM (:3001).

Сценарий:
  1. barberhouse.localhost и moderncut.localhost открывают свои сайты, неизвестный slug -> 404.
  2. Клиент A записывается через публичный API Barber House.
  3. Владелец A видит визит в журнале CRM.
  4. Владелец B (Modern Cut) его не видит ни в журнале, ни по id (404).
  5. Визит отменяется по ссылке управления, чтобы слот снова был свободен.

Запуск: python scripts/smoke_two_tenants.py  (стек поднят через scripts/dev_stack.py)
Код выхода 0, если все проверки прошли.
"""
import argparse
import datetime as dt
import json
import sys
import urllib.error
import urllib.request
import uuid

DEMO_PASSWORD = "Password123!"


class SmokeFailure(Exception):
    pass


def call(method, url, *, host=None, token=None, body=None, headers=None):
    hdrs = {"Accept": "application/json"}
    if host:
        hdrs["Host"] = host
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw.decode(errors="replace")


def check(cond, msg):
    if not cond:
        raise SmokeFailure(msg)
    print(f"  ok  {msg}")


def login(crm, email):
    code, data = call("POST", f"{crm}/api/v1/auth/login", body={"email": email, "password": DEMO_PASSWORD})
    check(code == 200, f"вход {email}")
    return data["access_token"]


def calendar_ids(crm, token, day, branch_id):
    code, data = call("GET", f"{crm}/api/v1/business/calendar?date={day}&branch_id={branch_id}", token=token)
    if code != 200:
        raise SmokeFailure(f"calendar {code}: {data}")
    return {b["id"] for b in data["bookings"]}


def run(booking, crm):
    port = booking.rsplit(":", 1)[-1]
    host_a, host_b = f"barberhouse.localhost:{port}", f"moderncut.localhost:{port}"

    print("1. Публичные адреса")
    code, site_a = call("GET", f"{booking}/api/v1/public/site", host=host_a)
    check(code == 200 and site_a["slug"] == "barberhouse", "barberhouse.localhost -> Barber House")
    code, site_b = call("GET", f"{booking}/api/v1/public/site", host=host_b)
    check(code == 200 and site_b["slug"] == "moderncut", "moderncut.localhost -> Modern Cut")
    code, _ = call("GET", f"{booking}/api/v1/public/site", host=f"no-such-salon-{uuid.uuid4().hex[:6]}.localhost:{port}")
    check(code == 404, "неизвестный slug -> 404")

    print("2. Клиент A записывается через Booking Web")
    _, branches = call("GET", f"{booking}/api/v1/public/branches", host=host_a)
    branch_id = branches[0]["id"]
    _, services = call("GET", f"{booking}/api/v1/public/services", host=host_a)
    service_id = services[0]["id"]
    _, staff = call("GET", f"{booking}/api/v1/public/staff?branch_id={branch_id}&service_ids={service_id}", host=host_a)
    staff_id = staff[0]["id"]
    today = dt.datetime.now(dt.timezone.utc).date()
    code, av = call("POST", f"{booking}/api/v1/public/availability/search", host=host_a, body={
        "branch_id": branch_id, "service_ids": [service_id], "staff_id": staff_id, "staff_mode": "specific",
        "from_date": (today + dt.timedelta(days=3)).isoformat(),
        "to_date": (today + dt.timedelta(days=17)).isoformat(),
    })
    check(code == 200 and av["slots"], "есть свободные слоты")
    slot = av["slots"][-1]
    code, created = call("POST", f"{booking}/api/v1/public/bookings", host=host_a,
                         headers={"Idempotency-Key": f"smoke-{uuid.uuid4()}"},
                         body={
                             "branch_id": branch_id, "staff_id": staff_id, "service_ids": [service_id],
                             "starts_at_utc": slot["starts_at_utc"],
                             "customer_name": "Smoke Клиент A", "customer_phone": "+77010000001",
                             "expected_price_minor": slot["price_minor"],
                         })
    check(code == 201 and created["status"] == "confirmed", f"визит создан ({created.get('public_ref') if isinstance(created, dict) else created})")
    booking_id, mgmt = created["booking_id"], created["management_token"]
    day = slot["starts_at_utc"][:10]

    try:
        print("3. Администратор A видит визит")
        token_a = login(crm, "owner@barberhouse.kz")
        check(booking_id in calendar_ids(crm, token_a, day, branch_id), f"визит в журнале Barber House за {day}")

        print("4. Компания B его не видит")
        token_b = login(crm, "owner@moderncut.kz")
        _, branches_b = call("GET", f"{crm}/api/v1/business/branches", token=token_b)
        check(booking_id not in calendar_ids(crm, token_b, day, branches_b[0]["id"]), "нет в журнале Modern Cut")
        code, _ = call("GET", f"{crm}/api/v1/business/bookings/{booking_id}", token=token_b)
        check(code == 404, "Modern Cut по id получает 404")
        code, foreign = call("GET", f"{crm}/api/v1/business/calendar?date={day}&branch_id={branch_id}", token=token_b)
        leaked = code == 200 and booking_id in {b["id"] for b in foreign.get("bookings", [])}
        check(not leaked, f"запрос B с branch_id компании A не отдаёт визит A ({code})")
    finally:
        print("5. Уборка")
        code, _ = call("POST", f"{booking}/api/v1/public/manage/{mgmt}/cancel", body={"reason": "smoke test"})
        print(f"  {'ok ' if code == 200 else 'WARN'} визит отменён по ссылке управления ({code})")


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--booking", default="http://127.0.0.1:3000", help="origin Booking Web (Vite)")
    p.add_argument("--crm", default="http://127.0.0.1:3001", help="origin Business CRM (Vite)")
    a = p.parse_args()
    try:
        run(a.booking.rstrip("/"), a.crm.rstrip("/"))
    except SmokeFailure as e:
        print(f"FAIL {e}")
        return 1
    except (urllib.error.URLError, ConnectionError) as e:
        print(f"FAIL стек недоступен: {e}. Запустите python scripts/dev_stack.py")
        return 1
    print("SMOKE PASSED: A видит свой визит, B изолирована")
    return 0


if __name__ == "__main__":
    sys.exit(main())
