"""Smoke-тест M15 на живом стеке: клиент получил письмо, открыл управление записью; мастер не видит кассу.

Письмо уходит по-настоящему: воркер outbox -> SMTP (Mailpit на стенде), его читаем через API Mailpit.
"""
import argparse
import datetime as dt
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from smoke_accrual import ALMATY, new_company
from smoke_two_tenants import SmokeFailure, call, check


def mailpit(api, path):
    with urllib.request.urlopen(f"{api}{path}", timeout=10) as r:
        return json.loads(r.read())


def wait_mail(api, to, timeout=40):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = mailpit(api, "/api/v1/search?query=" + urllib.parse.quote(f'to:"{to}"'))
        if found.get("messages"):
            return mailpit(api, f"/api/v1/message/{found['messages'][0]['ID']}")
        time.sleep(1)
    raise SmokeFailure(f"письмо для {to.split('@')[0][:3]}***@{to.split('@')[1]} не пришло за {timeout} с (запущен ли воркер?)")


def run(console, crm, booking, mail_api):
    port = booking.rsplit(":", 1)[-1]
    slug, t, branch, staff, svc = new_company(console, crm, "smoke-mail")
    email = f"client-{uuid.uuid4().hex[:6]}@example.kz"
    day = dt.date.today() + dt.timedelta(days=4)
    start = dt.datetime.combine(day, dt.time(11), tzinfo=ALMATY).astimezone(dt.timezone.utc).isoformat()
    code, b = call("POST", f"{booking}/api/v1/public/bookings", host=f"{slug}.localhost:{port}",
                   headers={"Idempotency-Key": str(uuid.uuid4())}, body={
                       "branch_id": branch, "staff_id": staff, "service_ids": [svc], "starts_at_utc": start,
                       "expected_price_minor": 800000, "customer_name": "Анна", "customer_phone": "+77010009292",
                       "customer_email": email})
    check(code == 201, f"запись {b.get('public_ref')} с email клиента")

    msg = wait_mail(mail_api, email)
    check("Вы записаны" in msg["Subject"], f"письмо пришло через SMTP: «{msg['Subject']}»")
    m = re.search(r"(https?://\S+)/manage/([A-Za-z0-9_\-]+)", msg["Text"])
    check(m is not None, f"в письме ссылка управления записью ({m.group(1) if m else '-'})")
    code, manage = call("GET", f"{booking}/api/v1/public/manage/{m.group(2)}", host=f"{slug}.localhost:{port}")
    check(code == 200 and manage["booking_id"] == b["booking_id"] and manage["can_cancel"],
          "клиент открыл управление записью по ссылке из письма: можно перенести и отменить")
    with urllib.request.urlopen(urllib.request.Request(f"{booking}/manage/{m.group(2)}", headers={"Host": f"{slug}.localhost:{port}"}), timeout=10) as r:
        check(r.status == 200, "страница управления записью открывается на сайте записи")

    _, settings_ = call("GET", f"{crm}/api/v1/business/notification-settings", token=t)
    check(settings_["sent_last_24h"] >= 1, f"журнал доставок: отправлено за сутки {settings_['sent_last_24h']}")

    memail = f"master-{uuid.uuid4().hex[:6]}@example.kz"
    code, inv = call("POST", f"{crm}/api/v1/business/invites", token=t, body={"email": memail, "role": "master", "staff_id": staff})
    check(code == 201, "мастер приглашён к своему профилю")
    _, acc = call("POST", f"{crm}/api/v1/auth/accept-invite", body={"token": inv["invite_token"], "password": "Smoke-Master-1"})
    mt = acc["access_token"]
    code, _ = call("GET", f"{crm}/api/v1/business/cash-accounts?branch_id={branch}", token=mt)
    code2, card = call("GET", f"{crm}/api/v1/business/bookings/{b['booking_id']}", token=mt)
    check(code == 403 and code2 == 200 and card["finance"] is None, "мастер видит свою запись, но не видит кассу и деньги")


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--console", default="http://127.0.0.1:3002")
    p.add_argument("--crm", default="http://127.0.0.1:3001")
    p.add_argument("--booking", default="http://127.0.0.1:3000")
    p.add_argument("--mailpit", default="http://127.0.0.1:8025")
    a = p.parse_args()
    try:
        run(a.console.rstrip("/"), a.crm.rstrip("/"), a.booking.rstrip("/"), a.mailpit.rstrip("/"))
    except SmokeFailure as e:
        print(f"FAIL {e}")
        return 1
    except (urllib.error.URLError, ConnectionError, KeyError, IndexError, TypeError, StopIteration) as e:
        print(f"FAIL {type(e).__name__}: {e}")
        return 1
    print("SMOKE PASSED: письмо доставлено, управление записью открыто, мастер не видит кассу")
    return 0


if __name__ == "__main__":
    sys.exit(main())
