"""M14-D2: расходы и финансовый отчёт из журнала денег.

Приёмка: отчёт показывает 8000 оказано, 3000 получено, 5000 долг; итог двух филиалов сходится.
STOP: отчёты берут «оплату» из статуса брони.
"""
import asyncio
import datetime as dt
import uuid
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.tests.company_factory import client, invite_admin, new_company

DAY = dt.date.today() + dt.timedelta(days=14)
FIELDS = ("rendered_minor", "received_minor", "advances_received_minor", "advances_applied_minor",
          "expenses_minor", "net_cash_flow_minor", "receivables_end_minor", "advance_liability_end_minor")


def sql(q, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(q), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


def k():
    return str(uuid.uuid4())


async def setup(c):
    co = await new_company(c, "Asia/Almaty")
    co.master = await co.staff("Мастер", "09:00", "21:00")
    co.svc = await co.service(8000_00, minutes=60)
    co.cash, co.bank = await accounts(co, co.branch_id)
    cats = (await c.get("/api/v1/business/expense-categories", headers=co.h)).json()
    co.cat = {x["name"]: x["id"] for x in cats}
    return co


async def accounts(co, branch):
    accs = {a["kind"]: a["id"] for a in (await co.c.get(f"/api/v1/business/cash-accounts?branch_id={branch}", headers=co.h)).json()}
    return accs["cash"], accs["bank_transfer"]


async def visit(co, hour, phone="+77010007200"):
    start = dt.datetime.combine(DAY, dt.time(hour), tzinfo=co.tz).astimezone(dt.timezone.utc)
    r = await co.c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": k()}, json={
        "branch_id": co.branch_id, "staff_id": co.master, "service_ids": [co.svc], "starts_at_utc": start.isoformat(),
        "expected_price_minor": 8000_00, "customer_name": "Клиент Отчёта", "customer_phone": phone})
    assert r.status_code == 201, r.text
    bid = r.json()["booking_id"]
    assert (await co.c.patch(f"/api/v1/business/bookings/{bid}/status", headers=co.h, json={"status": "completed"})).status_code == 200
    return bid, str(sql("SELECT customer_id FROM bookings WHERE id = :b", b=bid)[0][0])


async def post(co, path, body, key=None, h=None):
    return await co.c.post(path, headers={**(h or co.h), "Idempotency-Key": key or k()}, json=body)


async def open_shift(co, account, float_minor=0):
    r = await co.c.post("/api/v1/business/cash-shifts/open", headers=co.h, json={"cash_account_id": account, "opening_float_minor": float_minor})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def expense(co, amount, category="Аренда", account=None, branch=None, key=None, reason="Аренда за месяц", h=None):
    return await post(co, "/api/v1/business/expenses", {"branch_id": branch or co.branch_id, "cash_account_id": account or co.cash,
                                                       "category_id": co.cat[category], "amount_minor": amount, "reason": reason}, key, h)


async def report(co, frm=None, to=None, branch=None, h=None):
    q = f"from_date={(frm or dt.date.today()).isoformat()}&to_date={(to or DAY).isoformat()}"
    if branch:
        q += f"&branch_id={branch}"
    r = await co.c.get(f"/api/v1/business/reports/finance?{q}", headers=h or co.h)
    assert r.status_code == 200, r.text
    return r.json()


def reconciles(rep):
    for f in FIELDS:
        assert rep["total"][f] == sum(b[f] for b in rep["branches"]), f


# ---------------------------------------------------------------- acceptance

