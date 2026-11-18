"""Заказ из визита и факт оказания (M11-D2).

- Заказ визита создаётся из снимка брони (booking_items), а не из текущего прайса, один на визит
  (uq_order_per_booking + INSERT … ON CONFLICT DO NOTHING): повтор не создаёт второй заказ.
- Завершение визита (статус completed) в той же транзакции проводит в журнал «оказано» на сумму
  позиций с ключом visit-completed:{booking_id}: повтор события (retry, двойной клик, backfill)
  не создаёт второго начисления. Оплата здесь не появляется: «оказано ≠ получено».
- Неявка и отмена ничего не начисляют.
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import Booking, BookingItem, Order, OrderItem
from apps.api.app.modules.finance import ledger, money


def accrual_key(booking_id: uuid.UUID) -> str:
    return f"visit-completed:{booking_id}"


async def booking_order(db: AsyncSession, booking: Booking) -> Optional[Order]:
    return (await db.execute(select(Order).where(
        Order.tenant_id == booking.tenant_id, Order.booking_id == booking.id))).scalar_one_or_none()


async def ensure_booking_order(db: AsyncSession, booking: Booking, created_by: Optional[uuid.UUID] = None) -> Order:
    """Заказ визита со снимком цен. Идемпотентно. Не коммитит."""
    new_id = (await db.execute(pg_insert(Order).values(
        id=uuid.uuid4(), tenant_id=booking.tenant_id, branch_id=booking.branch_id, customer_id=booking.customer_id,
        booking_id=booking.id, currency=money.normalize_currency(booking.currency), status="open", source="booking",
        created_by_user_id=created_by,
    ).on_conflict_do_nothing().returning(Order.id))).scalar_one_or_none()
    order = await booking_order(db, booking)
    if new_id is None:
        return order
    items = (await db.execute(select(BookingItem)
                              .where(BookingItem.tenant_id == booking.tenant_id, BookingItem.booking_id == booking.id)
                              .order_by(BookingItem.sequence))).scalars().all()
    for seq, it in enumerate(items, start=1):
        db.add(OrderItem(
            tenant_id=booking.tenant_id, order_id=order.id, sequence=seq, kind="service",
            service_id=it.service_id, staff_id=booking.staff_id, booking_item_id=it.id,
            name_snapshot=it.service_name_snapshot, duration_minutes_snapshot=it.duration_minutes_snapshot,
            unit_price_minor=it.price_minor_snapshot, quantity=1, discount_minor=0,
            total_minor=it.price_minor_snapshot, currency=it.currency_snapshot,
            price_source="booking",  # the price the client booked at (booking_items snapshot)
        ))
    await db.flush()
    return order


async def accrue_completed_visit(db: AsyncSession, booking: Booking, actor_id: Optional[uuid.UUID] = None,
                                 now: Optional[dt.datetime] = None) -> Order:
    """Факт оказания по завершённому визиту. Идемпотентно. Не коммитит."""
    order = await ensure_booking_order(db, booking, created_by=actor_id)
    if order.status == "open":
        order.status = "completed"
        order.completed_at = now or dt.datetime.now(dt.timezone.utc)
    items = (await db.execute(select(OrderItem.total_minor).where(
        OrderItem.tenant_id == booking.tenant_id, OrderItem.order_id == order.id))).scalars().all()
    total = sum(items)
    if total > 0:
        await ledger.post_entry(
            db, tenant_id=booking.tenant_id, branch_id=booking.branch_id, kind="service_rendered",
            amount_minor=total, currency=order.currency, idempotency_key=accrual_key(booking.id),
            order_id=order.id, created_by_user_id=actor_id, occurred_at=now)
    return order


async def backfill_completed_visits(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    """Миграционная карта M11: заказы и начисления для визитов, завершённых до появления журнала.
    Повторный запуск ничего не дублирует. Не коммитит."""
    done = 0
    bookings = (await db.execute(select(Booking).where(
        Booking.tenant_id == tenant_id, Booking.status == "completed"))).scalars().all()
    for b in bookings:
        await accrue_completed_visit(db, b, now=b.service_ends_at_utc)
        done += 1
    return done
