"""Финансовый отчёт салона из журнала денег (M14).

Все цифры — только из ledger_entries, никогда из статуса брони:
- «оказано» (выручка) = service_rendered + adjustment (возвраты за услугу уменьшают оказано);
- «получено» = payment − refund, с разбивкой по видам касс;
- авансы получены / зачтены отдельно: аванс — обязательство перед клиентом, не выручка;
- расходы по статьям; денежный поток = получено + авансы − расходы;
- на конец периода: долг клиентов по визитам и остаток авансов (обязательство).

Границы периода — локальные сутки каждого филиала (его часовой пояс): визит в 23:30 по Алматы
попадает в свой день, а не в следующий по UTC. Итог компании = сумма филиалов.
"""
from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict
from typing import Dict, Iterable, Optional, Set
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import Branch, CashAccount, ExpenseCategory, LedgerEntry
from apps.api.app.modules.finance.ledger import FinanceError

MAX_PERIOD_DAYS = 366
_FIELDS = ("rendered_minor", "received_minor", "advances_received_minor", "advances_applied_minor",
           "expenses_minor", "net_cash_flow_minor", "receivables_end_minor", "advance_liability_end_minor")


def local_bounds(date_from: dt.date, date_to: dt.date, tz_name: str):
    """[начало date_from, начало date_to + 1) в часовом поясе филиала, в UTC."""
    tz = ZoneInfo(tz_name or "Asia/Almaty")
    start = dt.datetime.combine(date_from, dt.time.min, tzinfo=tz).astimezone(dt.timezone.utc)
    end = dt.datetime.combine(date_to + dt.timedelta(days=1), dt.time.min, tzinfo=tz).astimezone(dt.timezone.utc)
    return start, end


def validate_period(date_from: dt.date, date_to: dt.date) -> None:
    if date_to < date_from:
        raise FinanceError("PERIOD_INVALID", "Дата окончания раньше даты начала")
    if (date_to - date_from).days + 1 > MAX_PERIOD_DAYS:
        raise FinanceError("PERIOD_TOO_LONG", f"Период отчёта не больше {MAX_PERIOD_DAYS} дней")


async def _by_kind(db: AsyncSession, tenant_id, branch_id, start=None, end=None, order_linked=False) -> Dict[str, int]:
    stmt = select(LedgerEntry.kind, func.sum(LedgerEntry.amount_minor)).where(
        LedgerEntry.tenant_id == tenant_id, LedgerEntry.branch_id == branch_id)
    if start is not None:
        stmt = stmt.where(LedgerEntry.occurred_at >= start)
    if end is not None:
        stmt = stmt.where(LedgerEntry.occurred_at < end)
    if order_linked:
        stmt = stmt.where(LedgerEntry.order_id.is_not(None))
    return {k: int(v) for k, v in (await db.execute(stmt.group_by(LedgerEntry.kind))).all()}


async def branch_finance(db: AsyncSession, tenant_id: uuid.UUID, branch: Branch, date_from: dt.date, date_to: dt.date) -> dict:
    start, end = local_bounds(date_from, date_to, branch.timezone_iana)
    k = await _by_kind(db, tenant_id, branch.id, start, end)
    rendered = k.get("service_rendered", 0) + k.get("adjustment", 0)
    received = k.get("payment", 0) - k.get("refund", 0)
    advances, applied, expenses = k.get("advance", 0), k.get("advance_applied", 0), k.get("expense", 0)

    by_account = defaultdict(int)
    rows = (await db.execute(select(CashAccount.kind, LedgerEntry.kind, func.sum(LedgerEntry.amount_minor))
                             .join(CashAccount, CashAccount.id == LedgerEntry.cash_account_id)
                             .where(LedgerEntry.tenant_id == tenant_id, LedgerEntry.branch_id == branch.id,
                                    LedgerEntry.occurred_at >= start, LedgerEntry.occurred_at < end,
                                    LedgerEntry.kind.in_(("payment", "refund")))
                             .group_by(CashAccount.kind, LedgerEntry.kind))).all()
    for acc_kind, kind, total in rows:
        by_account[acc_kind] += int(total) * (1 if kind == "payment" else -1)

    cats = (await db.execute(select(LedgerEntry.expense_category_id, ExpenseCategory.name, func.sum(LedgerEntry.amount_minor))
                             .join(ExpenseCategory, ExpenseCategory.id == LedgerEntry.expense_category_id)
                             .where(LedgerEntry.tenant_id == tenant_id, LedgerEntry.branch_id == branch.id,
                                    LedgerEntry.kind == "expense",
                                    LedgerEntry.occurred_at >= start, LedgerEntry.occurred_at < end)
                             .group_by(LedgerEntry.expense_category_id, ExpenseCategory.name))).all()

    upto = await _by_kind(db, tenant_id, branch.id, end=end, order_linked=True)
    receivables = (upto.get("service_rendered", 0) + upto.get("adjustment", 0) - upto.get("payment", 0)
                   + upto.get("refund", 0) - upto.get("advance_applied", 0))
    adv_upto = await _by_kind(db, tenant_id, branch.id, end=end)
    liability = adv_upto.get("advance", 0) - adv_upto.get("advance_applied", 0)

    return {
        "branch_id": str(branch.id), "branch_name": branch.name, "timezone": branch.timezone_iana,
        "period_start_utc": start.isoformat(), "period_end_utc": end.isoformat(),
        "rendered_minor": rendered, "received_minor": received, "received_by_account_kind": dict(by_account),
        "advances_received_minor": advances, "advances_applied_minor": applied,
        "expenses_minor": expenses,
        "expenses_by_category": sorted(({"category_id": str(cid), "name": name, "amount_minor": int(total)}
                                        for cid, name, total in cats), key=lambda c: (-c["amount_minor"], c["name"])),
        "net_cash_flow_minor": received + advances - expenses,
        "receivables_end_minor": receivables, "advance_liability_end_minor": liability,
    }


async def finance_report(db: AsyncSession, tenant_id: uuid.UUID, date_from: dt.date, date_to: dt.date,
                         branch_ids: Optional[Iterable[uuid.UUID]] = None) -> dict:
    """branch_ids=None — все филиалы компании; иначе только перечисленные (права админа)."""
    validate_period(date_from, date_to)
    stmt = select(Branch).where(Branch.tenant_id == tenant_id)
    if branch_ids is not None:
        ids: Set[uuid.UUID] = set(branch_ids)
        stmt = stmt.where(Branch.id.in_(ids)) if ids else stmt.where(False)
    branches = list((await db.execute(stmt.order_by(Branch.created_at, Branch.name))).scalars().all())
    per_branch = [await branch_finance(db, tenant_id, b, date_from, date_to) for b in branches]

    total = {f: sum(b[f] for b in per_branch) for f in _FIELDS}
    by_account = defaultdict(int)
    by_cat: Dict[str, dict] = {}
    for b in per_branch:
        for acc_kind, v in b["received_by_account_kind"].items():
            by_account[acc_kind] += v
        for c in b["expenses_by_category"]:
            row = by_cat.setdefault(c["category_id"], {"category_id": c["category_id"], "name": c["name"], "amount_minor": 0})
            row["amount_minor"] += c["amount_minor"]
    total["received_by_account_kind"] = dict(by_account)
    total["expenses_by_category"] = sorted(by_cat.values(), key=lambda c: (-c["amount_minor"], c["name"]))
    return {"period": {"from": date_from.isoformat(), "to": date_to.isoformat()}, "currency": "KZT",
            "source": "ledger", "total": total, "branches": per_branch}
