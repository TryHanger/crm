"""Smoke-тест M09 на живом стеке: перенос освобождает старый слот, занимает новый, событие в журнале;
отмена освобождает время и не стирает историю; нелегальный переход отклоняется.
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
    slug = f"smoke-life-{uuid.uuid4().hex[:6]}"
    _, created = call("POST", f"{console}/api/v1/platform/tenants", token=op["access_token"], body={
        "slug": slug, "display_name": f"Smoke {slug}", "owner_name": "Smoke", "owner_email": f"{slug}@example.kz", "plan_code": "start"})
    token = urllib.parse.parse_qs(urllib.parse.urlparse(created["invite_url"]).query)["token"][0]
    _, acc = call("POST", f"{crm}/api/v1/auth/accept-invite", body={"token": token, "password": "Smoke-Owner-1"})
    t = acc["access_token"]
    _, br = call("POST", f"{crm}/api/v1/business/branches", token=t, body={"name": "Центр", "address": "пр. Абая 1", "timezone_iana": "Asia/Almaty"})
    _, st = call("POST", f"{crm}/api/v1/business/staff", token=t, body={"display_name": "Мастер", "branch_ids": [br["id"]]})
    call("PUT", f"{crm}/api/v1/business/staff/{st['id']}/schedule?branch_id={br['id']}", token=t,
         body={"shifts": [{"weekday_iso": d, "local_start": "10:00", "local_end": "18:00"} for d in range(1, 8)]})
    _, svc = call("POST", f"{crm}/api/v1/business/services", token=t, body={"name": "Стрижка", "base_price_minor": 500000, "base_duration_minutes": 60})
    call("PATCH", f"{crm}/api/v1/business/booking-settings", token=t, body={"min_advance_minutes": 0})
    call("PATCH", f"{crm}/api/v1/business/booking-publication", token=t, body={"is_published": True})
    host = f"{slug}.localhost:{port}"
    day = dt.date.today() + dt.timedelta(days=6)
    at = lambda h: dt.datetime.combine(day, dt.time(h), tzinfo=ALMATY).astimezone(dt.timezone.utc)

    def starts():
        _, res = call("POST", f"{booking}/api/v1/public/availability/search", host=host, body={
            "branch_id": br["id"], "service_ids": [svc["id"]], "staff_id": st["id"], "staff_mode": "specific",
            "from_date": day.isoformat(), "to_date": day.isoformat()})
        return {dt.datetime.fromisoformat(s["starts_at_utc"]) for s in res["slots"]}

    print("1. Клиент записался на 11:00")
    code, b = call("POST", f"{booking}/api/v1/public/bookings", host=host, headers={"Idempotency-Key": str(uuid.uuid4())}, body={
        "branch_id": br["id"], "staff_id": st["id"], "service_ids": [svc["id"]], "starts_at_utc": at(11).isoformat(),
        "expected_price_minor": 500000, "customer_name": "Клиент", "customer_phone": "+77010007777"})
    check(code == 201 and at(11) not in starts(), f"запись {b.get('public_ref')}, 11:00 занято")

    print("2. Администратор переносит на 15:00")
    code, res = call("POST", f"{crm}/api/v1/business/bookings/{b['booking_id']}/reschedule", token=t,
                     body={"new_starts_at_utc": at(15).isoformat()})
    s = starts()
    check(code == 200 and at(11) in s and at(15) not in s, "11:00 снова свободно, 15:00 занято")
    _, card = call("GET", f"{crm}/api/v1/business/bookings/{b['booking_id']}", token=t)
    ev = [e for e in card["events"] if e["event_type"] == "rescheduled"]
    check(len(ev) == 1 and ev[0]["old"] and ev[0]["new"], "в журнале событие переноса: было 11:00 → стало 15:00")

    print("3. Отмена и запрет нелегального перехода")
    code, _ = call("POST", f"{crm}/api/v1/business/bookings/{b['booking_id']}/cancel", token=t, body={"reason": "Клиент передумал"})
    check(code == 200 and at(15) in starts(), "отменено, 15:00 снова свободно")
    code, res = call("PATCH", f"{crm}/api/v1/business/bookings/{b['booking_id']}/status", token=t, body={"status": "completed"})
    check(code == 409 and res["detail"]["code"] == "INVALID_TRANSITION", "cancelled → completed отклонено (409)")
    _, card = call("GET", f"{crm}/api/v1/business/bookings/{b['booking_id']}", token=t)
    kinds = sorted({e["event_type"] for e in card["events"]})
    check(card["status"] == "cancelled" and kinds == ["cancelled", "created", "rescheduled"], f"история сохранена: {kinds}")


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
    print("SMOKE PASSED: перенос и отмена не теряют фактов и не оставляют занятость")
    return 0


if __name__ == "__main__":
    sys.exit(main())
