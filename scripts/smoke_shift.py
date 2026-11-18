"""Smoke-тест M13 на живом стеке: частичная оплата, возврат 1000, аванс 2000 отражены и сверены сменой.
"""
import argparse
import sys
import urllib.error
import urllib.parse
import uuid

from smoke_accrual import book, new_company
from smoke_two_tenants import SmokeFailure, call, check


def run(console, crm, booking):
    port = booking.rsplit(":", 1)[-1]
    slug, t, branch, staff, svc = new_company(console, crm, "smoke-shift")
    _, accounts = call("GET", f"{crm}/api/v1/business/cash-accounts?branch_id={branch}", token=t)
    cash = next(a["id"] for a in accounts if a["kind"] == "cash")
    code, shift = call("POST", f"{crm}/api/v1/business/cash-shifts/open", token=t, body={"cash_account_id": cash, "opening_float_minor": 1000000})
    check(code == 201, "смена открыта, размен 10 000")
    b = book(booking, slug, port, branch, staff, svc, 12)
    call("PATCH", f"{crm}/api/v1/business/bookings/{b['booking_id']}/status", token=t, body={"status": "completed"})

    def money(path, body):
        code, res = call("POST", f"{crm}/api/v1/business/{path}", token=t, headers={"Idempotency-Key": str(uuid.uuid4())}, body=body)
        if code != 201:
            raise SmokeFailure(f"{path}: {code} {res}")
        return res

    money(f"bookings/{b['booking_id']}/payments", {"amount_minor": 300000, "cash_account_id": cash})
    res = money(f"bookings/{b['booking_id']}/refunds", {"amount_minor": 100000, "cash_account_id": cash, "reason": "Жалоба"})
    f = res["finance"]
    check((f["rendered_minor"], f["received_minor"], f["debt_minor"]) == (700000, 200000, 500000),
          "оплата 3000, возврат 1000: оказано 7000, получено 2000, долг 5000")
    _, found = call("GET", f"{crm}/api/v1/business/customers?search={urllib.parse.quote('Клиент')}", token=t)
    cust = found[0]["id"]
    res = money(f"customers/{cust}/advances", {"branch_id": branch, "amount_minor": 200000, "cash_account_id": cash})
    check(res["advance_balance_minor"] == 200000, "аванс 2000 принят (обязательство, не выручка)")
    res = money(f"bookings/{b['booking_id']}/apply-advance", {"amount_minor": 200000})
    check(res["finance"]["debt_minor"] == 300000, "аванс зачтён: долг 3000")
    code, closed = call("POST", f"{crm}/api/v1/business/cash-shifts/{shift['id']}/close", token=t, body={"counted_minor": 1400000})
    check(code == 200 and closed["expected_minor"] == 1400000 and closed["difference_minor"] == 0,
          f"смена сверена: ожидалось {closed.get('expected_minor', 0) // 100}, посчитано 14000, расхождение 0")
    code, res = call("POST", f"{crm}/api/v1/business/bookings/{b['booking_id']}/payments", token=t,
                     headers={"Idempotency-Key": str(uuid.uuid4())}, body={"amount_minor": 100000, "cash_account_id": cash})
    check(code == 409 and res["detail"]["code"] == "SHIFT_REQUIRED", "после закрытия наличные не принимаются (период закрыт)")


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
    print("SMOKE PASSED: оплата, возврат 1000 и аванс 2000 сверены кассовой сменой")
    return 0


if __name__ == "__main__":
    sys.exit(main())
