"""Жизненный цикл визита (M09-D2): одна машина состояний для CRM, публичной ссылки и движка.

    confirmed   -> arrived | in_progress | completed | no_show | cancelled
    arrived     -> in_progress | completed | cancelled
    in_progress -> completed | cancelled
    completed, no_show, cancelled — конечные

Правила:
- переход выполняется под блокировкой строки брони (SELECT … FOR UPDATE): одновременные
  «завершить» и «отменить» не могут пройти оба, второй увидит новый статус и получит 409;
- no_show нельзя отметить до начала визита;
- отмена освобождает занятость мастера в той же транзакции — «призрачной» занятости не остаётся;
- каждое изменение увеличивает version и пишет событие; история не удаляется и не меняется
  (триггеры БД, ревизия 005).
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import Booking, BookingEvent, OutboxEvent, StaffOccupancy

TRANSITIONS = {
    "confirmed": ("arrived", "in_progress", "completed", "no_show", "cancelled"),
    "arrived": ("in_progress", "completed", "cancelled"),
    "in_progress": ("completed", "cancelled"),
    "completed": (),
    "no_show": (),
    "cancelled": (),
}
STATUSES = tuple(TRANSITIONS)


class LifecycleError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 409, details: Optional[dict] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


async def lock_booking(db: AsyncSession, tenant_id: uuid.UUID, booking_id: uuid.UUID) -> Booking:
    # populate_existing: if the session already holds this booking (read earlier in the request),
    # SQLAlchemy would otherwise return the cached object with a stale status despite the row lock
    booking = (await db.execute(
        select(Booking).where(Booking.id == booking_id, Booking.tenant_id == tenant_id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if booking is None:
        raise LifecycleError("BOOKING_NOT_FOUND", "Запись не найдена", 404)
    return booking


async def release_occupancy(db: AsyncSession, booking: Booking, at: dt.datetime) -> int:
    occ = (await db.execute(select(StaffOccupancy).where(
        StaffOccupancy.tenant_id == booking.tenant_id, StaffOccupancy.booking_id == booking.id,
        StaffOccupancy.released_at.is_(None)))).scalars().all()
    for o in occ:
        o.released_at = at
    return len(occ)


def record_event(db: AsyncSession, booking: Booking, event_type: str, actor_type: str,
                 actor_id: Optional[uuid.UUID], old: dict, new: dict) -> BookingEvent:
    ev = BookingEvent(tenant_id=booking.tenant_id, booking_id=booking.id, event_type=event_type,
                      actor_type=actor_type, actor_id=actor_id, old_json_sanitized=old,
                      new_json_sanitized={**new, "version": booking.version}, created_at=utcnow())
    db.add(ev)
    return ev


async def change_status(
    db: AsyncSession, booking: Booking, target: str, *, actor_type: str, actor_id: Optional[uuid.UUID] = None,
    reason: Optional[str] = None, now: Optional[dt.datetime] = None,
) -> Booking:
    """Переход статуса для уже заблокированной брони (lock_booking). Не коммитит."""
    now = now or utcnow()
    target = (target or "").strip().lower()
    if target not in STATUSES:
        raise LifecycleError("UNKNOWN_STATUS", f"Неизвестный статус «{target}»", 422)
    current = booking.status
    allowed = TRANSITIONS.get(current, ())
    if target not in allowed:
        raise LifecycleError(
            "INVALID_TRANSITION", f"Нельзя перевести запись из «{current}» в «{target}»", 409,
            details={"from": current, "to": target, "allowed": list(allowed)})
    if target == "no_show" and now < booking.starts_at_utc:
        raise LifecycleError("NO_SHOW_BEFORE_START", "Неявку можно отметить только после начала визита", 409)

    booking.status = target
    booking.version += 1
    new = {"status": target}
    if target == "cancelled":
        booking.cancelled_at = now
        booking.cancellation_reason = (reason or "").strip() or "Отменено"
        new["reason"] = booking.cancellation_reason
        new["released_occupancies"] = await release_occupancy(db, booking, now)
    elif reason:
        new["reason"] = reason.strip()
    record_event(db, booking, "cancelled" if target == "cancelled" else "status_changed",
                 actor_type, actor_id, {"status": current}, new)
    db.add(OutboxEvent(
        tenant_id=booking.tenant_id, aggregate_id=str(booking.id),
        event_type="booking.cancelled" if target == "cancelled" else "booking.status_changed",
        payload_sanitized={"booking_id": str(booking.id), "status": target, "from": current, "version": booking.version}))
    return booking
