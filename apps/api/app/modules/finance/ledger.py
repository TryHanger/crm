"""Журнал денег салона (M05-D2). Единственный путь записи в ledger_entries.

Инварианты (docs/finance/MONEY_AND_ORDER_CONTRACT.md, раздел 4):
- запись проводится один раз на idempotency_key в пределах компании: повтор с тем же
  содержимым возвращает исходную запись, с другим содержимым — ошибка IDEMPOTENCY_KEY_REUSED;
  гарантия держится на уникальном индексе, а не на проверке «прочитал — записал»;
- записи не меняются и не удаляются (триггер в БД); исправление — сторно reverse_entry
  с причиной, у каждой записи не больше одного сторно;
- валюта и филиал записи совпадают с заказом.
"""
from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import LedgerEntry, Order, OrderItem
from apps.api.app.modules.finance import money

KINDS = ("service_rendered", "payment", "refund", "advance", "advance_applied", "adjustment")


class FinanceError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 422):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


@dataclass
class Posted:
    entry: LedgerEntry
    created: bool  # False: повтор с тем же ключом, вернули исходную запись


def _fingerprint(e) -> tuple:
    return (e.kind, int(e.amount_minor), e.currency, e.order_id, e.branch_id, e.reverses_entry_id,
            e.cash_account_id, e.customer_id)


async def _insert_once(db: AsyncSession, values: dict) -> Posted:
    """INSERT … ON CONFLICT DO NOTHING; при конфликте читаем существующую запись по ключу."""
    stmt = pg_insert(LedgerEntry).values(**values).on_conflict_do_nothing().returning(LedgerEntry.id)
    new_id = (await db.execute(stmt)).scalar_one_or_none()
    if new_id is not None:
        entry = (await db.execute(select(LedgerEntry).where(LedgerEntry.id == new_id))).scalar_one()
        return Posted(entry, True)

    existing = (await db.execute(select(LedgerEntry).where(
        LedgerEntry.tenant_id == values["tenant_id"],
        LedgerEntry.idempotency_key == values["idempotency_key"],
    ))).scalar_one_or_none()
    if existing is None:
        # конфликт не по ключу, а по «одно сторно на запись»
        raise FinanceError("ALREADY_REVERSED", "Эта операция уже сторнирована", 409)

    incoming = (values["kind"], int(values["amount_minor"]), values["currency"], values.get("order_id"),
                values["branch_id"], values.get("reverses_entry_id"), values.get("cash_account_id"),
                values.get("customer_id"))
    if _fingerprint(existing) != incoming:
        raise FinanceError("IDEMPOTENCY_KEY_REUSED",
                           "Ключ операции уже использован для другой операции", 409)
    return Posted(existing, False)


def _check_key(key: str) -> str:
    key = (key or "").strip()
    if not key or len(key) > 128:
        raise FinanceError("IDEMPOTENCY_KEY_REQUIRED", "Нужен ключ идемпотентности (1–128 символов)")
    return key


async def _order_for(db: AsyncSession, tenant_id: uuid.UUID, order_id: uuid.UUID) -> Order:
    order = (await db.execute(select(Order).where(Order.tenant_id == tenant_id, Order.id == order_id))).scalar_one_or_none()
    if order is None:
        raise FinanceError("ORDER_NOT_FOUND", "Заказ не найден", 404)
    return order


