import uuid
import datetime
from typing import Optional, Dict, Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from apps.api.app.infrastructure.db.models import Booking, BookingEvent


class FinanceCoreService:
    """
    Authoritative Financial Engine bridge for visits, orders, and payment accounting.
    Guarantees strict separation of service delivery (VisitCompleted) from cash payments (PaymentRecord).
    Ensures that changing visit status never fakes payment completion.
    """

    @classmethod
    async def get_visit_financial_summary(
        cls,
        booking: Booking,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """
        Calculates authoritative financial summary for a visit:
        - cost_minor: Agreed snapshot price of ordered services (Стоимость)
        - rendered_minor: Amount of delivered services (Оказано, only when booking.status == 'completed')
        - paid_minor: Confirmed cash or manual transactions (Получено / Оплачено)
        - debt_minor: rendered_minor - paid_minor (Долг: остаток к оплате после оказания услуги)
        - payment_status: 'unpaid' | 'partially_paid' | 'paid'
        - order_id: Optional link to immutable financial order (when D2 creates it)
        """
        cost_minor = booking.amount_minor_snapshot
        
        # Fact of service delivery: strictly upon completion of visit
        is_completed = (booking.status == "completed")
        rendered_minor = cost_minor if is_completed else 0

        # Payments: in M11 zero payments exist; when D2 implements orders/payments, reads actual ledger
        paid_minor = 0

        # Debt: if service rendered, customer owes rendered_minor - paid_minor
        debt_minor = max(0, rendered_minor - paid_minor) if is_completed else 0

        # Payment status: never fake 'paid' on completed!
        if paid_minor == 0:
            payment_status = "unpaid"
        elif paid_minor < rendered_minor:
            payment_status = "partially_paid"
        else:
            payment_status = "paid"

        return {
            "currency": booking.currency or "KZT",
            "cost_minor": cost_minor,
            "rendered_minor": rendered_minor,
            "paid_minor": paid_minor,
            "debt_minor": debt_minor,
            "payment_status": payment_status,
            "order_id": None
        }

    @classmethod
    async def on_visit_completed(
        cls,
        booking: Booking,
        db: AsyncSession,
        actor_id: Optional[uuid.UUID] = None
    ) -> Dict[str, Any]:
        """
        Event handler for VisitCompleted -> accrual / fact of delivery.
        Idempotent: safe against retries. Does not duplicate events.
        """
        stmt_ev = select(BookingEvent).where(
            BookingEvent.booking_id == booking.id,
            BookingEvent.event_type == "visit_completed"
        )
        res_ev = await db.execute(stmt_ev)
        existing_ev = res_ev.scalar_one_or_none()

        if not existing_ev:
            fin = await cls.get_visit_financial_summary(booking, db)
            ev = BookingEvent(
                tenant_id=booking.tenant_id,
                booking_id=booking.id,
                event_type="visit_completed",
                actor_type="staff",
                actor_id=actor_id,
                old_json_sanitized={"status": booking.status},
                new_json_sanitized={
                    "status": "completed",
                    "rendered_minor": fin["rendered_minor"],
                    "cost_minor": fin["cost_minor"],
                    "debt_minor": fin["debt_minor"],
                    "paid_minor": fin["paid_minor"]
                }
            )
            db.add(ev)
            await db.flush()

        return await cls.get_visit_financial_summary(booking, db)
