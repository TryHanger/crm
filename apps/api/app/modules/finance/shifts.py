"""Кассовая смена (M13-D2).

- Смена открывается на кассу вида «наличные». Пока она открыта, все наличные движения этой кассы
  привязываются к ней. Без открытой смены наличные не принимаются и не выдаются (409 SHIFT_REQUIRED).
  Безналичные кассы (перевод, терминал, Kaspi) работают без смены.
- Закрытие: ожидаемая сумма = размен + Σ движений смены (оплаты, авансы − возвраты, сторно со знаком).
  Посчитанная сумма вводится кассиром, расхождение фиксируется; при расхождении нужна причина.
- Закрытая смена неизменяема, проводить в неё нельзя (триггеры БД, ревизия 009). Исправления —
  сторно в текущую открытую смену.
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Dict, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import CashAccount, CashShift, LedgerEntry
from apps.api.app.modules.finance.cash import KIND_SIGN
from apps.api.app.modules.finance.ledger import FinanceError


async def current_shift(db: AsyncSession, tenant_id: uuid.UUID, account_id: uuid.UUID) -> Optional[CashShift]:
    return (await db.execute(select(CashShift).where(
        CashShift.tenant_id == tenant_id, CashShift.cash_account_id == account_id, CashShift.status == "open"))).scalar_one_or_none()


async def shift_for_movement(db: AsyncSession, account: CashAccount) -> Optional[uuid.UUID]:
    """Наличные — только в открытую смену; безнал — без смены."""
    if account.kind != "cash":
        return None
    shift = await current_shift(db, account.tenant_id, account.id)
    if shift is None:
        raise FinanceError("SHIFT_REQUIRED", "Откройте кассовую смену: наличные принимаются только в открытую смену", 409)
    return shift.id


async def open_shift(db: AsyncSession, *, tenant_id: uuid.UUID, account: CashAccount, opening_float_minor: int,
                     actor_id: Optional[uuid.UUID]) -> CashShift:
    if account.kind != "cash":
        raise FinanceError("SHIFT_NOT_FOR_ACCOUNT", "Смена ведётся только для наличной кассы")
    if isinstance(opening_float_minor, bool) or not isinstance(opening_float_minor, int) or opening_float_minor < 0:
        raise FinanceError("AMOUNT_INVALID", "Размен — неотрицательное целое число в тиынах")
    shift = CashShift(tenant_id=tenant_id, branch_id=account.branch_id, cash_account_id=account.id,
                      opening_float_minor=opening_float_minor, opened_by_user_id=actor_id, status="open")
    db.add(shift)
    try:
        await db.flush()
    except IntegrityError as e:
        if "uq_cash_shift_one_open" in str(e):
            raise FinanceError("SHIFT_ALREADY_OPEN", "У этой кассы уже есть открытая смена", 409)
        raise
    return shift


async def shift_movements(db: AsyncSession, shift: CashShift) -> Dict[str, int]:
    rows = (await db.execute(select(LedgerEntry.kind, func.sum(LedgerEntry.amount_minor)).where(
        LedgerEntry.tenant_id == shift.tenant_id, LedgerEntry.cash_shift_id == shift.id).group_by(LedgerEntry.kind))).all()
    return {kind: int(total) for kind, total in rows}


def expected_cash(shift: CashShift, movements: Dict[str, int]) -> int:
    return shift.opening_float_minor + sum(KIND_SIGN.get(k, 0) * v for k, v in movements.items())


async def close_shift(db: AsyncSession, *, tenant_id: uuid.UUID, shift_id: uuid.UUID, counted_minor: int,
                      note: Optional[str], actor_id: Optional[uuid.UUID]) -> CashShift:
    shift = (await db.execute(select(CashShift).where(CashShift.tenant_id == tenant_id, CashShift.id == shift_id)
                              .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if shift is None:
        raise FinanceError("SHIFT_NOT_FOUND", "Смена не найдена", 404)
    if shift.status != "open":
        raise FinanceError("PERIOD_CLOSED", "Смена уже закрыта", 409)
    if isinstance(counted_minor, bool) or not isinstance(counted_minor, int) or counted_minor < 0:
        raise FinanceError("AMOUNT_INVALID", "Посчитанная сумма — неотрицательное целое число в тиынах")
    expected = expected_cash(shift, await shift_movements(db, shift))
    difference = counted_minor - expected
    if difference != 0 and not (note or "").strip():
        raise FinanceError("DIFFERENCE_REASON_REQUIRED",
                           f"Расхождение {difference / 100:+.2f}: укажите причину, смена закроется с этим расхождением")
    shift.status = "closed"
    shift.closed_at = dt.datetime.now(dt.timezone.utc)
    shift.closed_by_user_id = actor_id
    shift.expected_minor = expected
    shift.counted_minor = counted_minor
    shift.difference_minor = difference
    shift.close_note = (note or "").strip() or None
    await db.flush()
    return shift
