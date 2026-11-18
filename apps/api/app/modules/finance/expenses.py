"""Расходы салона (M14): деньги из кассы по статье расхода.

- Расход — запись журнала вида `expense` с кассой, статьёй, причиной и автором. Наличный расход
  проводится только в открытую смену и не больше, чем по журналу лежит в кассе смены.
- Повтор с тем же Idempotency-Key возвращает ту же операцию; ошибочный расход — сторно (cash.reverse).
- Статьи — справочник компании; архивная статья не принимает новые расходы, история остаётся.
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import CashShift, ExpenseCategory, LedgerEntry
from apps.api.app.modules.finance import ledger, money
from apps.api.app.modules.finance.cash import MoneyResult, _amount, _key, _shift, require_account
from apps.api.app.modules.finance.ledger import FinanceError

DEFAULT_CATEGORIES = ("Аренда", "Материалы", "Зарплата", "Коммунальные услуги", "Прочее")


async def list_categories(db: AsyncSession, tenant_id: uuid.UUID, include_archived: bool = False) -> List[ExpenseCategory]:
    stmt = select(ExpenseCategory).where(ExpenseCategory.tenant_id == tenant_id)
    if not include_archived:
        stmt = stmt.where(ExpenseCategory.archived_at.is_(None))
    rows = list((await db.execute(stmt.order_by(ExpenseCategory.created_at, ExpenseCategory.name))).scalars().all())
    if not rows and not include_archived:
        existing = (await db.execute(select(ExpenseCategory.id).where(ExpenseCategory.tenant_id == tenant_id).limit(1))).first()
        if existing is None:  # a fresh company gets a starter set once
            await db.execute(pg_insert(ExpenseCategory).values([
                {"id": uuid.uuid4(), "tenant_id": tenant_id, "name": n} for n in DEFAULT_CATEGORIES]).on_conflict_do_nothing())
            rows = list((await db.execute(stmt.order_by(ExpenseCategory.created_at, ExpenseCategory.name))).scalars().all())
    return rows


async def create_category(db: AsyncSession, tenant_id: uuid.UUID, name: str) -> ExpenseCategory:
    name = " ".join((name or "").split())
    if not name or len(name) > 128:
        raise FinanceError("EXPENSE_CATEGORY_NAME_INVALID", "Название статьи: 1–128 символов")
    new_id = (await db.execute(pg_insert(ExpenseCategory).values(id=uuid.uuid4(), tenant_id=tenant_id, name=name)
                               .on_conflict_do_nothing().returning(ExpenseCategory.id))).scalar_one_or_none()
    if new_id is None:
        raise FinanceError("EXPENSE_CATEGORY_EXISTS", "Такая статья расхода уже есть", 409)
    return (await db.execute(select(ExpenseCategory).where(ExpenseCategory.id == new_id))).scalar_one()


async def archive_category(db: AsyncSession, tenant_id: uuid.UUID, category_id: uuid.UUID) -> ExpenseCategory:
    cat = await _category(db, tenant_id, category_id)
    if cat.archived_at is None:
        cat.archived_at = dt.datetime.now(dt.timezone.utc)
        await db.flush()
    return cat


async def _category(db: AsyncSession, tenant_id: uuid.UUID, category_id: uuid.UUID) -> ExpenseCategory:
    cat = (await db.execute(select(ExpenseCategory).where(
        ExpenseCategory.tenant_id == tenant_id, ExpenseCategory.id == category_id))).scalar_one_or_none()
    if cat is None:
        raise FinanceError("EXPENSE_CATEGORY_NOT_FOUND", "Статья расхода не найдена")
    return cat


async def record_expense(db: AsyncSession, *, tenant_id: uuid.UUID, branch_id: uuid.UUID, cash_account_id: uuid.UUID,
                         category_id: uuid.UUID, amount_minor: int, reason: str, idempotency_key: str,
                         actor_id: Optional[uuid.UUID] = None) -> MoneyResult:
    key = _key(idempotency_key)
    account = await require_account(db, tenant_id, branch_id, cash_account_id)
    category = await _category(db, tenant_id, category_id)
    prev = (await db.execute(select(LedgerEntry).where(
        LedgerEntry.tenant_id == tenant_id, LedgerEntry.idempotency_key == key))).scalar_one_or_none()
    if prev is not None:
        if (prev.kind, prev.amount_minor, prev.cash_account_id, prev.expense_category_id) != \
                ("expense", amount_minor, account.id, category.id):
            raise FinanceError("IDEMPOTENCY_KEY_REUSED", "Ключ операции уже использован для другой операции", 409)
        return MoneyResult(prev, False)
    _amount(amount_minor)
    if not (reason or "").strip():
        raise FinanceError("REASON_REQUIRED", "Укажите, за что расход")
    if category.archived_at is not None:
        raise FinanceError("EXPENSE_CATEGORY_ARCHIVED", "Статья расхода в архиве")
    shift_id = await _shift(db, account)
    if shift_id is not None:
        from apps.api.app.modules.finance import shifts
        # parallel cash expenses of one till are serialized on the shift row: the till never goes negative
        shift = (await db.execute(select(CashShift).where(CashShift.id == shift_id).with_for_update()
                                  .execution_options(populate_existing=True))).scalar_one()
        available = shifts.expected_cash(shift, await shifts.shift_movements(db, shift))
        if amount_minor > available:
            raise FinanceError("INSUFFICIENT_CASH", f"В кассе по журналу {available / 100:.2f}: расход больше остатка", 409)
    res = await ledger.post_entry(db, tenant_id=tenant_id, branch_id=branch_id, kind="expense", amount_minor=amount_minor,
                                  currency=money.DEFAULT_CURRENCY, idempotency_key=key, cash_account_id=account.id,
                                  cash_shift_id=shift_id, expense_category_id=category.id,
                                  created_by_user_id=actor_id, reason=reason.strip())
    return MoneyResult(res.entry, res.created)
