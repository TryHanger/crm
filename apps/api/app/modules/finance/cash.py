"""Касса: оплата, частичная оплата (M12), возврат, аванс, зачёт аванса, сторно (M13).

- Деньги всегда проходят через кассу филиала: наличные, терминал, перевод, Kaspi.
  Наличные — только в открытую кассовую смену (shifts.py).
- Оплата заказа — payment, распределённая на заказ и кассу. «Получено» и «оказано» — разные суммы.
- Повтор с тем же ключом возвращает ту же операцию до любых проверок; другое содержимое с тем же
  ключом — 409. Операции одного заказа сериализуются блокировкой строки заказа, авансы клиента —
  транзакционной блокировкой клиента: параллельные запросы не превысят долг или остаток аванса.
- Возврат денег за услугу = refund (деньги клиенту) + adjustment (уменьшение «оказано») с причиной
  и автором. Исходная оплата не удаляется и не меняется.
- Аванс — деньги до услуги: обязательство перед клиентом, не выручка. Зачёт аванса переносит его в
  оплату заказа без движения денег.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import CashAccount, Customer, LedgerEntry, Order
from apps.api.app.modules.finance import ledger, money
from apps.api.app.modules.finance.ledger import FinanceError

DEFAULT_ACCOUNTS = (("Наличные", "cash"), ("Перевод / терминал", "bank_transfer"))
KIND_SIGN = {"payment": 1, "advance": 1, "refund": -1, "expense": -1}  # движение денег по кассе


async def ensure_default_accounts(db: AsyncSession, tenant_id: uuid.UUID, branch_id: uuid.UUID) -> List[CashAccount]:
    stmt = select(CashAccount).where(CashAccount.tenant_id == tenant_id, CashAccount.branch_id == branch_id) \
        .order_by(CashAccount.created_at, CashAccount.name)
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


def _key(idempotency_key: str) -> str:
    key = (idempotency_key or "").strip()
    if not key:
        raise FinanceError("IDEMPOTENCY_KEY_REQUIRED", "Нужен заголовок Idempotency-Key: повтор запроса не должен провести деньги дважды")
    return key


def _amount(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise FinanceError("AMOUNT_INVALID", "Сумма — положительное целое число в тиынах")
    return value


async def _replay(db: AsyncSession, tenant_id: uuid.UUID, key: str, kind: str, amount: int,
                  order_id=None, account_id=None, customer_id=None) -> Optional[LedgerEntry]:
    prev = (await db.execute(select(LedgerEntry).where(
        LedgerEntry.tenant_id == tenant_id, LedgerEntry.idempotency_key == key))).scalar_one_or_none()
    if prev is None:
        return None
    expected_customer = customer_id if customer_id is not None else prev.customer_id
    if (prev.kind, prev.amount_minor, prev.order_id, prev.cash_account_id, prev.customer_id) != \
            (kind, amount, order_id, account_id, expected_customer):
        raise FinanceError("IDEMPOTENCY_KEY_REUSED", "Ключ операции уже использован для другой операции", 409)
    return prev


async def _lock_order(db: AsyncSession, tenant_id: uuid.UUID, order_id: uuid.UUID) -> Order:
    order = (await db.execute(select(Order).where(Order.tenant_id == tenant_id, Order.id == order_id)
                              .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if order is None:
        raise FinanceError("ORDER_NOT_FOUND", "Заказ не найден", 404)
    return order


async def _shift(db: AsyncSession, account: CashAccount) -> Optional[uuid.UUID]:
    from apps.api.app.modules.finance import shifts   # local import: shifts uses KIND_SIGN from here
    return await shifts.shift_for_movement(db, account)


@dataclass
class MoneyResult:
    entry: LedgerEntry
    created: bool
    position: Optional[ledger.OrderPosition] = None


# ---------------------------------------------------------------- payments (M12)

async def record_payment(db: AsyncSession, *, tenant_id: uuid.UUID, order_id: uuid.UUID, amount_minor: int,
                         cash_account_id: uuid.UUID, idempotency_key: str, actor_id: Optional[uuid.UUID] = None,
                         note: Optional[str] = None) -> MoneyResult:
    key = _key(idempotency_key)
    order = await _lock_order(db, tenant_id, order_id)
    account = await require_account(db, tenant_id, order.branch_id, cash_account_id)
    prev = await _replay(db, tenant_id, key, "payment", amount_minor, order.id, account.id)
    if prev is not None:
        return MoneyResult(prev, False, await ledger.order_position(db, tenant_id, order.id))
    _amount(amount_minor)
    position = await ledger.order_position(db, tenant_id, order.id)
    if position.debt_minor <= 0:
        raise FinanceError("NOTHING_TO_PAY", "По визиту нет долга: услуга ещё не оказана или уже оплачена", 409)
    if amount_minor > position.debt_minor:
        raise FinanceError("OVERPAYMENT", "Сумма больше долга по визиту. Аванс принимается отдельно.", 409)
    res = await ledger.post_entry(db, tenant_id=tenant_id, branch_id=order.branch_id, kind="payment",
                                  amount_minor=amount_minor, currency=order.currency, idempotency_key=key,
                                  order_id=order.id, cash_account_id=account.id, customer_id=order.customer_id,
                                  cash_shift_id=await _shift(db, account), created_by_user_id=actor_id, reason=note or None)
    return MoneyResult(res.entry, res.created, await ledger.order_position(db, tenant_id, order.id))


# ---------------------------------------------------------------- refunds (M13)

async def refund(db: AsyncSession, *, tenant_id: uuid.UUID, order_id: uuid.UUID, amount_minor: int,
                 cash_account_id: uuid.UUID, reason: str, idempotency_key: str,
                 actor_id: Optional[uuid.UUID] = None) -> MoneyResult:
    """Деньги клиенту за услугу: refund + уменьшение «оказано» на ту же сумму. Долг не меняется."""
    key = _key(idempotency_key)
    if not (reason or "").strip():
        raise FinanceError("REASON_REQUIRED", "Укажите причину возврата")
    order = await _lock_order(db, tenant_id, order_id)
    account = await require_account(db, tenant_id, order.branch_id, cash_account_id)
    prev = await _replay(db, tenant_id, key, "refund", amount_minor, order.id, account.id)
    if prev is not None:
        return MoneyResult(prev, False, await ledger.order_position(db, tenant_id, order.id))
    _amount(amount_minor)
    position = await ledger.order_position(db, tenant_id, order.id)
    if amount_minor > position.received_minor:
        raise FinanceError("REFUND_EXCEEDS_RECEIVED", "Нельзя вернуть больше, чем клиент заплатил по визиту", 409)
    shift_id = await _shift(db, account)
    res = await ledger.post_entry(db, tenant_id=tenant_id, branch_id=order.branch_id, kind="refund",
                                  amount_minor=amount_minor, currency=order.currency, idempotency_key=key,
                                  order_id=order.id, cash_account_id=account.id, customer_id=order.customer_id,
                                  cash_shift_id=shift_id, created_by_user_id=actor_id, reason=reason.strip())
    await ledger.post_entry(db, tenant_id=tenant_id, branch_id=order.branch_id, kind="adjustment",
                            amount_minor=-amount_minor, currency=order.currency, idempotency_key=f"{key}:service-adjustment",
                            order_id=order.id, customer_id=order.customer_id, created_by_user_id=actor_id,
                            reason=f"Возврат клиенту: {reason.strip()}")
    return MoneyResult(res.entry, res.created, await ledger.order_position(db, tenant_id, order.id))


# ---------------------------------------------------------------- advances (M13)

async def _lock_customer(db: AsyncSession, tenant_id: uuid.UUID, customer_id: uuid.UUID) -> Customer:
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"advance:{tenant_id}:{customer_id}"})
    customer = (await db.execute(select(Customer).where(
        Customer.tenant_id == tenant_id, Customer.id == customer_id))).scalar_one_or_none()
    if customer is None:
        raise FinanceError("CUSTOMER_NOT_FOUND", "Клиент не найден", 404)
    return customer


async def advance_balance(db: AsyncSession, tenant_id: uuid.UUID, customer_id: uuid.UUID) -> int:
    rows = (await db.execute(select(LedgerEntry.kind, func.sum(LedgerEntry.amount_minor)).where(
        LedgerEntry.tenant_id == tenant_id, LedgerEntry.customer_id == customer_id,
        LedgerEntry.kind.in_(("advance", "advance_applied"))).group_by(LedgerEntry.kind))).all()
    by_kind = {k: int(v) for k, v in rows}
    return by_kind.get("advance", 0) - by_kind.get("advance_applied", 0)


async def receive_advance(db: AsyncSession, *, tenant_id: uuid.UUID, customer_id: uuid.UUID, branch_id: uuid.UUID,
                          amount_minor: int, cash_account_id: uuid.UUID, idempotency_key: str,
                          actor_id: Optional[uuid.UUID] = None, note: Optional[str] = None) -> MoneyResult:
    key = _key(idempotency_key)
    await _lock_customer(db, tenant_id, customer_id)
    account = await require_account(db, tenant_id, branch_id, cash_account_id)
    prev = await _replay(db, tenant_id, key, "advance", amount_minor, None, account.id, customer_id)
    if prev is not None:
        return MoneyResult(prev, False)
    _amount(amount_minor)
    res = await ledger.post_entry(db, tenant_id=tenant_id, branch_id=branch_id, kind="advance", amount_minor=amount_minor,
                                  currency=money.DEFAULT_CURRENCY, idempotency_key=key, cash_account_id=account.id,
                                  customer_id=customer_id, cash_shift_id=await _shift(db, account),
                                  created_by_user_id=actor_id, reason=note or None)
    return MoneyResult(res.entry, res.created)


async def apply_advance(db: AsyncSession, *, tenant_id: uuid.UUID, order_id: uuid.UUID, amount_minor: int,
                        idempotency_key: str, actor_id: Optional[uuid.UUID] = None) -> MoneyResult:
    """Зачёт аванса клиента в долг визита. Деньги не двигаются, касса не нужна."""
    key = _key(idempotency_key)
    order = await _lock_order(db, tenant_id, order_id)
    if order.customer_id is None:
        raise FinanceError("CUSTOMER_REQUIRED", "У заказа нет клиента: зачесть аванс нельзя")
    await _lock_customer(db, tenant_id, order.customer_id)
    prev = await _replay(db, tenant_id, key, "advance_applied", amount_minor, order.id, None, order.customer_id)
    if prev is not None:
        return MoneyResult(prev, False, await ledger.order_position(db, tenant_id, order.id))
    _amount(amount_minor)
    position = await ledger.order_position(db, tenant_id, order.id)
    balance = await advance_balance(db, tenant_id, order.customer_id)
    if amount_minor > balance:
        raise FinanceError("ADVANCE_INSUFFICIENT", f"Остаток аванса клиента {balance / 100:.2f}", 409)
    if amount_minor > position.debt_minor:
        raise FinanceError("OVERPAYMENT", "Сумма больше долга по визиту", 409)
    res = await ledger.post_entry(db, tenant_id=tenant_id, branch_id=order.branch_id, kind="advance_applied",
                                  amount_minor=amount_minor, currency=order.currency, idempotency_key=key,
                                  order_id=order.id, customer_id=order.customer_id, created_by_user_id=actor_id)
    return MoneyResult(res.entry, res.created, await ledger.order_position(db, tenant_id, order.id))


# ---------------------------------------------------------------- reversal (M13)

REVERSIBLE = ("payment", "advance", "advance_applied", "expense")


async def reverse(db: AsyncSession, *, tenant_id: uuid.UUID, entry_id: uuid.UUID, reason: str, idempotency_key: str,
                  actor_id: Optional[uuid.UUID] = None) -> MoneyResult:
    """Сторно ошибочной операции кассира: обратная запись в текущую смену, исходная остаётся."""
    key = _key(idempotency_key)
    original = (await db.execute(select(LedgerEntry).where(
        LedgerEntry.tenant_id == tenant_id, LedgerEntry.id == entry_id))).scalar_one_or_none()
    if original is None:
        raise FinanceError("ENTRY_NOT_FOUND", "Операция не найдена", 404)
    if original.kind not in REVERSIBLE or original.reverses_entry_id is not None:
        raise FinanceError("NOT_REVERSIBLE", "Эту операцию нельзя сторнировать: для денег за услугу используйте возврат", 409)
    if original.order_id is not None:
        await _lock_order(db, tenant_id, original.order_id)
    if original.customer_id is not None:
        await _lock_customer(db, tenant_id, original.customer_id)
    if original.kind == "advance":
        balance = await advance_balance(db, tenant_id, original.customer_id)
        if balance < original.amount_minor:
            raise FinanceError("ADVANCE_ALREADY_USED", "Аванс уже зачтён: сначала сторнируйте зачёт", 409)
    shift_id = None
    if original.cash_account_id is not None:
        account = (await db.execute(select(CashAccount).where(CashAccount.id == original.cash_account_id))).scalar_one()
        shift_id = await _shift(db, account)
    res = await ledger.reverse_entry(db, tenant_id=tenant_id, entry_id=entry_id, idempotency_key=key,
                                     reason=reason, created_by_user_id=actor_id, cash_shift_id=shift_id)
    position = await ledger.order_position(db, tenant_id, original.order_id) if original.order_id else None
    return MoneyResult(res.entry, res.created, position)


async def account_balance(db: AsyncSession, tenant_id: uuid.UUID, account_id: uuid.UUID) -> int:
    """Сколько денег должно быть в кассе по журналу: приходы − расходы (сторно уже со знаком)."""
    rows = (await db.execute(select(LedgerEntry.kind, func.sum(LedgerEntry.amount_minor)).where(
        LedgerEntry.tenant_id == tenant_id, LedgerEntry.cash_account_id == account_id).group_by(LedgerEntry.kind))).all()
    return sum(KIND_SIGN.get(kind, 0) * int(total) for kind, total in rows)
