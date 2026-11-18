"""Заказ и его позиции (M05-D2: каркас; M11 создаёт заказ из брони).

Позиция — неизменяемый снимок цены: total = unit_price × quantity − discount считается здесь
один раз и проверяется CHECK-ограничением в БД. Валюта позиции = валюта заказа = валюта компании.
"""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import Order, OrderItem
from apps.api.app.modules.catalog import ownership
from apps.api.app.modules.finance import money
from apps.api.app.modules.finance.ledger import FinanceError

PRICE_SOURCES = ("base", "staff_override", "manual", "booking")


async def new_order(
    db: AsyncSession, *, tenant_id: uuid.UUID, branch_id: uuid.UUID, source: str,
    customer_id: Optional[uuid.UUID] = None, booking_id: Optional[uuid.UUID] = None,
    created_by_user_id: Optional[uuid.UUID] = None,
) -> Order:
    """Открытый заказ в валюте компании. Не коммитит."""
    if source not in ("booking", "walk_in", "manual"):
        raise FinanceError("ORDER_SOURCE_INVALID", f"Неизвестный источник заказа: {source}")
    if source == "booking" and booking_id is None:
        raise FinanceError("BOOKING_REQUIRED", "Заказ из записи должен ссылаться на запись")
    order = Order(
        tenant_id=tenant_id, branch_id=branch_id, customer_id=customer_id, booking_id=booking_id,
        currency=await ownership.tenant_currency(db, tenant_id), status="open", source=source,
        created_by_user_id=created_by_user_id,
    )
    db.add(order)
    await db.flush()
    return order


async def add_item(
    db: AsyncSession, order: Order, *, name: str, unit_price_minor: int, price_source: str,
    quantity: int = 1, discount_minor: int = 0, service_id: Optional[uuid.UUID] = None,
    staff_id: Optional[uuid.UUID] = None, booking_item_id: Optional[uuid.UUID] = None,
    duration_minutes: Optional[int] = None,
) -> OrderItem:
    """Добавляет позицию со снимком цены. Не коммитит."""
    if order.status != "open":
        raise FinanceError("ORDER_CLOSED", "В закрытый заказ нельзя добавлять позиции", 409)
    if price_source not in PRICE_SOURCES:
        raise FinanceError("PRICE_SOURCE_INVALID", f"Неизвестный источник цены: {price_source}")
    try:
        money.validate_price_minor(unit_price_minor, "unit_price_minor")
    except money.MoneyError as e:
        raise FinanceError(e.code, e.message)
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 1:
        raise FinanceError("QUANTITY_INVALID", "Количество — целое число от 1")
    gross = unit_price_minor * quantity
    if isinstance(discount_minor, bool) or not isinstance(discount_minor, int) or not 0 <= discount_minor <= gross:
        raise FinanceError("DISCOUNT_INVALID", "Скидка от 0 до стоимости позиции")
    if not (name or "").strip():
        raise FinanceError("NAME_REQUIRED", "У позиции должно быть название")

    next_seq = (await db.execute(select(func.coalesce(func.max(OrderItem.sequence), 0)).where(
        OrderItem.tenant_id == order.tenant_id, OrderItem.order_id == order.id))).scalar_one() + 1
    item = OrderItem(
        tenant_id=order.tenant_id, order_id=order.id, sequence=next_seq, kind="service",
        service_id=service_id, staff_id=staff_id, booking_item_id=booking_item_id,
        name_snapshot=name.strip(), duration_minutes_snapshot=duration_minutes,
        unit_price_minor=unit_price_minor, quantity=quantity, discount_minor=discount_minor,
        total_minor=gross - discount_minor, currency=order.currency, price_source=price_source,
    )
    db.add(item)
    await db.flush()
    return item