async def post_entry(
    db: AsyncSession, *, tenant_id: uuid.UUID, branch_id: uuid.UUID, kind: str, amount_minor: int,
    currency: str, idempotency_key: str, order_id: Optional[uuid.UUID] = None, reason: Optional[str] = None,
    created_by_user_id: Optional[uuid.UUID] = None, occurred_at: Optional[dt.datetime] = None,
    cash_account_id: Optional[uuid.UUID] = None, customer_id: Optional[uuid.UUID] = None,
    cash_shift_id: Optional[uuid.UUID] = None,
) -> Posted:
    """Проводит операцию один раз. Не коммитит."""
    if kind in ("payment", "refund") and cash_account_id is None:
        raise FinanceError("CASH_ACCOUNT_REQUIRED", "Укажите кассу, через которую прошли деньги")
    if kind not in KINDS:
        raise FinanceError("LEDGER_KIND_INVALID", f"Неизвестный тип операции: {kind}")
    if isinstance(amount_minor, bool) or not isinstance(amount_minor, int) or amount_minor == 0:
        raise FinanceError("AMOUNT_INVALID", "Сумма — ненулевое целое число в минимальных единицах")
    if kind != "adjustment":
        try:
            money.validate_price_minor(amount_minor, "amount_minor")
        except money.MoneyError as e:
            raise FinanceError(e.code, e.message)
    elif not (reason or "").strip():
        raise FinanceError("REASON_REQUIRED", "Для корректировки нужна причина")
    try:
        currency = money.normalize_currency(currency)
    except money.MoneyError as e:
        raise FinanceError(e.code, e.message)
    if order_id is not None:
        order = await _order_for(db, tenant_id, order_id)
        if order.currency != currency:
            raise FinanceError("CURRENCY_MISMATCH", f"Валюта операции {currency} не совпадает с валютой заказа {order.currency}")
        if order.branch_id != branch_id:
            raise FinanceError("BRANCH_MISMATCH", "Операция и заказ относятся к разным филиалам")

    values = dict(
        id=uuid.uuid4(), tenant_id=tenant_id, branch_id=branch_id, order_id=order_id, kind=kind,
        amount_minor=amount_minor, currency=currency, idempotency_key=_check_key(idempotency_key),
        reverses_entry_id=None, reason=(reason or None), created_by_user_id=created_by_user_id,
        cash_account_id=cash_account_id, customer_id=customer_id, cash_shift_id=cash_shift_id,
    )
    if occurred_at is not None:
        values["occurred_at"] = occurred_at
    return await _insert_once(db, values)


async def reverse_entry(
    db: AsyncSession, *, tenant_id: uuid.UUID, entry_id: uuid.UUID, idempotency_key: str, reason: str,
    created_by_user_id: Optional[uuid.UUID] = None, cash_shift_id: Optional[uuid.UUID] = None,
) -> Posted:
    """Сторно: запись того же вида с противоположной суммой и ссылкой на исходную. Не коммитит."""
    if not (reason or "").strip():
        raise FinanceError("REASON_REQUIRED", "Для сторно нужна причина")
    original = (await db.execute(select(LedgerEntry).where(
        LedgerEntry.tenant_id == tenant_id, LedgerEntry.id == entry_id))).scalar_one_or_none()
    if original is None:
        raise FinanceError("ENTRY_NOT_FOUND", "Операция не найдена", 404)
    if original.reverses_entry_id is not None:
        raise FinanceError("CANNOT_REVERSE_REVERSAL", "Сторно нельзя сторнировать: проведите новую операцию", 409)
    return await _insert_once(db, dict(
        id=uuid.uuid4(), tenant_id=tenant_id, branch_id=original.branch_id, order_id=original.order_id,
        kind=original.kind, amount_minor=-original.amount_minor, currency=original.currency,
        idempotency_key=_check_key(idempotency_key), reverses_entry_id=original.id,
        reason=reason.strip(), created_by_user_id=created_by_user_id,
        cash_account_id=original.cash_account_id, customer_id=original.customer_id,
        cash_shift_id=cash_shift_id,  # corrections go into the CURRENT open shift, never into a closed one
    ))


@dataclass
class OrderPosition:
    currency: str
    sold_minor: int        # сумма позиций заказа (снимок цен)
    rendered_minor: int    # оказано (начислено)
    received_minor: int    # получено деньгами: оплаты − возвраты
    advance_applied_minor: int
    debt_minor: int        # оказано − получено − зачтённый аванс (может быть < 0: переплата)


async def order_position(db: AsyncSession, tenant_id: uuid.UUID, order_id: uuid.UUID) -> OrderPosition:
    order = await _order_for(db, tenant_id, order_id)
    sold = (await db.execute(select(func.coalesce(func.sum(OrderItem.total_minor), 0)).where(
        OrderItem.tenant_id == tenant_id, OrderItem.order_id == order_id))).scalar_one()
    rows = (await db.execute(select(LedgerEntry.kind, func.sum(LedgerEntry.amount_minor)).where(
        LedgerEntry.tenant_id == tenant_id, LedgerEntry.order_id == order_id).group_by(LedgerEntry.kind))).all()
    by_kind = {k: int(v) for k, v in rows}
    rendered = by_kind.get("service_rendered", 0) + by_kind.get("adjustment", 0)
    received = by_kind.get("payment", 0) - by_kind.get("refund", 0)
    applied = by_kind.get("advance_applied", 0)
    return OrderPosition(order.currency, int(sold), rendered, received, applied, rendered - received - applied)
