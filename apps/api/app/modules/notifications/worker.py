"""Воркер outbox → email (M15).

Гарантии:
- Письмо рождается только из события outbox, а событие пишется в той же транзакции, что и бронь:
  нет брони — нет события — нет письма. Если бронь исчезла к моменту отправки, событие skipped.
- Захват пачки — `FOR UPDATE SKIP LOCKED` с арендой строки (locked_until): два воркера не возьмут
  одно событие, упавший воркер отпустит его по истечении аренды.
- Одно решение на событие и канал (уникальный индекс в notification_deliveries): повторный прогон,
  повтор после сбоя и второй воркер письмо не дублируют. Message-ID письма детерминирован
  (outbox-<id>), так что даже доставка «по крайней мере один раз» после падения между SMTP и
  коммитом распознаётся почтовыми системами как то же письмо.
- Временная ошибка — повтор с растущей паузой; постоянная или исчерпаны попытки — failed.
- В логах и last_error нет адресов целиком, ссылок, токенов и паролей (redact.py).
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import logging
import secrets
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.core.config import settings
from apps.api.app.infrastructure.db import session as db_session
from apps.api.app.infrastructure.db.models import (
    Booking, BookingItem, Branch, Customer, NotificationDelivery, NotificationTemplate, OutboxEvent,
    PublicManagementToken, StaffProfile, Tenant, TenantDomain, TenantSettings,
)
from apps.api.app.modules.notifications import templates
from apps.api.app.modules.notifications.redact import mask_email, redact
from apps.api.app.modules.notifications.transport import OutgoingEmail, Transport, TransportError, get_transport

log = logging.getLogger("crm.notifications")

TEMPLATE_FOR_EVENT = {
    "booking.created": "booking_confirmation",
    "booking.rescheduled": "booking_rescheduled",
    "booking.cancelled": "booking_cancelled",
    "booking.reminder": "booking_reminder",
}
NEEDS_MANAGE_LINK = {"booking_confirmation", "booking_rescheduled", "booking_reminder"}
BACKOFF_SECONDS = (60, 300, 1800, 7200, 21600)
LEASE = dt.timedelta(minutes=2)
REMINDER_WINDOW = (dt.timedelta(hours=23), dt.timedelta(hours=25))


@dataclass
class RunStats:
    claimed: int = 0
    sent: int = 0
    skipped: int = 0
    retried: int = 0
    failed: int = 0
    deferred: int = 0
    reasons: Dict[str, int] = field(default_factory=dict)


# ---------------------------------------------------------------- links

def _sign(tenant_id: uuid.UUID, customer_id: uuid.UUID) -> str:
    mac = hmac.new(settings.JWT_SECRET.encode(), f"unsubscribe:{tenant_id}:{customer_id}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac[:18]).decode().rstrip("=")


def unsubscribe_token(tenant_id: uuid.UUID, customer_id: uuid.UUID) -> str:
    return f"{tenant_id}.{customer_id}.{_sign(tenant_id, customer_id)}"


def parse_unsubscribe_token(token: str) -> Optional[Tuple[uuid.UUID, uuid.UUID]]:
    try:
        t, c, sig = token.split(".")
        tenant_id, customer_id = uuid.UUID(t), uuid.UUID(c)
    except (ValueError, AttributeError):
        return None
    return (tenant_id, customer_id) if hmac.compare_digest(sig, _sign(tenant_id, customer_id)) else None


async def public_base_url(db: AsyncSession, tenant: Tenant) -> str:
    host = (await db.execute(select(TenantDomain.hostname_normalized).where(
        TenantDomain.tenant_id == tenant.id, TenantDomain.canonical.is_(True),
        TenantDomain.verification_status == "verified").order_by(TenantDomain.created_at))).scalars().first()
    host = host or f"{tenant.slug}{settings.BOOKING_DOMAIN_SUFFIX}"
    if settings.PUBLIC_BOOKING_URL_TEMPLATE:
        return settings.PUBLIC_BOOKING_URL_TEMPLATE.format(slug=tenant.slug, host=host).rstrip("/")
    return f"https://{host}"


# ---------------------------------------------------------------- claim

async def claim(limit: int = 20) -> List[uuid.UUID]:
    async with db_session.AsyncSessionLocal() as db:
        rows = (await db.execute(text("""
            UPDATE outbox_events SET locked_until = now() + make_interval(secs => :lease)
            WHERE id IN (
                SELECT id FROM outbox_events
                WHERE status = 'pending' AND next_attempt_at <= now()
                  AND (locked_until IS NULL OR locked_until < now())
                ORDER BY next_attempt_at, created_at
                LIMIT :n FOR UPDATE SKIP LOCKED)
            RETURNING id"""), {"n": limit, "lease": LEASE.total_seconds()})).scalars().all()
        await db.commit()
        return list(rows)


# ---------------------------------------------------------------- one event

async def _finish(db: AsyncSession, ev: OutboxEvent, status: str, stats: RunStats, *, template: Optional[str] = None,
                  reason: Optional[str] = None, recipient: Optional[str] = None, message_id: Optional[str] = None) -> None:
    now = dt.datetime.now(dt.timezone.utc)
    if template and ev.tenant_id:
        await db.execute(pg_insert(NotificationDelivery).values(
            id=uuid.uuid4(), tenant_id=ev.tenant_id, outbox_event_id=ev.id, channel="email", template_code=template,
            recipient_masked=mask_email(recipient) if recipient else None, status=status, reason=reason,
            message_id=message_id, attempts=ev.retry_count + 1).on_conflict_do_nothing())
    ev.status = "sent" if status == "sent" else status
    ev.processed_at = now
    ev.locked_until = None
    if reason:
        ev.last_error = reason
    if status == "skipped":
        stats.skipped += 1
        stats.reasons[reason or "skipped"] = stats.reasons.get(reason or "skipped", 0) + 1
    elif status == "sent":
        stats.sent += 1
    else:
        stats.failed += 1


async def _context(db: AsyncSession, booking: Booking, customer: Customer) -> Dict[str, str]:
    branch = (await db.execute(select(Branch).where(Branch.id == booking.branch_id))).scalar_one()
    staff = (await db.execute(select(StaffProfile.display_name).where(StaffProfile.id == booking.staff_id))).scalar_one_or_none()
    items = (await db.execute(select(BookingItem.service_name_snapshot).where(BookingItem.booking_id == booking.id)
                              .order_by(BookingItem.sequence))).scalars().all()
    tenant = (await db.execute(select(Tenant).where(Tenant.id == booking.tenant_id))).scalar_one()
    biz = (await db.execute(select(TenantSettings.business_name).where(TenantSettings.tenant_id == booking.tenant_id))).scalar_one_or_none()
    local = booking.starts_at_utc.astimezone(ZoneInfo(branch.timezone_iana or "Asia/Almaty"))
    return {
        "business_name": biz or tenant.display_name, "customer_name": customer.full_name,
        "services": ", ".join(items), "staff_name": staff or "", "date": local.strftime("%d.%m.%Y"), "time": local.strftime("%H:%M"),
        "branch_name": branch.name, "branch_address": branch.address or "",
        "total": f"{booking.amount_minor_snapshot / 100:,.0f} ₸".replace(",", " "), "public_ref": booking.public_ref or "",
    }


async def _decide(db: AsyncSession, ev: OutboxEvent, code: str):
    """(booking, customer, settings, subject, body) or a skip reason."""
    booking = (await db.execute(select(Booking).where(Booking.id == uuid.UUID(ev.aggregate_id.split(":")[0]),
                                                      Booking.tenant_id == ev.tenant_id))).scalar_one_or_none()
    if booking is None:
        return "booking_missing"
    customer = (await db.execute(select(Customer).where(Customer.id == booking.customer_id))).scalar_one_or_none() \
        if booking.customer_id else None
    if code == "booking_reminder":
        planned = (ev.payload_sanitized or {}).get("starts_at_utc")
        if booking.status != "confirmed" or planned != booking.starts_at_utc.isoformat():
            return "reminder_stale"
    if customer is None or not (customer.email or "").strip():
        return "no_email"
    if customer.notifications_opt_out_at is not None:
        return "opted_out"
    ts = (await db.execute(select(TenantSettings).where(TenantSettings.tenant_id == ev.tenant_id))).scalar_one_or_none()
    if ts is not None and not ts.email_notifications_enabled:
        return "tenant_disabled"
    override = (await db.execute(select(NotificationTemplate).where(
        NotificationTemplate.tenant_id == ev.tenant_id, NotificationTemplate.code == code))).scalar_one_or_none()
    if override is not None and not override.enabled:
        return "template_disabled"
    subject, body = (override.subject, override.body) if override else templates.DEFAULTS[code]
    return booking, customer, ts, subject, body


async def process_event(event_id: uuid.UUID, transport: Transport, stats: RunStats) -> None:
    async with db_session.AsyncSessionLocal() as db:
        ev = (await db.execute(select(OutboxEvent).where(OutboxEvent.id == event_id).with_for_update()
                               .execution_options(populate_existing=True))).scalar_one_or_none()
        if ev is None or ev.status != "pending":
            return
        code = TEMPLATE_FOR_EVENT.get(ev.event_type)
        if code is None or ev.tenant_id is None:
            await _finish(db, ev, "skipped", stats, reason="no_notification")
            await db.commit()
            return
        await db_session.set_tenant_context(db, ev.tenant_id)
        done = (await db.execute(select(NotificationDelivery.status).where(
            NotificationDelivery.outbox_event_id == ev.id, NotificationDelivery.channel == "email"))).scalar_one_or_none()
        if done is not None:                      # decision already made by a previous run: never send twice
            ev.status, ev.locked_until = done, None
            await db.commit()
            return
        decision = await _decide(db, ev, code)
        if isinstance(decision, str):
            await _finish(db, ev, "skipped", stats, template=code, reason=decision)
            await db.commit()
            return
        booking, customer, ts, subject, body = decision
        limit = ts.daily_email_limit if ts is not None else 300
        since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)
        sent_24h = (await db.execute(select(func.count()).select_from(NotificationDelivery).where(
            NotificationDelivery.tenant_id == ev.tenant_id, NotificationDelivery.status == "sent",
            NotificationDelivery.created_at >= since))).scalar_one()
        if sent_24h >= limit:
            ev.next_attempt_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
            ev.locked_until, ev.last_error = None, "DAILY_LIMIT"
            stats.deferred += 1
            await db.commit()
            log.warning("outbox %s deferred: daily email limit %s reached for tenant %s", ev.id, limit, ev.tenant_id)
            return

        ctx = await _context(db, booking, customer)
        tenant = (await db.execute(select(Tenant).where(Tenant.id == ev.tenant_id))).scalar_one()
        base = await public_base_url(db, tenant)
        if code in NEEDS_MANAGE_LINK:
            raw = secrets.token_urlsafe(32)   # a fresh link for this letter; only its hash is stored
            db.add(PublicManagementToken(tenant_id=ev.tenant_id, booking_id=booking.id, scope="manage_booking",
                                         token_hash=hashlib.sha256(raw.encode()).hexdigest(),
                                         expires_at=booking.busy_ends_at_utc + dt.timedelta(days=7)))
            ctx["manage_url"] = f"{base}/manage/{raw}"
        unsub = f"{base}/api/v1/public/notifications/unsubscribe?token={unsubscribe_token(ev.tenant_id, customer.id)}"
        r = templates.render(subject, body, ctx, unsubscribe_url=unsub)
        domain = settings.SMTP_FROM.split("@")[-1] or "crm.local"
        msg = OutgoingEmail(to=customer.email.strip(), subject=r.subject, text=r.text, html=r.html,
                            message_id=f"<outbox-{ev.id}@{domain}>",
                            headers={"List-Unsubscribe": f"<{unsub}>", "X-Booking-Ref": ctx["public_ref"]})
        ev_id, to = ev.id, msg.to                    # rollback expires ORM objects: keep plain values
        try:
            await transport.send(msg)
        except TransportError as e:
            await db.rollback()                     # the unsent link is dropped together with the attempt
            await _record_failure(ev_id, code, to, e, stats)
            return
        await _finish(db, ev, "sent", stats, template=code, recipient=customer.email, message_id=msg.message_id)
        await db.commit()
        log.info("outbox %s %s sent to %s", ev.id, code, mask_email(customer.email))


async def _record_failure(event_id: uuid.UUID, code: str, email: str, err: TransportError, stats: RunStats) -> None:
    async with db_session.AsyncSessionLocal() as db:
        ev = (await db.execute(select(OutboxEvent).where(OutboxEvent.id == event_id).with_for_update())).scalar_one()
        await db_session.set_tenant_context(db, ev.tenant_id)
        ev.retry_count += 1
        ev.last_error = redact(str(err))
        ev.locked_until = None
        if err.permanent or ev.retry_count >= settings.OUTBOX_MAX_ATTEMPTS:
            await _finish(db, ev, "failed", stats, template=code, recipient=email,
                          reason="permanent_error" if err.permanent else "attempts_exhausted")
            ev.last_error = redact(str(err))
            log.error("outbox %s %s failed for %s: %s", ev.id, code, mask_email(email), ev.last_error)
        else:
            delay = BACKOFF_SECONDS[min(ev.retry_count - 1, len(BACKOFF_SECONDS) - 1)]
            ev.next_attempt_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=delay)
            stats.retried += 1
            log.warning("outbox %s %s retry %s in %ss for %s: %s", ev.id, code, ev.retry_count, delay,
                        mask_email(email), ev.last_error)
        await db.commit()


# ---------------------------------------------------------------- reminders

async def enqueue_reminders(now: Optional[dt.datetime] = None) -> int:
    """События «напоминание за сутки» для подтверждённых визитов через 23–25 часов. Без дублей (dedupe_key)."""
    now = now or dt.datetime.now(dt.timezone.utc)
    lo, hi = now + REMINDER_WINDOW[0], now + REMINDER_WINDOW[1]
    created = 0
    async with db_session.AsyncSessionLocal() as db:
        tenant_ids = (await db.execute(select(Tenant.id))).scalars().all()
        await db.commit()
    for tenant_id in tenant_ids:
        async with db_session.AsyncSessionLocal() as db:
            await db_session.set_tenant_context(db, tenant_id)
            rows = (await db.execute(select(Booking.id, Booking.starts_at_utc).where(
                Booking.tenant_id == tenant_id, Booking.status == "confirmed",
                Booking.starts_at_utc >= lo, Booking.starts_at_utc < hi))).all()
            for booking_id, starts in rows:
                res = await db.execute(pg_insert(OutboxEvent).values(
                    id=uuid.uuid4(), tenant_id=tenant_id, event_type="booking.reminder",
                    aggregate_id=f"{booking_id}:{starts.isoformat()}", dedupe_key=f"reminder:{booking_id}:{starts.isoformat()}",
                    payload_sanitized={"booking_id": str(booking_id), "starts_at_utc": starts.isoformat()},
                    created_at=now, status="pending", retry_count=0).on_conflict_do_nothing().returning(OutboxEvent.id))
                created += res.scalar_one_or_none() is not None
            await db.commit()
    return created


# ---------------------------------------------------------------- entry point

async def run_once(transport: Optional[Transport] = None, limit: int = 20) -> RunStats:
    stats = RunStats()
    if not settings.EMAIL_NOTIFICATIONS_ENABLED:
        return stats
    transport = transport or get_transport()
    if transport is None:
        log.info("email transport is not configured: outbox events stay queued")
        return stats
    ids = await claim(limit)
    stats.claimed = len(ids)
    for event_id in ids:
        try:
            await process_event(event_id, transport, stats)
        except Exception as e:  # one broken event must not stop the queue; its lease expires and it is retried
            log.error("outbox %s crashed: %s: %s", event_id, type(e).__name__, redact(str(e)))
    return stats
