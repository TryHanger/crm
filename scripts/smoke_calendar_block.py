"""Smoke-тест M08 на живом стеке: администратор блокирует 13:00–14:00, клиент не может выбрать это время.

  1. Новая компания, мастер 10–18, услуга 60 мин.
  2. Владелец через CRM ставит блокировку 13:00–14:00.
  3. Сайт записи не показывает слоты, пересекающие 13–14; бронь на 13:00 -> 409 с другими слотами.
  4. Календарь CRM отдаёт свободные окна 10–13 и 14–18 — то же, что считает доступным сайт.
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
    slug = f"smoke-cal-{uuid.uuid4().hex[:6]}"
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
    check(True, f"компания {slug}, мастер 10–18")

    day = dt.date.today() + dt.timedelta(days=6)
    at = lambda h: dt.datetime.combine(day, dt.time(h), tzinfo=ALMATY).astimezone(dt.timezone.utc)
    print("1. Блокировка 13:00–14:00 в CRM")
    code, _ = call("POST", f"{crm}/api/v1/business/calendar-blocks", token=t, body={
        "branch_id": br["id"], "staff_id": st["id"], "starts_at_utc": at(13).isoformat(), "ends_at_utc": at(14).isoformat(), "block_reason": "Обед"})
    check(code == 201, "блокировка создана")

    print("2. Сайт записи")
    host = f"{slug}.localhost:{port}"
    code, res = call("POST", f"{booking}/api/v1/public/availability/search", host=host, body={
        "branch_id": br["id"], "service_ids": [svc["id"]], "staff_id": st["id"], "staff_mode": "specific",
        "from_date": day.isoformat(), "to_date": day.isoformat()})
    starts = [dt.datetime.fromisoformat(s["starts_at_utc"]) for s in res["slots"]]
    overlapping = [s for s in starts if s < at(14) and s + dt.timedelta(hours=1) > at(13)]
    check(not overlapping and at(12) in starts and at(14) in starts, "слотов, задевающих 13–14, нет; 12:00 и 14:00 есть")
    code, res = call("POST", f"{booking}/api/v1/public/bookings", host=host, headers={"Idempotency-Key": str(uuid.uuid4())}, body={
        "branch_id": br["id"], "staff_id": st["id"], "service_ids": [svc["id"]], "starts_at_utc": at(13).isoformat(),
        "expected_price_minor": 500000, "customer_name": "Клиент", "customer_phone": "+77010005555"})
    alts = res.get("detail", {}).get("details", {}).get("alternatives", []) if isinstance(res, dict) else []
    check(code == 409 and alts, f"бронь на 13:00 -> 409, предложено {len(alts)} других вариантов")

    print("3. Календарь CRM")
    code, cal = call("GET", f"{crm}/api/v1/business/calendar?date={day.isoformat()}&branch_id={br['id']}", token=t)
    free = [(dt.datetime.fromisoformat(w["starts_at_utc"]).astimezone(ALMATY).strftime("%H:%M"),
             dt.datetime.fromisoformat(w["ends_at_utc"]).astimezone(ALMATY).strftime("%H:%M")) for w in cal["staff"][0]["free"]]
    check(free == [("10:00", "13:00"), ("14:00", "18:00")], f"свободно: {free}")


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
    print("SMOKE PASSED: блокировка 13–14 закрывает время для клиента, календарь совпадает с сайтом")
    return 0


if __name__ == "__main__":
    sys.exit(main())
