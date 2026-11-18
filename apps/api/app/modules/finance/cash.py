"""Ручная касса и частичная оплата (M12-D2).

- Деньги всегда проходят через кассу филиала: наличные, терминал, перевод, Kaspi.
  У каждого филиала по умолчанию есть «Наличные» и «Перевод / терминал».
- Оплата заказа — запись payment в журнале, привязанная к заказу и кассе. «Получено» и
  «оказано» — разные суммы (выручка = оказано; деньги = получено), они не смешиваются.
- Повтор с тем же ключом возвращает ту же оплату (до любых проверок долга),
  оплата сверх долга запрещена (аванс — M13). Оплаты одного заказа сериализуются
  блокировкой строки заказа: две параллельные оплаты не превысят долг.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import CashAccount, LedgerEntry, Order
from apps.api.app.modules.finance import ledger
from apps.api.app.modules.finance.ledger import FinanceError

DEFAULT_ACCOUNTS = (("Наличные", "cash"), ("Перевод / терминал", "bank_transfer"))
KIND_SIGN = {"payment": 1, "advance": 1, "refund": -1, "expense": -1}  # движение денег по кассе


async def ensure_default_accounts(db: AsyncSession, tenant_id: uuid.UUID, branch_id: uuid.UUID) -> List[CashAccount]:
    stmt = select(CashAccount).where(CashAccount.tenant_id == tenant_id, CashAccount.branch_id == branch_id)         .order_by(CashAccount.created_at, CashAccount.name)
    accounts = list((await db.execute(stmt)).scalars().all())
    if not accounts:
        # concurrent first payments in a new branch must not collide on the default names
        await db.execute(pg_insert(CashAccount).values([
            {"id": uuid.uuid4(), "tenant_id": tenant_id, "branch_id": branch_id, "name": name, "kind": kind, "active": True}
            for name, kind in DEFAULT_ACCOUNTS]).on_conflict_do_nothing())
        accounts = list((await db.execute(stmt)).scalars().all())
    return accounts


async def require_account(db: AsyncSession, tenant_id: uuid.UUID, branch_id: uuid.UUID, account_id: uuid.UUID) -> CashAccount:
    acc = (await db.execute(select(CashAccount).where(
        CashAccount.tenant_id == tenant_id, CashAccount.id == account_id))).scalar_one_or_none()
    if acc is None or acc.branch_id != branch_id:
        raise FinanceError("CASH_ACCOUNT_NOT_FOUND", "Касса не найдена в этом филиале")
    if not acc.active:
        raise FinanceError("CASH_ACCOUNT_INACTIVE", "Касса отключена")
    return acc


async def _existing(db: AsyncSession, tenant_id: uuid.UUID, key: str) -> Optional[LedgerEntry]:
    return (await db.execute(select(LedgerEntry).where(
        LedgerEntry.tenant_id == tenant_id, LedgerEntry.idempotency_key == key))).scalar_one_or_none()


@dataclass
class PaymentResult:
    entry: LedgerEntry
    created: bool
    position: ledger.OrderPosition


async def record_payment(
    db: AsyncSession, *, tenant_id: uuid.UUID, order_id: uuid.UUID, amount_minor: int, cash_account_id: uuid.UUID,
    idempotency_key: str, actor_id: Optional[uuid.UUID] = None, note: Optional[str] = None,
) -> PaymentResult:
    """Принимает оплату по заказу. Не коммитит."""
    key = (idempotency_key or "").strip()
    if not key:
        raise FinanceError("IDEMPOTENCY_KEY_REQUIRED", "Нужен заголовок Idempotency-Key: повтор запроса не должен принять деньги дважды")
    order = (await db.execute(select(Order).where(Order.tenant_id == tenant_id, Order.id == order_id)
                              .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if order is None:
        raise FinanceError("ORDER_NOT_FOUND", "Заказ не найден", 404)
    await require_account(db, tenant_id, order.branch_id, cash_account_id)

    previous = await _existing(db, tenant_id, key)
    if previous is not None:  # repeat of the same request: same payment, no new money
        res = await ledger.post_entry(db, tenant_id=tenant_id, branch_id=order.branch_id, kind="payment",
                                      amount_minor=amount_minor, currency=order.currency, idempotency_key=key,
                                      order_id=order.id, cash_account_id=cash_account_id, customer_id=order.customer_id)
        return PaymentResult(res.entry, False, await ledger.order_position(db, tenant_id, order.id))

    position = await ledger.order_position(db, tenant_id, order.id)
    if isinstance(amount_minor, bool) or not isinstance(amount_minor, int) or amount_minor <= 0:
        raise FinanceError("AMOUNT_INVALID", "Сумма оплаты — положительное целое число в тиынах")
    if position.debt_minor <= 0:
        raise FinanceError("NOTHING_TO_PAY", "По визиту нет долга: услуга ещё не оказана или уже оплачена", 409)
    if amount_minor > position.debt_minor:
        raise FinanceError("OVERPAYMENT", "Сумма больше долга по визиту. Аванс принимается отдельно.", 409)
    res = await ledger.post_entry(db, tenant_id=tenant_id, branch_id=order.branch_id, kind="payment",
                                  amount_minor=amount_minor, currency=order.currency, idempotency_key=key,
                                  order_id=order.id, cash_account_id=cash_account_id, customer_id=order.customer_id,
                                  created_by_user_id=actor_id, reason=(note or None))
    return PaymentResult(res.entry, res.created, await ledger.order_position(db, tenant_id, order.id))


async def account_balance(db: AsyncSession, tenant_id: uuid.UUID, account_id: uuid.UUID) -> int:
    """Сколько денег должно быть в кассе по журналу: приходы − расходы (сторно уже со знаком)."""
    rows = (await db.execute(select(LedgerEntry.kind, func.sum(LedgerEntry.amount_minor)).where(
        LedgerEntry.tenant_id == tenant_id, LedgerEntry.cash_account_id == account_id).group_by(LedgerEntry.kind))).all()
    return sum(KIND_SIGN.get(kind, 0) * int(total) for kind, total in rows)
