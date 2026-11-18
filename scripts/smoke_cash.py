"""Smoke-тест M12 на живом стеке: по заказу 8000 KZT внесли 3000 -> оплачено 3000, долг 5000,
касса сходится с журналом; повтор того же запроса не принимает деньги второй раз.
"""
import argparse
import sys
import urllib.error
import uuid

from smoke_accrual import book, new_company
from smoke_two_tenants import SmokeFailure, call, check


def run(console, crm, booking):
    port = booking.rsplit(":", 1)[-1]
    slug, t, branch, staff, svc = new_company(console, crm, "smoke-cash")
    b = book(booking, slug, port, branch, staff, svc, 11)
    call("PATCH", f"{crm}/api/v1/business/bookings/{b['booking_id']}/status", token=t, body={"status": "completed"})
    _, accounts = call("GET", f"{crm}/api/v1/business/cash-accounts?branch_id={branch}", token=t)
    cash = next(a for a in accounts if a["kind"] == "cash")
    check(len(accounts) == 2, f"кассы филиала: {[a['name'] for a in accounts]}")
    code, _ = call("POST", f"{crm}/api/v1/business/cash-shifts/open", token=t, body={"cash_account_id": cash["id"]})
    check(code == 201, "кассовая смена открыта")
    key = f"smoke-pay-{uuid.uuid4()}"
    code, res = call("POST", f"{crm}/api/v1/business/bookings/{b['booking_id']}/payments", token=t,
                     headers={"Idempotency-Key": key}, body={"amount_minor": 300000, "cash_account_id": cash["id"]})
    f = res.get("finance", {}) if isinstance(res, dict) else {}
    check(code == 201 and (f.get("received_minor"), f.get("debt_minor")) == (300000, 500000), "внесли 3000: оплачено 3000, долг 5000")
    code, res = call("POST", f"{crm}/api/v1/business/bookings/{b['booking_id']}/payments", token=t,
                     headers={"Idempotency-Key": key}, body={"amount_minor": 300000, "cash_account_id": cash["id"]})
    check(code == 201 and res["replayed"] and res["finance"]["received_minor"] == 300000, "повтор запроса: та же оплата, деньги не удвоены")
    _, accounts = call("GET", f"{crm}/api/v1/business/cash-accounts?branch_id={branch}", token=t)
    bal = next(a for a in accounts if a["kind"] == "cash")["balance_minor"]
    _, card = call("GET", f"{crm}/api/v1/business/bookings/{b['booking_id']}", token=t)
    check(bal == 300000 and card["finance"]["rendered_minor"] == 800000, "касса 3000 = получено; выручка (оказано) 8000 отдельно")


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
    except (urllib.error.URLError, ConnectionError, KeyError, IndexError, TypeError, StopIteration) as e:
        print(f"FAIL {type(e).__name__}: {e}")
        return 1
    print("SMOKE PASSED: 3000 из 8000 — оплачено 3000, долг 5000, касса сходится")
    return 0


if __name__ == "__main__":
    sys.exit(main())
