"""Smoke-тест M14 на живом стеке: финансовый отчёт из журнала денег.

Визит 8000, оплата 3000 -> отчёт: оказано 8000, получено 3000, долг 5000. Расход «Аренда» 1000 из
кассы смены -> расходы 1000, денежный поток 2000, ожидаемая сумма смены уменьшилась. Итог = сумма филиалов.
"""
import argparse
import datetime as dt
import sys
import urllib.error
import uuid

from smoke_accrual import book, new_company
from smoke_two_tenants import SmokeFailure, call, check


def run(console, crm, booking):
    port = booking.rsplit(":", 1)[-1]
    slug, t, branch, staff, svc = new_company(console, crm, "smoke-reports")
    _, accounts = call("GET", f"{crm}/api/v1/business/cash-accounts?branch_id={branch}", token=t)
    cash = next(a["id"] for a in accounts if a["kind"] == "cash")
    code, shift = call("POST", f"{crm}/api/v1/business/cash-shifts/open", token=t, body={"cash_account_id": cash, "opening_float_minor": 0})
    check(code == 201, "смена открыта")
    b = book(booking, slug, port, branch, staff, svc, 13)
    call("PATCH", f"{crm}/api/v1/business/bookings/{b['booking_id']}/status", token=t, body={"status": "completed"})
    code, _ = call("POST", f"{crm}/api/v1/business/bookings/{b['booking_id']}/payments", token=t,
                   headers={"Idempotency-Key": str(uuid.uuid4())}, body={"amount_minor": 300000, "cash_account_id": cash})
    check(code == 201, "оплата 3000 принята")

    today = dt.date.today()
    period = f"from_date={today - dt.timedelta(days=1)}&to_date={today + dt.timedelta(days=60)}"
    _, rep = call("GET", f"{crm}/api/v1/business/reports/finance?{period}", token=t)
    tot = rep["total"]
    check((tot["rendered_minor"], tot["received_minor"], tot["receivables_end_minor"]) == (800000, 300000, 500000),
          "отчёт из журнала: оказано 8000, получено 3000, долг 5000")

    _, cats = call("GET", f"{crm}/api/v1/business/expense-categories", token=t)
    rent = next(c["id"] for c in cats if c["name"] == "Аренда")
    code, res = call("POST", f"{crm}/api/v1/business/expenses", token=t, headers={"Idempotency-Key": str(uuid.uuid4())},
                     body={"branch_id": branch, "cash_account_id": cash, "category_id": rent, "amount_minor": 100000, "reason": "Аренда"})
    check(code == 201, f"расход «Аренда» 1000 проведён ({code})")
    _, rep = call("GET", f"{crm}/api/v1/business/reports/finance?{period}", token=t)
    tot = rep["total"]
    check(tot["expenses_minor"] == 100000 and tot["net_cash_flow_minor"] == 200000 and tot["rendered_minor"] == 800000,
          "расходы 1000, денежный поток 2000, выручка не изменилась")
    fields = ("rendered_minor", "received_minor", "expenses_minor", "receivables_end_minor")
    check(all(tot[f] == sum(br[f] for br in rep["branches"]) for f in fields), "итог компании = сумма филиалов")
    _, sh = call("GET", f"{crm}/api/v1/business/cash-shifts/{shift['id']}", token=t)
    check(sh["expected_minor"] == 200000, "смена: ожидается 2000 (3000 оплаты − 1000 расхода)")
    _, ov = call("GET", f"{crm}/api/v1/business/reports/overview?{period}", token=t)
    check(ov["paid_revenue_minor"] == 300000 and ov["payment_collection_enabled"] is True,
          "обзор берёт «получено» из журнала, а не из статуса брони")


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
    print("SMOKE PASSED: отчёт из журнала — 8000 оказано, 3000 получено, 5000 долг, расход сверен")
    return 0


if __name__ == "__main__":
    sys.exit(main())