async def test_report_8000_rendered_3000_received_5000_debt():
    async with client() as c:
        co = await setup(c)
        shift = await open_shift(co, co.cash, float_minor=5000_00)
        bid, _ = await visit(co, 10)
        assert (await post(co, f"/api/v1/business/bookings/{bid}/payments", {"amount_minor": 3000_00, "cash_account_id": co.cash})).status_code == 201
        # a booked-but-not-completed visit is not money: the report must not take it from booking status
        start = dt.datetime.combine(DAY, dt.time(14), tzinfo=co.tz).astimezone(dt.timezone.utc)
        r = await c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": k()}, json={
            "branch_id": co.branch_id, "staff_id": co.master, "service_ids": [co.svc], "starts_at_utc": start.isoformat(),
            "expected_price_minor": 8000_00, "customer_name": "Будущий", "customer_phone": "+77010007299"})
        assert r.status_code == 201

        rep = await report(co)
        t = rep["total"]
        assert rep["source"] == "ledger"
        assert (t["rendered_minor"], t["received_minor"], t["receivables_end_minor"]) == (8000_00, 3000_00, 5000_00)
        assert t["received_by_account_kind"] == {"cash": 3000_00}
        reconciles(rep)

        r = await expense(co, 1500_00)
        assert r.status_code == 201, r.text
        assert (await expense(co, 200_00, category="Материалы", reason="Краска")).status_code == 201
        t = (await report(co))["total"]
        assert t["expenses_minor"] == 1700_00
        assert [(x["name"], x["amount_minor"]) for x in t["expenses_by_category"]] == [("Аренда", 1500_00), ("Материалы", 200_00)]
        assert t["net_cash_flow_minor"] == 3000_00 - 1700_00
        assert t["rendered_minor"] == 8000_00                               # расход не уменьшает выручку

        sh = (await c.get(f"/api/v1/business/cash-shifts/{shift}", headers=co.h)).json()
        assert sh["movements"]["expense"] == 1700_00 and sh["expected_minor"] == 5000_00 + 3000_00 - 1700_00

        ov = (await c.get(f"/api/v1/business/reports/overview?from_date={dt.date.today()}&to_date={DAY}", headers=co.h)).json()
        assert (ov["completed_revenue_minor"], ov["paid_revenue_minor"], ov["debt_minor"]) == (8000_00, 3000_00, 5000_00)
        assert ov["payment_collection_enabled"] is True and ov["expenses_minor"] == 1700_00
        assert sum(s["revenue_minor"] for s in ov["staff_stats"]) == 8000_00

        hist = (await c.get(f"/api/v1/business/expenses?branch_id={co.branch_id}&from_date={dt.date.today()}&to_date={DAY}", headers=co.h)).json()
        assert [(e["category"], e["amount_minor"], e["reason"]) for e in hist] == [("Аренда", 1500_00, "Аренда за месяц"), ("Материалы", 200_00, "Краска")]
        assert all(e["created_by_user_id"] for e in hist)


async def test_two_branches_reconcile_and_admin_sees_only_granted():
    async with client() as c:
        co = await setup(c)
        await open_shift(co, co.cash)
        bid, cust = await visit(co, 11)
        await post(co, f"/api/v1/business/bookings/{bid}/payments", {"amount_minor": 3000_00, "cash_account_id": co.bank})
        second = str(sql("INSERT INTO branches (id, tenant_id, name, city, address, timezone_iana, status, created_at) "
                         "VALUES (gen_random_uuid(), :t, 'Второй', 'Астана', 'ул. 2', 'Asia/Almaty', 'active', now() + interval '1 second') "
                         "RETURNING id", t=co.tenant_id)[0][0])
        cash2, bank2 = await accounts(co, second)
        await open_shift(co, cash2)
        r = await post(co, f"/api/v1/business/customers/{cust}/advances", {"branch_id": second, "amount_minor": 2000_00, "cash_account_id": cash2})
        assert r.status_code == 201, r.text
        assert (await expense(co, 500_00, account=cash2, branch=second, category="Материалы")).status_code == 201
        assert (await expense(co, 700_00, account=bank2, branch=second, category="Аренда")).status_code == 201   # безнал без смены

        rep = await report(co)
        reconciles(rep)
        b1, b2 = rep["branches"]
        assert (b1["rendered_minor"], b1["received_minor"], b1["receivables_end_minor"]) == (8000_00, 3000_00, 5000_00)
        assert (b2["rendered_minor"], b2["advances_received_minor"], b2["expenses_minor"]) == (0, 2000_00, 1200_00)
        assert b2["net_cash_flow_minor"] == 2000_00 - 1200_00
        t = rep["total"]
        assert (t["received_minor"], t["advance_liability_end_minor"], t["expenses_minor"]) == (3000_00, 2000_00, 1200_00)
        # independent check straight from the ledger
        raw = dict(sql("SELECT kind, sum(amount_minor) FROM ledger_entries WHERE tenant_id = :t GROUP BY kind", t=co.tenant_id))
        assert t["rendered_minor"] == raw.get("service_rendered", 0) + raw.get("adjustment", 0)
        assert t["expenses_minor"] == raw["expense"] and t["advances_received_minor"] == raw["advance"]

        only2 = await report(co, branch=second)
        assert [b["branch_id"] for b in only2["branches"]] == [second] and only2["total"] == {**only2["total"], **{f: b2[f] for f in FIELDS}}

        admin_h, membership = await invite_admin(co)
        sql("INSERT INTO branch_role_grants (id, membership_id, branch_id) VALUES (gen_random_uuid(), :m, :b)", m=membership, b=second)
        adm = await report(co, h=admin_h)
        assert [b["branch_id"] for b in adm["branches"]] == [second] and adm["total"]["rendered_minor"] == 0
        r = await c.get(f"/api/v1/business/reports/finance?from_date={dt.date.today()}&to_date={DAY}&branch_id={co.branch_id}", headers=admin_h)
        assert r.status_code == 403
        ov = (await c.get(f"/api/v1/business/reports/overview?from_date={dt.date.today()}&to_date={DAY}", headers=admin_h)).json()
        assert ov["completed_revenue_minor"] == 0 and ov["total_bookings"] == 0     # чужой филиал не виден и в обзоре

        r = await c.post("/api/v1/auth/login", json={"email": "damir@barberhouse.kz", "password": "Password123!"})
        master_h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        for path in ("/api/v1/business/reports/finance?from_date=2026-01-01&to_date=2026-01-31", "/api/v1/business/expense-categories"):
            assert (await c.get(path, headers=master_h)).status_code == 403


async def test_period_uses_branch_local_days():
    async with client() as c:
        co = await setup(c)
        day = dt.date.today() + dt.timedelta(days=40)
        # 02:00 по Алматы — это ещё предыдущие сутки по UTC
        at = dt.datetime.combine(day, dt.time(2), tzinfo=ZoneInfo("Asia/Almaty"))
        assert at.astimezone(dt.timezone.utc).date() == day - dt.timedelta(days=1)
        sql("INSERT INTO ledger_entries (id, tenant_id, branch_id, kind, amount_minor, currency, idempotency_key, occurred_at) "
            "VALUES (gen_random_uuid(), :t, :b, 'service_rendered', 1234_00, 'KZT', :k, :at)",
            t=co.tenant_id, b=co.branch_id, k=k(), at=at)
        assert (await report(co, day, day))["total"]["rendered_minor"] == 1234_00
        assert (await report(co, day - dt.timedelta(days=1), day - dt.timedelta(days=1)))["total"]["rendered_minor"] == 0
        r = await c.get(f"/api/v1/business/reports/finance?from_date={day}&to_date={day - dt.timedelta(days=1)}", headers=co.h)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "PERIOD_INVALID"
        r = await c.get("/api/v1/business/reports/finance?from_date=2025-01-01&to_date=2026-12-31", headers=co.h)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "PERIOD_TOO_LONG"


# ---------------------------------------------------------------- expense rules

async def test_expense_rules():
    async with client() as c:
        co = await setup(c)
        r = await expense(co, 100_00)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "SHIFT_REQUIRED"
        await open_shift(co, co.cash, float_minor=1000_00)
        r = await expense(co, 1000_01)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "INSUFFICIENT_CASH"
        r = await post(co, "/api/v1/business/expenses", {"branch_id": co.branch_id, "cash_account_id": co.cash,
                                                         "category_id": co.cat["Аренда"], "amount_minor": 100, "reason": ""})
        assert r.status_code == 422
        r = await c.post("/api/v1/business/expenses", headers=co.h, json={"branch_id": co.branch_id, "cash_account_id": co.cash,
                                                                          "category_id": co.cat["Аренда"], "amount_minor": 100, "reason": "x"})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"

        key = k()
        r1, r2 = await expense(co, 300_00, key=key), await expense(co, 300_00, key=key)
        assert r1.status_code == r2.status_code == 201 and r2.json()["replayed"] is True and r1.json()["entry_id"] == r2.json()["entry_id"]
        r = await expense(co, 400_00, key=key)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"

        # parallel expenses of one till never overdraw it (700 left)
        results = await asyncio.gather(expense(co, 500_00), expense(co, 500_00))
        assert sorted(r.status_code for r in results) == [201, 409], [r.text for r in results]

        # storno of a mistaken expense: money back into the till, report nets out
        wrong = [r for r in results if r.status_code == 201][0].json()["entry_id"]
        r = await post(co, f"/api/v1/business/ledger-entries/{wrong}/reverse", {"reason": "Ошиблись статьёй"})
        assert r.status_code == 201, r.text
        assert (await report(co))["total"]["expenses_minor"] == 300_00

        r = await c.post("/api/v1/business/expense-categories", headers=co.h, json={"name": "  Реклама  "})
        assert r.status_code == 201 and r.json()["name"] == "Реклама"
        r = await c.post("/api/v1/business/expense-categories", headers=co.h, json={"name": "Реклама"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "EXPENSE_CATEGORY_EXISTS"
        assert (await c.post(f"/api/v1/business/expense-categories/{co.cat['Прочее']}/archive", headers=co.h)).status_code == 200
        r = await expense(co, 100, category="Прочее")
        assert r.status_code == 422 and r.json()["detail"]["code"] == "EXPENSE_CATEGORY_ARCHIVED"
        names = [x["name"] for x in (await c.get("/api/v1/business/expense-categories", headers=co.h)).json()]
        assert "Прочее" not in names and "Реклама" in names

        other = await setup(c)
        r = await post(co, "/api/v1/business/expenses", {"branch_id": co.branch_id, "cash_account_id": co.cash,
                                                         "category_id": other.cat["Аренда"], "amount_minor": 100, "reason": "x"})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "EXPENSE_CATEGORY_NOT_FOUND"
        assert (await report(other))["total"]["expenses_minor"] == 0         # чужие расходы не видны
