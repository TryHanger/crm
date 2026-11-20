import uuid
import datetime
import zoneinfo
import logging

logger = logging.getLogger("saas_crm")
from typing import List, Optional, Any, Union, Dict
from fastapi import APIRouter, Depends, HTTPException, Header, status, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, ValidationError
from apps.api.app.modules.catalog import ownership
from apps.api.app.infrastructure.security import branch_scope
from apps.api.app.modules.bookings import lifecycle
from apps.api.app.modules.finance import accrual, cash as finance_cash, ledger as finance_ledger, shifts as finance_shifts
from apps.api.app.modules.finance import expenses as finance_expenses, reports as finance_reports
from apps.api.app.modules.notifications import templates as notification_templates
from apps.api.app.core.config import settings
from sqlalchemy.dialects.postgresql import insert as pg_insert
from apps.api.app.modules.finance.ledger import FinanceError
from apps.api.app.infrastructure.db.models import CashAccount, CashShift, ExpenseCategory, LedgerEntry, Order
from apps.api.app.infrastructure.db.models import (BranchRoleGrant, NotificationDelivery, NotificationTemplate,
                                                   OutboxEvent, TenantSettings)
from apps.api.app.infrastructure.db.session import set_tenant_context
from apps.api.app.modules.customers import identity as customer_identity
from sqlalchemy.exc import IntegrityError, DBAPIError
from sqlalchemy import select, and_, or_, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.session import get_db, set_tenant_context
from apps.api.app.infrastructure.security.auth import get_crm_tenant_user, require_crm_roles, AuthenticatedTenantUser
from apps.api.app.infrastructure.db.models import (
    Tenant, TenantDomain, Branch, Service, ServiceCategory, StaffProfile, StaffBranch,
    StaffServiceOffer, WeeklyShift, ShiftBreak, StaffTimeOff, Customer,
    CustomerNote, Booking, BookingItem, StaffOccupancy, CalendarBlock,
    BookingEvent, BookingPolicy, BookingTheme, BookingPublication,
    TenantMembership, Invite, Subscription, PlanVersion, PlanEntitlement,
    TenantEntitlementOverride
)
from apps.api.app.modules.bookings.service import BookingEngine, BookingEngineError, is_slot_conflict
from apps.api.app.modules.finance.service import FinanceCoreService
from apps.api.app.modules.schemas import (
    BranchResponse, CRMCreateBookingRequest, StatusUpdateRequest,
    CalendarBlockCreateRequest, CustomerCreateRequest, CustomerNoteCreateRequest,
    CustomerUpdateRequest, StaffCreateRequest, StaffUpdateRequest,
    StaffServiceOfferUpdateRequest, StaffScheduleUpdateRequest, WeeklyShiftDto, ServiceCreateRequest,
    StaffTimeOffCreateRequest, StaffTimeOffResponse,
    ServiceUpdateRequest, ServiceCategoryCreateRequest, ServiceCategoryUpdateRequest,
    BranchUpdateRequest, BookingPolicyUpdateRequest, BookingBrandingUpdateRequest,
    InviteCreateRequest, RescheduleRequest, CancelRequest, BookingPublicationUpdateRequest,
    VisitFinancialSummary
)

router = APIRouter(prefix="/business", tags=["Business CRM"])

# Helper: check tenant subscription status (if suspended, CRM is read-only)
async def check_crm_write_permitted(tenant_id: uuid.UUID, db: AsyncSession):
    stmt = select(Tenant).where(Tenant.id == tenant_id)
    res = await db.execute(stmt)
    tenant = res.scalar_one()
    if tenant.lifecycle_status == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Subscription is suspended. CRM workspace is in read-only mode."
        )

async def check_tenant_entitlement_limit(tenant_id: uuid.UUID, feature_key: str, current_count: int, db: AsyncSession):
    # 1. Check feature override
    stmt_ov = select(TenantEntitlementOverride).where(
        TenantEntitlementOverride.tenant_id == tenant_id,
        TenantEntitlementOverride.feature_key == feature_key
    )
    res_ov = await db.execute(stmt_ov)
    override = res_ov.scalar_one_or_none()
    if override and override.limit_value is not None:
        if current_count >= override.limit_value:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Subscription limit of {override.limit_value} for '{feature_key}' reached"
            )
        return

    # 2. Check plan version entitlements
    stmt_sub = select(Subscription, PlanVersion).join(
        PlanVersion, PlanVersion.id == Subscription.plan_version_id
    ).where(Subscription.tenant_id == tenant_id)
    res_sub = await db.execute(stmt_sub)
    row = res_sub.first()
    if row:
        _, pv = row
        stmt_pe = select(PlanEntitlement).where(
            PlanEntitlement.plan_version_id == pv.id,
            PlanEntitlement.feature_key == feature_key
        )
        res_pe = await db.execute(stmt_pe)
        pe = res_pe.scalar_one_or_none()
        if pe and pe.limit_value is not None:
            if current_count >= pe.limit_value:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Subscription plan limit of {pe.limit_value} for '{feature_key}' reached. Upgrade plan."
                )

@router.get("/me")
async def get_crm_me(crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user)):
    """Returns current CRM user profile and role in the active tenant."""
    return {
        "user_id": str(crm_user.user.id),
        "email": crm_user.user.email_normalized,
        "display_name": crm_user.user.display_name,
        "tenant_id": str(crm_user.tenant_id),
        "role": crm_user.role
    }


@router.get("/dashboard")
async def get_crm_dashboard(
    branch_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns overview statistics for today's dashboard."""
    tenant_id = crm_user.tenant_id
    today = datetime.datetime.now(datetime.timezone.utc).date()
    start_today = datetime.datetime.combine(today, datetime.time.min, tzinfo=datetime.timezone.utc)
    end_today = datetime.datetime.combine(today, datetime.time.max, tzinfo=datetime.timezone.utc)

    stmt_b = select(Booking).where(
        Booking.tenant_id == tenant_id,
        Booking.starts_at_utc >= start_today,
        Booking.starts_at_utc <= end_today
    )
    if branch_id:
        stmt_b = stmt_b.where(Booking.branch_id == branch_id)

    res_b = await db.execute(stmt_b)
    bookings = res_b.scalars().all()

    total_today = len(bookings)
    completed_count = sum(1 for b in bookings if b.status == "completed")
    in_progress_count = sum(1 for b in bookings if b.status == "in_progress")
    arrived_count = sum(1 for b in bookings if b.status == "arrived")
    confirmed_count = sum(1 for b in bookings if b.status == "confirmed")
    cancelled_count = sum(1 for b in bookings if b.status == "cancelled")
    no_show_count = sum(1 for b in bookings if b.status == "no_show")

    # Planned service value (non-cancelled appointments)
    planned_revenue_minor = sum(b.amount_minor_snapshot for b in bookings if b.status != "cancelled")

    # Subscription status
    stmt_sub = select(Subscription).where(Subscription.tenant_id == tenant_id).order_by(Subscription.created_at.desc())
    res_sub = await db.execute(stmt_sub)
    sub = res_sub.scalars().first()

    return {
        "today_stats": {
            "total_bookings": total_today,
            "confirmed": confirmed_count,
            "arrived": arrived_count,
            "in_progress": in_progress_count,
            "completed": completed_count,
            "cancelled": cancelled_count,
            "no_show": no_show_count,
            "planned_revenue_minor": planned_revenue_minor,
            "planned_revenue_formatted": f"{planned_revenue_minor / 100:,.0f} ₸".replace(",", " ")
        },
        "subscription_status": sub.lifecycle_status if sub else "unknown",
        "trial_ends_at": sub.trial_ends_at if sub else None,
        "grace_ends_at": sub.grace_ends_at if sub else None
    }


# =========================================================================
# BRANCHES
# =========================================================================

@router.get("/branches", response_model=List[BranchResponse])
async def list_branches(
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Branch).where(Branch.tenant_id == crm_user.tenant_id).order_by(Branch.name)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/branches", response_model=BranchResponse, status_code=status.HTTP_201_CREATED)
async def create_branch(
    data: dict,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt_cnt = select(func.count(Branch.id)).where(Branch.tenant_id == crm_user.tenant_id, Branch.status == "active")
    cur_cnt = (await db.execute(stmt_cnt)).scalar() or 0
    await check_tenant_entitlement_limit(crm_user.tenant_id, "max_branches", cur_cnt, db)

    branch = Branch(
        tenant_id=crm_user.tenant_id,
        name=data["name"],
        city=data.get("city", "Астана"),
        address=data["address"],
        timezone_iana=ownership.require_timezone(data.get("timezone_iana") or data.get("timezone") or "Asia/Almaty"),
        phone=data.get("phone") or data.get("phone_number")
    )
    db.add(branch)
    await db.flush()
    await db.commit()
    return branch


# =========================================================================
# CALENDAR & BOOKINGS
# =========================================================================

@router.get("/calendar")
async def get_calendar(
    date: datetime.date,
    branch_id: uuid.UUID,
    staff_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns calendar day appointments, staff schedules, and calendar blocks.
    Master role: filtered strictly to their own schedule!
    """
    tenant_id = crm_user.tenant_id
    effective_staff_id = staff_id

    # M08: the branch must exist in this company (404) and be within the user's branch scope (403);
    # a master sees only his own calendar
    branch = await branch_scope.require_branch(db, crm_user, branch_id)
    own_staff = await branch_scope.master_profile_id(db, crm_user)
    if own_staff is not None:
        effective_staff_id = own_staff
    tz = zoneinfo.ZoneInfo(branch.timezone_iana or "Asia/Almaty")

    start_local = datetime.datetime.combine(date, datetime.time.min, tzinfo=tz)
    end_local = datetime.datetime.combine(date, datetime.time.max, tzinfo=tz)
    day_start_utc = start_local.astimezone(datetime.timezone.utc)
    day_end_utc = end_local.astimezone(datetime.timezone.utc)

    # 1. Staff on duty
    stmt_staff = select(StaffProfile).join(
        StaffBranch, StaffBranch.staff_id == StaffProfile.id
    ).where(
        StaffProfile.tenant_id == tenant_id,
        StaffBranch.branch_id == branch_id,
        StaffBranch.active == True,
        StaffProfile.active == True
    )
    if effective_staff_id:
        stmt_staff = stmt_staff.where(StaffProfile.id == effective_staff_id)
    res_staff = await db.execute(stmt_staff)
    staff_members = res_staff.scalars().all()

    # 2. Bookings
    stmt_bookings = select(Booking, Customer).join(
        Customer, Customer.id == Booking.customer_id
    ).where(
        Booking.tenant_id == tenant_id,
        Booking.branch_id == branch_id,
        Booking.starts_at_utc >= day_start_utc,
        Booking.starts_at_utc <= day_end_utc
    )
    if effective_staff_id:
        stmt_bookings = stmt_bookings.where(Booking.staff_id == effective_staff_id)
    res_bookings = await db.execute(stmt_bookings)

    booking_list = []
    for b, c in res_bookings.all():
        # Items
        stmt_it = select(BookingItem).where(BookingItem.booking_id == b.id).order_by(BookingItem.sequence)
        res_it = await db.execute(stmt_it)
        items = res_it.scalars().all()

        fin = await FinanceCoreService.get_visit_financial_summary(b, db)

        booking_list.append({
            "id": str(b.id),
            "public_ref": b.public_ref,
            "staff_id": str(b.staff_id),
            "customer_id": str(c.id),
            "customer_name": c.full_name,
            "customer_phone": c.phone_e164,
            "status": b.status,
            "starts_at_utc": b.starts_at_utc.isoformat(),
            "service_ends_at_utc": b.service_ends_at_utc.isoformat(),
            "amount_minor": b.amount_minor_snapshot,
            "cost_minor": fin["cost_minor"],
            "rendered_minor": fin["rendered_minor"],
            "paid_minor": fin["paid_minor"],
            "debt_minor": fin["debt_minor"],
            "payment_status": fin["payment_status"],
            "finance": fin,
            "services": [it.service_name_snapshot for it in items]
        })

    # 3. Calendar blocks
    stmt_blocks = select(CalendarBlock).where(
        CalendarBlock.tenant_id == tenant_id,
        CalendarBlock.branch_id == branch_id,
        CalendarBlock.starts_at_utc < day_end_utc,
        CalendarBlock.ends_at_utc > day_start_utc
    )
    if effective_staff_id:
        stmt_blocks = stmt_blocks.where(CalendarBlock.staff_id == effective_staff_id)
    res_blocks = await db.execute(stmt_blocks)
    blocks = res_blocks.scalars().all()

    return {
        "date": date.isoformat(),
        "branch_id": str(branch_id),
        "timezone": branch.timezone_iana,
        # working = shift minus breaks; free = working minus bookings, blocks and time off.
        # The CRM must not compute availability itself (M08 STOP): render these windows.
        "staff": [
            {"id": str(s.id), "display_name": s.display_name, "role_title": s.role_title, "color": s.color,
             **(await BookingEngine.staff_day_windows(db, tenant_id, branch_id, s.id, date, tz))}
            for s in staff_members
        ],
        "bookings": booking_list,
        "blocks": [
            {
                "id": str(bl.id),
                "staff_id": str(bl.staff_id),
                "starts_at_utc": bl.starts_at_utc.isoformat(),
                "ends_at_utc": bl.ends_at_utc.isoformat(),
                "reason": bl.block_reason
            }
            for bl in blocks
        ]
    }


@router.post("/bookings", status_code=status.HTTP_201_CREATED)
async def crm_create_booking(
    req: CRMCreateBookingRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a booking manually from CRM via the same BookingEngine (and the same overlap
    constraint) as public bookings: a manual and an online request for one slot cannot both win."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    await branch_scope.require_branch(db, crm_user, req.branch_id)
    if crm_user.role == "master" and req.staff_id != await branch_scope.master_profile_id(db, crm_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Access denied: master cannot create appointments for other staff"}
        )
    await branch_scope.require_staff_in_branch(db, crm_user, req.staff_id, req.branch_id)
    try:
        booking, mgmt_token, raw_token = await BookingEngine.create_booking(
            db=db,
            tenant_id=crm_user.tenant_id,
            branch_id=req.branch_id,
            staff_id=req.staff_id,
            service_ids=req.service_ids,
            starts_at_utc=req.starts_at_utc,
            customer_name=req.customer_name,
            customer_phone_e164=req.customer_phone,
            customer_email=req.customer_email,
            notes=req.notes,
            source="crm_manual",
            idempotency_key=idempotency_key,
            created_by_user_id=crm_user.user.id,
            customer_id=req.customer_id
        )
        return {
            "booking_id": str(booking.id),
            "public_ref": booking.public_ref,
            "status": booking.status,
            "starts_at_utc": booking.starts_at_utc,
            "total_amount_minor": booking.amount_minor_snapshot,
            "customer_id": str(booking.customer_id) if booking.customer_id else None
        }
    except BookingEngineError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, "details": e.details})


async def _visit_finance(db: AsyncSession, crm_user: AuthenticatedTenantUser, booking: Booking) -> Optional[dict]:
    if crm_user.role == "master":
        return None  # masters do not see money (M15)
    order = await accrual.booking_order(db, booking)
    if order is None:
        cost = booking.amount_minor_snapshot or 0
        return {
            "order_id": None, "currency": booking.currency, "sold_minor": cost,
            "cost_minor": cost, "order_total_minor": cost,
            "rendered_minor": 0, "received_minor": 0, "paid_minor": 0,
            "advance_applied_minor": 0, "debt_minor": 0, "payment_status": "unpaid"
        }
    p = await finance_ledger.order_position(db, crm_user.tenant_id, order.id)
    paid = p.received_minor + p.advance_applied_minor
    debt = p.debt_minor
    cost = p.sold_minor
    payment_status = "paid" if (paid >= cost and cost > 0) else ("partially_paid" if paid > 0 else "unpaid")
    return {
        "order_id": str(order.id), "order_status": order.status, "currency": p.currency,
        "sold_minor": p.sold_minor, "cost_minor": cost, "order_total_minor": cost,
        "rendered_minor": p.rendered_minor, "received_minor": p.received_minor, "paid_minor": paid,
        "advance_applied_minor": p.advance_applied_minor, "debt_minor": debt,
        "payment_status": payment_status
    }


class PaymentCreateRequest(BaseModel):
    amount_minor: int = Field(gt=0)
    cash_account_id: Optional[uuid.UUID] = None
    payment_method: Optional[str] = "cash"
    note: Optional[str] = Field(default=None, max_length=500)
    comment: Optional[str] = Field(default=None, max_length=500)
    cashier_name: Optional[str] = None


def _finance_error(e: FinanceError) -> HTTPException:
    return HTTPException(status_code=e.http_status, detail={"code": e.code, "message": e.message})


@router.get("/cash-accounts")
async def list_cash_accounts(
    branch_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Branch cash accounts with the balance the ledger expects in each (M12). Masters: 403."""
    await branch_scope.require_branch(db, crm_user, branch_id)
    accounts = await finance_cash.ensure_default_accounts(db, crm_user.tenant_id, branch_id)
    out = [{"id": str(a.id), "name": a.name, "kind": a.kind, "active": a.active,
            "balance_minor": await finance_cash.account_balance(db, crm_user.tenant_id, a.id)} for a in accounts]
    await db.commit()
    return out


@router.post("/bookings/{booking_id}/payments", status_code=status.HTTP_201_CREATED)
async def create_visit_payment(
    booking_id: uuid.UUID,
    req: PaymentCreateRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Cash or external transfer registered manually by the cashier (owner/admin) (M12).

    Partial payments are allowed; paying more than the debt is not; the same Idempotency-Key
    never takes the money twice."""
    logger.info("CREATE_VISIT_PAYMENT: booking_id=%s, req=%s", booking_id, req.dict())
    await check_crm_write_permitted(crm_user.tenant_id, db)
    b = (await db.execute(select(Booking).where(
        Booking.id == booking_id, Booking.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail={"code": "BOOKING_NOT_FOUND", "message": "Запись не найдена"})
    await branch_scope.require_booking_access(db, crm_user, b.branch_id, b.staff_id)
    order = await accrual.booking_order(db, b)
    if order is None:
        logger.info("CREATE_VISIT_PAYMENT: order is None! booking status is %s", b.status)
        raise HTTPException(status_code=409, detail={"code": "NOTHING_TO_PAY",
                                                     "message": "Визит ещё не завершён: оплату принимаем после оказания услуги"})
    account_id = req.cash_account_id
    if not account_id:
        accs = await finance_cash.ensure_default_accounts(db, crm_user.tenant_id, b.branch_id)
        kind = "cash" if req.payment_method == "cash" else "bank_transfer"
        acc = next((a for a in accs if a.kind == kind), accs[0] if accs else None)
        if not acc:
            raise HTTPException(status_code=400, detail="No cash account available")
        account_id = acc.id

    try:
        res = await finance_cash.record_payment(
            db, tenant_id=crm_user.tenant_id, order_id=order.id, amount_minor=req.amount_minor,
            cash_account_id=account_id, idempotency_key=idempotency_key or "",
            actor_id=crm_user.user.id, note=req.note or req.comment)
    except FinanceError as e:
        logger.info("CREATE_VISIT_PAYMENT: FinanceError=%s code=%s msg=%s", e, e.code, e.message)
        await db.rollback()
        raise _finance_error(e)
    await db.commit()
    p = res.position
    return {
        "payment_id": str(res.entry.id),
        "id": str(res.entry.id),
        "booking_id": str(booking_id),
        "replayed": not res.created,
        "amount_minor": res.entry.amount_minor,
        "payment_type": "payment",
        "payment_method": req.payment_method or "cash",
        "cashier_name": req.cashier_name or "Администратор",
        "status": "confirmed",
        "created_at": res.entry.created_at.isoformat() if hasattr(res.entry.created_at, "isoformat") else str(res.entry.created_at),
        "cash_account_id": str(res.entry.cash_account_id),
        "finance": {"rendered_minor": p.rendered_minor, "received_minor": p.received_minor, "debt_minor": p.debt_minor}
    }


@router.get("/bookings/{booking_id}/payments")
async def list_visit_payments(
    booking_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    b = (await db.execute(select(Booking).where(
        Booking.id == booking_id, Booking.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail={"code": "BOOKING_NOT_FOUND", "message": "Запись не найдена"})
    await branch_scope.require_booking_access(db, crm_user, b.branch_id, b.staff_id)
    order = await accrual.booking_order(db, b)
    if order is None:
        return []
    rows = (await db.execute(select(LedgerEntry, CashAccount.name, CashAccount.kind).outerjoin(
        CashAccount, CashAccount.id == LedgerEntry.cash_account_id).where(
        LedgerEntry.tenant_id == crm_user.tenant_id, LedgerEntry.order_id == order.id,
        LedgerEntry.kind.in_(("payment", "refund", "advance_applied"))).order_by(LedgerEntry.created_at))).all()
    return [{
        "id": str(e.id),
        "payment_id": str(e.id),
        "booking_id": str(booking_id),
        "kind": e.kind,
        "payment_type": e.kind,
        "amount_minor": e.amount_minor,
        "cash_account": name,
        "payment_method": "cash" if acc_kind == "cash" else "card",
        "reverses_entry_id": str(e.reverses_entry_id) if e.reverses_entry_id else None,
        "original_payment_id": str(e.reverses_entry_id) if e.reverses_entry_id else None,
        "reason": e.reason,
        "comment": e.reason,
        "created_by_user_id": str(e.created_by_user_id) if e.created_by_user_id else None,
        "cashier_name": "Администратор",
        "status": "confirmed",
        "created_at": e.created_at.isoformat() if hasattr(e.created_at, "isoformat") else str(e.created_at)
    } for e, name, acc_kind in rows]


class RefundCreateRequest(BaseModel):
    amount_minor: int = Field(gt=0)
    cash_account_id: Optional[uuid.UUID] = None
    reason: str = Field(min_length=1, max_length=500)
    comment: Optional[str] = None
    payment_method: Optional[str] = "cash"
    payment_id: Optional[str] = None


class AdvanceCreateRequest(BaseModel):
    branch_id: uuid.UUID
    amount_minor: int = Field(gt=0)
    cash_account_id: uuid.UUID
    note: Optional[str] = Field(default=None, max_length=500)


class ApplyAdvanceRequest(BaseModel):
    amount_minor: int = Field(gt=0)


class ShiftOpenRequest(BaseModel):
    cash_account_id: uuid.UUID
    opening_float_minor: int = Field(default=0, ge=0)


class ShiftCloseRequest(BaseModel):
    counted_minor: int = Field(ge=0)
    note: Optional[str] = Field(default=None, max_length=1000)


class ReverseRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


async def _visit_order(db: AsyncSession, crm_user: AuthenticatedTenantUser, booking_id: uuid.UUID):
    b = (await db.execute(select(Booking).where(
        Booking.id == booking_id, Booking.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail={"code": "BOOKING_NOT_FOUND", "message": "Запись не найдена"})
    await branch_scope.require_booking_access(db, crm_user, b.branch_id, b.staff_id)
    order = await accrual.booking_order(db, b)
    if order is None:
        raise HTTPException(status_code=409, detail={"code": "NOTHING_TO_PAY", "message": "Визит ещё не завершён"})
    return b, order


def _position(p):
    return None if p is None else {"rendered_minor": p.rendered_minor, "received_minor": p.received_minor,
                                   "advance_applied_minor": p.advance_applied_minor, "debt_minor": p.debt_minor}


async def _money_call(db: AsyncSession, fn):
    try:
        res = await fn()
    except FinanceError as e:
        await db.rollback()
        raise _finance_error(e)
    await db.commit()
    return {"entry_id": str(res.entry.id), "kind": res.entry.kind, "amount_minor": res.entry.amount_minor,
            "replayed": not res.created, "finance": _position(res.position)}


@router.post("/bookings/{booking_id}/refunds", status_code=status.HTTP_201_CREATED)
async def create_visit_refund(
    booking_id: uuid.UUID, req: RefundCreateRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Money back for the service (M13): refund + matching reduction of rendered; the original payment stays."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    b, order = await _visit_order(db, crm_user, booking_id)
    account_id = req.cash_account_id
    if not account_id and req.payment_id:
        try:
            orig = (await db.execute(select(LedgerEntry).where(
                LedgerEntry.tenant_id == crm_user.tenant_id,
                LedgerEntry.id == uuid.UUID(req.payment_id)))).scalar_one_or_none()
            if orig:
                account_id = orig.cash_account_id
        except Exception:
            pass
    if not account_id:
        accs = await finance_cash.ensure_default_accounts(db, crm_user.tenant_id, b.branch_id)
        kind = "cash" if req.payment_method == "cash" else "bank_transfer"
        acc = next((a for a in accs if a.kind == kind), accs[0] if accs else None)
        account_id = acc.id if acc else None
    if not account_id:
        raise HTTPException(status_code=400, detail="No cash account available")
    return await _money_call(db, lambda: finance_cash.refund(
        db, tenant_id=crm_user.tenant_id, order_id=order.id, amount_minor=req.amount_minor,
        cash_account_id=account_id, reason=req.reason or req.comment or "Возврат",
        idempotency_key=idempotency_key or str(uuid.uuid4()),
        actor_id=crm_user.user.id))


@router.post("/bookings/{booking_id}/apply-advance", status_code=status.HTTP_201_CREATED)
async def apply_customer_advance(
    booking_id: uuid.UUID, req: ApplyAdvanceRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    _, order = await _visit_order(db, crm_user, booking_id)
    return await _money_call(db, lambda: finance_cash.apply_advance(
        db, tenant_id=crm_user.tenant_id, order_id=order.id, amount_minor=req.amount_minor,
        idempotency_key=idempotency_key or "", actor_id=crm_user.user.id))


@router.post("/customers/{customer_id}/advances", status_code=status.HTTP_201_CREATED)
async def receive_customer_advance(
    customer_id: uuid.UUID, req: AdvanceCreateRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Money received before the service: a liability to the client, not revenue (M13)."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    await branch_scope.require_branch(db, crm_user, req.branch_id)
    out = await _money_call(db, lambda: finance_cash.receive_advance(
        db, tenant_id=crm_user.tenant_id, customer_id=customer_id, branch_id=req.branch_id,
        amount_minor=req.amount_minor, cash_account_id=req.cash_account_id, idempotency_key=idempotency_key or "",
        actor_id=crm_user.user.id, note=req.note))
    await set_tenant_context(db, crm_user.tenant_id)
    out["advance_balance_minor"] = await finance_cash.advance_balance(db, crm_user.tenant_id, customer_id)
    return out


@router.get("/customers/{customer_id}/advance")
async def get_customer_advance(
    customer_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    c = (await db.execute(select(Customer).where(Customer.id == customer_id, Customer.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if c is None:
        raise HTTPException(status_code=404, detail={"code": "CUSTOMER_NOT_FOUND", "message": "Клиент не найден"})
    return {"customer_id": str(c.id), "advance_balance_minor": await finance_cash.advance_balance(db, crm_user.tenant_id, c.id)}


@router.post("/ledger-entries/{entry_id}/reverse", status_code=status.HTTP_201_CREATED)
async def reverse_ledger_entry(
    entry_id: uuid.UUID, req: ReverseRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Storno of a cashier mistake: an opposite entry in the current shift; nothing is deleted (M13)."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    e = (await db.execute(select(LedgerEntry).where(
        LedgerEntry.id == entry_id, LedgerEntry.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if e is None:
        raise HTTPException(status_code=404, detail={"code": "ENTRY_NOT_FOUND", "message": "Операция не найдена"})
    await branch_scope.require_branch(db, crm_user, e.branch_id)
    return await _money_call(db, lambda: finance_cash.reverse(
        db, tenant_id=crm_user.tenant_id, entry_id=entry_id, reason=req.reason,
        idempotency_key=idempotency_key or "", actor_id=crm_user.user.id))


async def _shift_report(db: AsyncSession, shift) -> dict:
    moves = await finance_shifts.shift_movements(db, shift)
    expected = finance_shifts.expected_cash(shift, moves)
    return {"id": str(shift.id), "status": shift.status, "cash_account_id": str(shift.cash_account_id),
            "branch_id": str(shift.branch_id), "opened_at": shift.opened_at, "closed_at": shift.closed_at,
            "opening_float_minor": shift.opening_float_minor, "movements": moves,
            "expected_minor": shift.expected_minor if shift.status == "closed" else expected,
            "counted_minor": shift.counted_minor, "difference_minor": shift.difference_minor, "close_note": shift.close_note}


@router.post("/cash-shifts/open", status_code=status.HTTP_201_CREATED)
async def open_cash_shift(
    req: ShiftOpenRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    acc = (await db.execute(select(CashAccount).where(
        CashAccount.id == req.cash_account_id, CashAccount.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if acc is None:
        raise HTTPException(status_code=404, detail={"code": "CASH_ACCOUNT_NOT_FOUND", "message": "Касса не найдена"})
    await branch_scope.require_branch(db, crm_user, acc.branch_id)
    try:
        shift = await finance_shifts.open_shift(db, tenant_id=crm_user.tenant_id, account=acc,
                                                opening_float_minor=req.opening_float_minor, actor_id=crm_user.user.id)
        out = await _shift_report(db, shift)
    except FinanceError as e:
        await db.rollback()
        raise _finance_error(e)
    await db.commit()
    return out


@router.post("/cash-shifts/{shift_id}/close")
async def close_cash_shift(
    shift_id: uuid.UUID, req: ShiftCloseRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    s = (await db.execute(select(CashShift).where(CashShift.id == shift_id, CashShift.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if s is None:
        raise HTTPException(status_code=404, detail={"code": "SHIFT_NOT_FOUND", "message": "Смена не найдена"})
    await branch_scope.require_branch(db, crm_user, s.branch_id)
    try:
        shift = await finance_shifts.close_shift(db, tenant_id=crm_user.tenant_id, shift_id=shift_id,
                                                 counted_minor=req.counted_minor, note=req.note, actor_id=crm_user.user.id)
        out = await _shift_report(db, shift)
    except FinanceError as e:
        await db.rollback()
        raise _finance_error(e)
    await db.commit()
    return out


@router.get("/cash-shifts")
async def list_cash_shifts(
    branch_id: Optional[uuid.UUID] = None,
    limit: int = Query(default=50, ge=1, le=200),
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    branches = await _report_branches(db, crm_user, branch_id)
    if not branches:
        return []
    shifts = (await db.execute(
        select(CashShift)
        .where(CashShift.tenant_id == crm_user.tenant_id, CashShift.branch_id.in_(branches))
        .order_by(CashShift.opened_at.desc())
        .limit(limit)
    )).scalars().all()
    return [await _shift_report(db, s) for s in shifts]


@router.get("/cash-shifts/current")
async def get_current_cash_shift(
    branch_id: Optional[uuid.UUID] = None,
    cash_account_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    branches = await _report_branches(db, crm_user, branch_id)
    if not branches:
        return None
    stmt = select(CashShift).where(
        CashShift.tenant_id == crm_user.tenant_id,
        CashShift.branch_id.in_(branches),
        CashShift.status == "open"
    )
    if cash_account_id is not None:
        stmt = stmt.where(CashShift.cash_account_id == cash_account_id)
    shift = (await db.execute(stmt.order_by(CashShift.opened_at.desc()).limit(1))).scalar_one_or_none()
    if shift is None:
        return None
    return await _shift_report(db, shift)


@router.get("/cash-shifts/{shift_id}")
async def get_cash_shift(
    shift_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    s = (await db.execute(select(CashShift).where(CashShift.id == shift_id, CashShift.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if s is None:
        raise HTTPException(status_code=404, detail={"code": "SHIFT_NOT_FOUND", "message": "Смена не найдена"})
    await branch_scope.require_branch(db, crm_user, s.branch_id)
    return await _shift_report(db, s)


# =========================================================================
# EXPENSES AND FINANCE REPORT (M14): figures come from the money ledger only
# =========================================================================

class ExpenseCategoryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class ExpenseCreateRequest(BaseModel):
    branch_id: uuid.UUID
    cash_account_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    category: Optional[str] = None
    amount_minor: int = Field(gt=0)
    reason: Optional[str] = Field(default=None, max_length=500)
    comment: Optional[str] = Field(default=None, max_length=500)
    payment_method: Optional[str] = "cash"
    expense_date: Optional[str] = None
    created_by: Optional[str] = None


def _category_out(c: ExpenseCategory) -> dict:
    return {"id": str(c.id), "name": c.name, "archived": c.archived_at is not None}


@router.get("/expense-categories")
async def list_expense_categories(
    include_archived: bool = False,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    cats = await finance_expenses.list_categories(db, crm_user.tenant_id, include_archived)
    out = [_category_out(c) for c in cats]
    await db.commit()
    return out


@router.post("/expense-categories", status_code=status.HTTP_201_CREATED)
async def create_expense_category(
    req: ExpenseCategoryCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    try:
        cat = await finance_expenses.create_category(db, crm_user.tenant_id, req.name)
        out = _category_out(cat)
    except FinanceError as e:
        await db.rollback()
        raise _finance_error(e)
    await db.commit()
    return out


@router.post("/expense-categories/{category_id}/archive")
async def archive_expense_category(
    category_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    try:
        out = _category_out(await finance_expenses.archive_category(db, crm_user.tenant_id, category_id))
    except FinanceError as e:
        await db.rollback()
        raise _finance_error(e)
    await db.commit()
    return out


@router.post("/expenses", status_code=status.HTTP_201_CREATED)
async def create_expense(
    req: ExpenseCreateRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Money out of a branch till by expense category (M14). Cash: only within an open shift, never below zero."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    await branch_scope.require_branch(db, crm_user, req.branch_id)

    # resolve category
    category_id = req.category_id
    if not category_id:
        cat_name = req.category or "Прочее"
        cats = await finance_expenses.list_categories(db, crm_user.tenant_id, include_archived=False)
        cat = next((c for c in cats if c.name.lower() == cat_name.lower()), cats[0] if cats else None)
        if not cat:
            cat = await finance_expenses.create_category(db, crm_user.tenant_id, cat_name)
        category_id = cat.id

    # resolve cash account
    account_id = req.cash_account_id
    if not account_id:
        accs = await finance_cash.ensure_default_accounts(db, crm_user.tenant_id, req.branch_id)
        kind = "cash" if req.payment_method == "cash" else "bank_transfer"
        acc = next((a for a in accs if a.kind == kind), accs[0] if accs else None)
        if not acc:
            raise HTTPException(status_code=400, detail="No cash account available")
        account_id = acc.id

    reason = (req.reason if req.reason is not None else req.comment) or ""
    return await _money_call(db, lambda: finance_expenses.record_expense(
        db, tenant_id=crm_user.tenant_id, branch_id=req.branch_id, cash_account_id=account_id,
        category_id=category_id, amount_minor=req.amount_minor, reason=reason,
        idempotency_key=idempotency_key or "", actor_id=crm_user.user.id))


@router.get("/expenses")
async def list_expenses(
    branch_id: Optional[uuid.UUID] = None,
    from_date: Optional[datetime.date] = None,
    to_date: Optional[datetime.date] = None,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    branches = await _report_branches(db, crm_user, branch_id)
    if not branches:
        return []
    if not to_date:
        to_date = datetime.date.today()
    if not from_date:
        from_date = to_date - datetime.timedelta(days=30)
    try:
        finance_reports.validate_period(from_date, to_date)
    except FinanceError as e:
        raise _finance_error(e)
    branch_rows = (await db.execute(select(Branch).where(Branch.tenant_id == crm_user.tenant_id, Branch.id.in_(branches)))).scalars().all()
    tz_name = branch_rows[0].timezone_iana if branch_rows else "Asia/Almaty"
    start, end = finance_reports.local_bounds(from_date, to_date, tz_name)
    rows = (await db.execute(select(LedgerEntry, ExpenseCategory.name, CashAccount.name)
                             .join(ExpenseCategory, ExpenseCategory.id == LedgerEntry.expense_category_id)
                             .join(CashAccount, CashAccount.id == LedgerEntry.cash_account_id)
                             .where(LedgerEntry.tenant_id == crm_user.tenant_id, LedgerEntry.branch_id.in_(branches),
                                    LedgerEntry.kind == "expense", LedgerEntry.occurred_at >= start,
                                    LedgerEntry.occurred_at < end)
                             .order_by(LedgerEntry.occurred_at, LedgerEntry.created_at))).all()
    return [{
        "id": str(e.id),
        "branch_id": str(e.branch_id),
        "occurred_at": e.occurred_at,
        "expense_date": e.occurred_at.date().isoformat() if hasattr(e.occurred_at, "date") else str(e.occurred_at)[:10],
        "amount_minor": e.amount_minor,
        "category": cat,
        "comment": e.reason,
        "reason": e.reason,
        "cash_account": acc,
        "payment_method": "cash" if acc and "нал" in acc.lower() else "account",
        "created_by": "Владелец" if crm_user.role == "owner" else "Администратор",
        "reverses_entry_id": str(e.reverses_entry_id) if e.reverses_entry_id else None,
        "created_by_user_id": str(e.created_by_user_id) if e.created_by_user_id else None
    } for e, cat, acc in rows]


async def _report_branches(db: AsyncSession, crm_user: AuthenticatedTenantUser, branch_id: Optional[uuid.UUID]):
    if branch_id is not None:
        await branch_scope.require_branch(db, crm_user, branch_id)
        return {branch_id}
    return await branch_scope.allowed_branch_ids(db, crm_user)


@router.get("/reports/finance")
async def get_finance_report(
    from_date: datetime.date,
    to_date: datetime.date,
    branch_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Rendered, received, advances, expenses, receivables and advance liability for a period (M14).

    Branch-local day boundaries; the company total is the sum of branches. Masters: 403;
    an admin with branch grants sees only those branches."""
    branches = await _report_branches(db, crm_user, branch_id)
    try:
        return await finance_reports.finance_report(db, crm_user.tenant_id, from_date, to_date, branches)
    except FinanceError as e:
        raise _finance_error(e)


@router.get("/reports/visits")
async def get_visits_report(
    from_date: datetime.date,
    to_date: datetime.date,
    branch_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Visits breakdown for a period (M14), scoped by branch rights."""
    branches = await _report_branches(db, crm_user, branch_id)
    try:
        finance_reports.validate_period(from_date, to_date)
    except FinanceError as e:
        raise _finance_error(e)
    if not branches:
        return {
            "total_bookings": 0, "completed_bookings": 0, "cancelled_bookings": 0,
            "arrived_bookings": 0, "in_progress_bookings": 0, "no_show_bookings": 0,
            "completion_rate_percent": 0, "items": []
        }
    branch_rows = (await db.execute(select(Branch).where(Branch.tenant_id == crm_user.tenant_id, Branch.id.in_(branches)))).scalars().all()
    tz_map = {b.id: b.timezone_iana for b in branch_rows}
    tz_name = branch_rows[0].timezone_iana if branch_rows else "Asia/Almaty"
    start, end = finance_reports.local_bounds(from_date, to_date, tz_name)

    rows = (await db.execute(
        select(Booking, Customer.full_name, StaffProfile.display_name)
        .join(Customer, Customer.id == Booking.customer_id)
        .join(StaffProfile, StaffProfile.id == Booking.staff_id)
        .where(
            Booking.tenant_id == crm_user.tenant_id,
            Booking.branch_id.in_(branches),
            Booking.starts_at_utc >= start,
            Booking.starts_at_utc < end
        )
        .order_by(Booking.starts_at_utc.desc())
    )).all()

    booking_ids = [b.id for b, _, _ in rows]
    items_by_booking: Dict[uuid.UUID, List[str]] = {}
    if booking_ids:
        bi_rows = (await db.execute(
            select(BookingItem.booking_id, BookingItem.service_name_snapshot)
            .where(BookingItem.booking_id.in_(booking_ids))
            .order_by(BookingItem.sequence)
        )).all()
        for bid, sname in bi_rows:
            items_by_booking.setdefault(bid, []).append(sname)

    total = len(rows)
    completed = sum(1 for b, _, _ in rows if b.status == "completed")
    cancelled = sum(1 for b, _, _ in rows if b.status == "cancelled")
    arrived = sum(1 for b, _, _ in rows if b.status == "arrived")
    in_progress = sum(1 for b, _, _ in rows if b.status == "in_progress")
    no_show = sum(1 for b, _, _ in rows if b.status == "no_show")
    completion_rate = round((completed / total) * 100) if total > 0 else 0

    out_items = []
    for b, cust_name, staff_name in rows:
        tz = zoneinfo.ZoneInfo(tz_map.get(b.branch_id, tz_name))
        local_dt = b.starts_at_utc.astimezone(tz)
        out_items.append({
            "id": str(b.id),
            "public_ref": b.public_ref,
            "customer_name": cust_name,
            "staff_name": staff_name,
            "services": items_by_booking.get(b.id, []),
            "date_display": local_dt.strftime("%Y-%m-%d"),
            "time_display": local_dt.strftime("%H:%M"),
            "status": b.status,
            "amount_minor": b.amount_minor_snapshot or 0,
        })

    return {
        "total_bookings": total,
        "completed_bookings": completed,
        "cancelled_bookings": cancelled,
        "arrived_bookings": arrived,
        "in_progress_bookings": in_progress,
        "no_show_bookings": no_show,
        "completion_rate_percent": completion_rate,
        "items": out_items,
    }


@router.get("/reports/services")
async def get_services_report(
    from_date: datetime.date,
    to_date: datetime.date,
    branch_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Rendered services breakdown from completed visits in period (M14)."""
    branches = await _report_branches(db, crm_user, branch_id)
    try:
        finance_reports.validate_period(from_date, to_date)
    except FinanceError as e:
        raise _finance_error(e)
    if not branches:
        return {"total_services_count": 0, "total_rendered_minor": 0, "average_ticket_minor": 0, "top_services": []}

    branch_rows = (await db.execute(select(Branch).where(Branch.tenant_id == crm_user.tenant_id, Branch.id.in_(branches)))).scalars().all()
    tz_name = branch_rows[0].timezone_iana if branch_rows else "Asia/Almaty"
    start, end = finance_reports.local_bounds(from_date, to_date, tz_name)

    rows = (await db.execute(
        select(BookingItem.service_id, BookingItem.service_name_snapshot, BookingItem.price_minor_snapshot, Booking.id)
        .join(Booking, Booking.id == BookingItem.booking_id)
        .where(
            Booking.tenant_id == crm_user.tenant_id,
            Booking.branch_id.in_(branches),
            Booking.status == "completed",
            Booking.starts_at_utc >= start,
            Booking.starts_at_utc < end
        )
    )).all()

    agg: Dict[str, Dict[str, Any]] = {}
    booking_ids = set()
    total_rendered = 0
    for sid, sname, price_minor, bid in rows:
        booking_ids.add(bid)
        key = str(sid) if sid else sname
        price = price_minor or 0
        total_rendered += price
        if key not in agg:
            agg[key] = {"service_id": key, "service_name": sname, "count": 0, "total_minor": 0}
        agg[key]["count"] += 1
        agg[key]["total_minor"] += price

    top_services = sorted(agg.values(), key=lambda x: x["total_minor"], reverse=True)
    for item in top_services:
        item["percentage"] = round((item["total_minor"] / total_rendered) * 100) if total_rendered > 0 else 0

    avg_ticket = round(total_rendered / len(booking_ids)) if booking_ids else 0
    return {
        "total_services_count": len(rows),
        "total_rendered_minor": total_rendered,
        "average_ticket_minor": avg_ticket,
        "top_services": top_services,
    }


@router.get("/reports/debts")
async def get_debts_report(
    branch_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Receivables (unpaid / partially paid completed visits) strictly from ledger (M14)."""
    branches = await _report_branches(db, crm_user, branch_id)
    if not branches:
        return {"total_debt_minor": 0, "debtors_count": 0, "items": []}

    branch_rows = (await db.execute(select(Branch).where(Branch.tenant_id == crm_user.tenant_id, Branch.id.in_(branches)))).scalars().all()
    tz_map = {b.id: b.timezone_iana for b in branch_rows}

    orders = (await db.execute(
        select(Order, Booking, Customer)
        .join(Booking, Booking.id == Order.booking_id)
        .join(Customer, Customer.id == Booking.customer_id)
        .where(
            Order.tenant_id == crm_user.tenant_id,
            Order.branch_id.in_(branches),
            Order.booking_id.is_not(None)
        )
        .order_by(Booking.starts_at_utc.desc())
    )).all()

    if not orders:
        return {"total_debt_minor": 0, "debtors_count": 0, "items": []}

    order_ids = [o.id for o, _, _ in orders]
    booking_ids = [b.id for _, b, _ in orders]

    ledger_rows = (await db.execute(
        select(LedgerEntry.order_id, LedgerEntry.kind, func.sum(LedgerEntry.amount_minor))
        .where(LedgerEntry.tenant_id == crm_user.tenant_id, LedgerEntry.order_id.in_(order_ids))
        .group_by(LedgerEntry.order_id, LedgerEntry.kind)
    )).all()

    by_order: Dict[uuid.UUID, Dict[str, int]] = {}
    for oid, kind, amt in ledger_rows:
        by_order.setdefault(oid, {})[kind] = int(amt or 0)

    bi_rows = (await db.execute(
        select(BookingItem.booking_id, BookingItem.service_name_snapshot)
        .where(BookingItem.booking_id.in_(booking_ids))
        .order_by(BookingItem.sequence)
    )).all()
    items_by_booking: Dict[uuid.UUID, List[str]] = {}
    for bid, sname in bi_rows:
        items_by_booking.setdefault(bid, []).append(sname)

    debt_items = []
    total_debt = 0
    for o, b, c in orders:
        m = by_order.get(o.id, {})
        rendered = m.get("service_rendered", 0) + m.get("adjustment", 0)
        received = m.get("payment", 0) + m.get("refund", 0)
        adv_applied = m.get("advance_applied", 0)
        paid = received + adv_applied
        debt = max(0, rendered - paid)
        if debt <= 0:
            continue
        total_debt += debt
        tz = zoneinfo.ZoneInfo(tz_map.get(b.branch_id, "Asia/Almaty"))
        local_dt = b.starts_at_utc.astimezone(tz)
        debt_items.append({
            "booking_id": str(b.id),
            "public_ref": b.public_ref,
            "customer_id": str(c.id),
            "customer_name": c.full_name,
            "customer_phone": c.phone_e164 or "",
            "visit_date": local_dt.strftime("%Y-%m-%d %H:%M"),
            "cost_minor": b.amount_minor_snapshot or rendered,
            "rendered_minor": rendered,
            "paid_minor": paid,
            "debt_minor": debt,
            "payment_status": "partially_paid" if paid > 0 else "unpaid",
            "services": items_by_booking.get(b.id, []),
        })

    return {
        "total_debt_minor": total_debt,
        "debtors_count": len(debt_items),
        "items": debt_items,
    }


@router.get("/bookings/{booking_id}")
async def get_crm_booking_card(
    booking_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Booking, Customer, StaffProfile).join(
        Customer, Customer.id == Booking.customer_id
    ).join(
        StaffProfile, StaffProfile.id == Booking.staff_id
    ).where(
        Booking.id == booking_id,
        Booking.tenant_id == crm_user.tenant_id
    )
    res = await db.execute(stmt)
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Booking not found")

    b, c, staff = row

    await branch_scope.require_booking_access(db, crm_user, b.branch_id, b.staff_id)

    # Items
    stmt_it = select(BookingItem).where(BookingItem.booking_id == b.id).order_by(BookingItem.sequence)
    res_it = await db.execute(stmt_it)
    items = res_it.scalars().all()

    # Events
    stmt_ev = select(BookingEvent).where(BookingEvent.booking_id == b.id).order_by(BookingEvent.created_at.desc())
    res_ev = await db.execute(stmt_ev)
    events = res_ev.scalars().all()

    fin = await FinanceCoreService.get_visit_financial_summary(b, db)

    return {
        "id": str(b.id),
        "public_ref": b.public_ref,
        "status": b.status,
        "starts_at_utc": b.starts_at_utc,
        "service_ends_at_utc": b.service_ends_at_utc,
        "cancelled_at": b.cancelled_at,
        "cancellation_reason": b.cancellation_reason,
        "staff_id": str(b.staff_id),
        "staff_name": staff.display_name,
        "customer": {
            "id": str(c.id),
            "name": c.full_name,
            "phone": c.phone_e164,
            "notes": c.notes_private
        },
        "amount_minor": b.amount_minor_snapshot,
        "cost_minor": fin["cost_minor"],
        "rendered_minor": fin["rendered_minor"],
        "paid_minor": fin["paid_minor"],
        "debt_minor": fin["debt_minor"],
        "payment_status": fin["payment_status"],
        "finance": fin,
        "items": [
            {
                "service_name": it.service_name_snapshot,
                "duration_minutes": it.duration_minutes_snapshot,
                "price_minor": it.price_minor_snapshot
            }
            for it in items
        ],
        "version": b.version,
        "cancellation_reason": b.cancellation_reason,
        # M11: money of the visit comes only from the order and the ledger, never from the status
        "finance": await _visit_finance(db, crm_user, b),
        "allowed_transitions": list(lifecycle.TRANSITIONS.get(b.status, ())),
        # full history: what changed, from what to what, by whom (M09)
        "events": [
            {
                "event_type": ev.event_type,
                "actor_type": ev.actor_type,
                "actor_id": str(ev.actor_id) if ev.actor_id else None,
                "created_at": ev.created_at,
                "old": ev.old_json_sanitized,
                "new": ev.new_json_sanitized,
                "old_data": ev.old_json_sanitized,
                "new_data": ev.new_json_sanitized,
            }
            for ev in events
        ]
    }


@router.patch("/bookings/{booking_id}/status")
async def update_booking_status(
    booking_id: uuid.UUID,
    req: StatusUpdateRequest,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    """Status change through the single lifecycle state machine (modules/bookings/lifecycle.py).

    The row is locked for the transition; illegal transitions -> 409 INVALID_TRANSITION with the
    allowed targets; cancelling releases the occupancy; every change appends an event.
    """
    await check_crm_write_permitted(crm_user.tenant_id, db)
    logger.info("UPDATE_BOOKING_STATUS: booking_id=%s req=%s", booking_id, req.dict())
    try:
        booking = await lifecycle.lock_booking(db, crm_user.tenant_id, booking_id)
        await branch_scope.require_booking_access(db, crm_user, booking.branch_id, booking.staff_id)
        old_status = booking.status
        await lifecycle.change_status(db, booking, req.status, actor_type="staff", actor_id=crm_user.user.id,
                                      reason=req.reason or ("Отменено сотрудником в CRM" if req.status == "cancelled" else None))
    except lifecycle.LifecycleError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, "details": e.details})

    # Provide finance summary in response within active tenant transaction
    fin = await _visit_finance(db, crm_user, booking)
    await db.commit()
    return {
        "status": booking.status,
        "previous_status": old_status,
        "version": booking.version,
        "message": f"Статус обновлен на '{booking.status}'",
        "finance": fin,
        "cost_minor": fin["order_total_minor"] if fin else 0,
        "rendered_minor": fin["rendered_minor"] if fin else 0,
        "paid_minor": fin["paid_minor"] if fin else 0,
        "debt_minor": fin["debt_minor"] if fin else 0,
        "payment_status": fin["payment_status"] if fin else "unpaid"
    }


@router.post("/bookings/{booking_id}/reschedule")
@router.patch("/bookings/{booking_id}/reschedule", include_in_schema=False)
async def crm_reschedule_booking(
    booking_id: uuid.UUID,
    req: RescheduleRequest,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    b = (await db.execute(select(Booking).where(
        Booking.id == booking_id, Booking.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail={"code": "BOOKING_NOT_FOUND", "message": "Запись не найдена"})
    await branch_scope.require_booking_access(db, crm_user, b.branch_id, b.staff_id)
    if req.new_staff_id is not None:
        await branch_scope.require_staff_in_branch(db, crm_user, req.new_staff_id, b.branch_id)
    try:
        updated = await BookingEngine.reschedule_booking(
            db=db,
            tenant_id=crm_user.tenant_id,
            booking_id=booking_id,
            new_starts_at_utc=req.new_starts_at_utc,
            new_staff_id=req.new_staff_id,
            is_client=False,
            actor_id=crm_user.user.id
        )
        return {"status": updated.status, "starts_at_utc": updated.starts_at_utc, "version": updated.version,
                "staff_id": str(updated.staff_id), "amount_minor": updated.amount_minor_snapshot}
    except BookingEngineError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, "details": e.details})


@router.post("/bookings/{booking_id}/cancel")
async def crm_cancel_booking(
    booking_id: uuid.UUID,
    req: CancelRequest,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    b = (await db.execute(select(Booking).where(
        Booking.id == booking_id, Booking.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail={"code": "BOOKING_NOT_FOUND", "message": "Запись не найдена"})
    await branch_scope.require_booking_access(db, crm_user, b.branch_id, b.staff_id)
    try:
        cancelled = await BookingEngine.cancel_booking(
            db=db,
            tenant_id=crm_user.tenant_id,
            booking_id=booking_id,
            reason=req.reason or "Отменено сотрудником в CRM",
            is_client=False,
            actor_id=crm_user.user.id
        )
        return {"status": cancelled.status, "version": cancelled.version, "message": "Запись успешно отменена"}
    except BookingEngineError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, "details": e.details})


# =========================================================================
# CALENDAR BLOCKS
# =========================================================================

@router.post("/calendar-blocks", status_code=status.HTTP_201_CREATED)
async def create_calendar_block(
    req: CalendarBlockCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a calendar block and takes an exclusion occupancy (same constraint as bookings)."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    await branch_scope.require_branch(db, crm_user, req.branch_id)
    await branch_scope.require_staff_in_branch(db, crm_user, req.staff_id, req.branch_id)
    block = CalendarBlock(
        tenant_id=crm_user.tenant_id,
        staff_id=req.staff_id,
        branch_id=req.branch_id,
        starts_at_utc=req.starts_at_utc,
        ends_at_utc=req.ends_at_utc,
        block_reason=req.block_reason,
        created_by=crm_user.user.id
    )
    db.add(block)
    await db.flush()

    # Create occupancy
    occupancy = StaffOccupancy(
        tenant_id=crm_user.tenant_id,
        staff_id=req.staff_id,
        branch_id=req.branch_id,
        block_id=block.id,
        starts_at_utc=req.starts_at_utc,
        ends_at_utc=req.ends_at_utc,
        occupancy_type="block"
    )
    db.add(occupancy)

    try:
        await db.commit()
    except (IntegrityError, DBAPIError) as exc:
        await db.rollback()
        if not is_slot_conflict(exc):
            raise  # not an overlap: do not report a different DB error as "time taken"
        raise HTTPException(status_code=409, detail={"code": "SLOT_CONFLICT",
                                                     "message": "Время уже занято другой записью или блокировкой"})

    return {"block_id": str(block.id), "message": "Блокировка успешно создана"}


@router.delete("/calendar-blocks/{block_id}")
async def delete_calendar_block(
    block_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(CalendarBlock).where(CalendarBlock.id == block_id, CalendarBlock.tenant_id == crm_user.tenant_id)
    res = await db.execute(stmt)
    block = res.scalar_one_or_none()
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")

    await branch_scope.require_branch(db, crm_user, block.branch_id)
    if crm_user.role == "master":
        stmt_sp = select(StaffProfile).where(
            StaffProfile.tenant_id == crm_user.tenant_id,
            StaffProfile.user_id == crm_user.user.id
        )
        res_sp = await db.execute(stmt_sp)
        sp = res_sp.scalar_one_or_none()
        if not sp or block.staff_id != sp.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: master cannot delete calendar blocks for other staff"
            )

    # Release occupancy
    stmt_occ = select(StaffOccupancy).where(StaffOccupancy.block_id == block.id)
    res_occ = await db.execute(stmt_occ)
    for o in res_occ.scalars().all():
        o.released_at = datetime.datetime.now(datetime.timezone.utc)

    await db.delete(block)
    await db.commit()
    return {"message": "Блокировка удалена"}


# =========================================================================
# CUSTOMERS
# =========================================================================

@router.get("/customers")
async def list_customers(
    search: Optional[str] = None,
    min_visits: Optional[int] = None,
    visits_filter: Optional[str] = None,
    sort_by: Optional[str] = "created_at",
    order: Optional[str] = "desc",
    limit: int = 50,
    offset: int = 0,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns company clients with visit stats, server filters and search. Strict tenant isolation!"""
    stmt = select(Customer).where(Customer.tenant_id == crm_user.tenant_id)
    if crm_user.role == "master":
        stmt_sp = select(StaffProfile).where(
            StaffProfile.tenant_id == crm_user.tenant_id,
            StaffProfile.user_id == crm_user.user.id
        )
        res_sp = await db.execute(stmt_sp)
        master_staff = res_sp.scalar_one_or_none()
        if not master_staff:
            return []
        stmt = stmt.join(Booking, Booking.customer_id == Customer.id).where(Booking.staff_id == master_staff.id).distinct()

    if search and search.strip():
        # M10: phone in any format (+7 / 8 / spaces) matches; LIKE wildcards in the input are literal
        name_term = f"%{customer_identity.like_escape(search.strip())}%"
        conds = [Customer.full_name.ilike(name_term, escape="\\"), Customer.phone_e164.like(name_term, escape="\\")]
        digits = customer_identity.search_digits(search)
        if digits:
            conds.append(Customer.phone_digits_index.like(f"%{digits}%"))
        if "@" in search:
            conds.append(Customer.email.ilike(name_term, escape="\\"))
        stmt = stmt.where(or_(*conds))

    # Apply sorting
    if sort_by == "full_name":
        stmt = stmt.order_by(Customer.full_name.asc() if order == "asc" else Customer.full_name.desc())
    else:
        stmt = stmt.order_by(Customer.created_at.asc() if order == "asc" else Customer.created_at.desc())
    res = await db.execute(stmt)
    customers = res.scalars().all()

    results = []
    for c in customers:
        # Total & completed visits count
        stmt_cnt = select(func.count(Booking.id)).where(Booking.customer_id == c.id, Booking.status == "completed")
        visit_cnt = (await db.execute(stmt_cnt)).scalar() or 0

        stmt_total = select(func.count(Booking.id)).where(Booking.customer_id == c.id)
        total_cnt = (await db.execute(stmt_total)).scalar() or 0

        # Filter by visits if requested
        if min_visits is not None and visit_cnt < min_visits:
            continue
        if visits_filter == "with_visits" and visit_cnt == 0:
            continue
        if visits_filter == "no_visits" and visit_cnt > 0:
            continue
        if visits_filter == "regular" and visit_cnt < 3:
            continue

        # Mask phone for master role
        phone_display = (c.phone_e164[:5] + "***" + c.phone_e164[-4:]) if (crm_user.role == "master" and len(c.phone_e164) >= 9) else c.phone_e164
        email_display = "***" if (crm_user.role == "master" and c.email) else c.email

        results.append({
            "id": str(c.id),
            "full_name": c.full_name,
            "phone": phone_display,
            "phone_e164": phone_display,
            "email": email_display,
            "notes": c.notes_private if crm_user.role != "master" else None,
            "notes_private": c.notes_private if crm_user.role != "master" else None,
            "completed_visits": visit_cnt,
            "total_bookings": total_cnt,
            "created_at": c.created_at.isoformat() if hasattr(c.created_at, "isoformat") else str(c.created_at)
        })

    if sort_by == "completed_visits":
        results.sort(key=lambda x: x["completed_visits"], reverse=(order != "asc"))

    # Apply pagination slice
    if offset:
        results = results[offset:]
    if limit:
        results = results[:limit]

    return results


@router.post("/customers", status_code=status.HTTP_201_CREATED)
async def create_customer(
    req: CustomerCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Same normalized phone AND same name -> the existing client is returned (duplicate_detected).
    Same phone, another name -> a new client; the others with this phone are listed so the
    administrator can decide. Two people are never merged automatically (M10)."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    try:
        resolved = await customer_identity.resolve_customer(
            db, tenant_id=crm_user.tenant_id, full_name=req.full_name, phone=req.phone_e164,
            email=req.email, source="crm_manual", notes_private=req.notes_private)
    except customer_identity.PhoneError as e:
        raise HTTPException(status_code=422, detail={"code": "PHONE_INVALID", "message": str(e)})
    same_phone_list = [{"id": str(o.id), "full_name": o.full_name} for o in resolved.same_phone_others]

    if resolved.created and same_phone_list and not req.confirm_shared_phone:
        await db.rollback()
        first_other = same_phone_list[0]
        return {
            "shared_phone_warning": True,
            "existing_name": first_other["full_name"],
            "existing_customer_id": first_other["id"],
            "duplicate_detected": False,
            "same_phone_customers": same_phone_list,
            "existing_clients": same_phone_list,
            "message": f"Номер уже привязан к клиенту {first_other['full_name']}. Подтвердите создание отдельного профиля."
        }

    await db.commit()
    c = resolved.customer
    return {
        "id": str(c.id),
        "full_name": c.full_name,
        "phone_e164": c.phone_e164,
        "duplicate_detected": not resolved.created,
        "same_phone_customers": same_phone_list,
        "existing_clients": same_phone_list,
        "shared_phone": len(same_phone_list) > 0,
        "shared_phone_warning": False,
        "message": "Клиент с таким именем и телефоном уже существует" if not resolved.created else None
    }


@router.post("/customers/{customer_id}/notes")
async def add_customer_note(
    customer_id: uuid.UUID,
    req: CustomerNoteCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt_c = select(Customer).where(Customer.id == customer_id, Customer.tenant_id == crm_user.tenant_id)
    cust = (await db.execute(stmt_c)).scalar_one_or_none()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    if crm_user.role == "master":
        stmt_sp = select(StaffProfile).where(StaffProfile.tenant_id == crm_user.tenant_id, StaffProfile.user_id == crm_user.user.id)
        master_staff = (await db.execute(stmt_sp)).scalars().first()
        if not master_staff:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Master has no staff profile in this company")
        stmt_mb = select(Booking.id).where(
            Booking.tenant_id == crm_user.tenant_id,
            Booking.customer_id == customer_id,
            Booking.staff_id == master_staff.id
        )
        has_booking = (await db.execute(stmt_mb)).scalars().first()
        if not has_booking:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: Master cannot add notes to an unrelated customer")

    note = CustomerNote(
        tenant_id=crm_user.tenant_id,
        customer_id=customer_id,
        author_id=crm_user.user.id,
        note=req.note
    )
    db.add(note)
    await db.commit()
    return {"id": str(note.id), "note": note.note, "message": "Заметка добавлена"}


# =========================================================================
# STAFF & SCHEDULE
# =========================================================================

@router.get("/staff")
async def list_staff(
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(StaffProfile).where(StaffProfile.tenant_id == crm_user.tenant_id).order_by(StaffProfile.display_name)
    res = await db.execute(stmt)
    staff_list = res.scalars().all()
    return staff_list


@router.post("/staff", status_code=status.HTTP_201_CREATED)
async def create_staff(
    req: StaffCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt_cnt = select(func.count(StaffProfile.id)).where(StaffProfile.tenant_id == crm_user.tenant_id, StaffProfile.active == True)
    cur_cnt = (await db.execute(stmt_cnt)).scalar() or 0
    await check_tenant_entitlement_limit(crm_user.tenant_id, "max_active_staff", cur_cnt, db)

    staff = StaffProfile(
        tenant_id=crm_user.tenant_id,
        display_name=req.display_name,
        role_title=req.role_title,
        color=req.color,
        online_bookable=req.online_bookable
    )
    for b_id in req.branch_ids:
        await ownership.require_branch(db, crm_user.tenant_id, b_id)
    db.add(staff)
    await db.flush()

    for b_id in req.branch_ids:
        sb = StaffBranch(tenant_id=crm_user.tenant_id, staff_id=staff.id, branch_id=b_id)
        db.add(sb)
        for weekday in range(1, 8):
            shift = WeeklyShift(
                tenant_id=crm_user.tenant_id,
                staff_id=staff.id,
                branch_id=b_id,
                weekday_iso=weekday,
                local_start=datetime.time(9, 0),
                local_end=datetime.time(20, 0),
            )
            db.add(shift)

    stmt_existing_svcs = select(Service).where(
        Service.tenant_id == crm_user.tenant_id,
        Service.active == True,
        Service.archived_at.is_(None)
    )
    existing_svcs = (await db.execute(stmt_existing_svcs)).scalars().all()
    for svc_item in existing_svcs:
        for b_id in req.branch_ids:
            sso = StaffServiceOffer(
                tenant_id=crm_user.tenant_id,
                staff_id=staff.id,
                branch_id=b_id,
                service_id=svc_item.id,
                active=True
            )
            db.add(sso)

    await db.flush()
    await db.commit()
    return staff


@router.put("/staff/{staff_id}/services")
async def update_staff_services(
    staff_id: uuid.UUID,
    payload: Union[List[StaffServiceOfferUpdateRequest], Dict[str, Any]],
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Sets master-specific price and duration overrides.

    Staff, branch and service must belong to the caller's company and the staff member
    must work in that branch; prices are validated as integer minor units (M04).
    """
    await check_crm_write_permitted(crm_user.tenant_id, db)
    raw_offers = payload.get("offers", []) if isinstance(payload, dict) else payload
    try:
        offers: List[StaffServiceOfferUpdateRequest] = [
            off if isinstance(off, StaffServiceOfferUpdateRequest) else StaffServiceOfferUpdateRequest(**off)
            for off in raw_offers
        ]
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=jsonable_encoder(e.errors(include_url=False, include_context=False)))
    await ownership.require_staff(db, crm_user.tenant_id, staff_id)
    seen_pairs = set()
    for off in offers:
        pair = (off.branch_id, off.service_id)
        if pair in seen_pairs:
            raise HTTPException(status_code=422, detail={"code": "DUPLICATE_OFFER", "message": "Одна и та же услуга филиала указана дважды"})
        seen_pairs.add(pair)
        await ownership.require_branch(db, crm_user.tenant_id, off.branch_id)
        await ownership.require_service(db, crm_user.tenant_id, off.service_id)
        await ownership.require_staff_in_branch(db, crm_user.tenant_id, staff_id, off.branch_id)
    for off in offers:
        stmt = select(StaffServiceOffer).where(
            StaffServiceOffer.tenant_id == crm_user.tenant_id,
            StaffServiceOffer.staff_id == staff_id,
            StaffServiceOffer.branch_id == off.branch_id,
            StaffServiceOffer.service_id == off.service_id
        )
        res = await db.execute(stmt)
        existing = res.scalar_one_or_none()
        if existing:
            existing.price_override_minor = off.price_override_minor
            existing.duration_override_minutes = off.duration_override_minutes
            existing.active = off.active
            existing.online_visible = off.online_visible
        else:
            new_off = StaffServiceOffer(
                tenant_id=crm_user.tenant_id,
                staff_id=staff_id,
                branch_id=off.branch_id,
                service_id=off.service_id,
                price_override_minor=off.price_override_minor,
                duration_override_minutes=off.duration_override_minutes,
                active=off.active,
                online_visible=off.online_visible
            )
            db.add(new_off)
    await db.commit()
    return {"message": "Услуги и цены мастера сохранены"}


# =========================================================================
# SERVICES & PRICING
# =========================================================================

@router.get("/service-categories")
async def list_service_categories(
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(ServiceCategory).where(
        ServiceCategory.tenant_id == crm_user.tenant_id,
        ServiceCategory.archived_at.is_(None)
    ).order_by(ServiceCategory.sort_order)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/service-categories", status_code=status.HTTP_201_CREATED)
async def create_service_category(
    req: ServiceCategoryCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    cat = ServiceCategory(tenant_id=crm_user.tenant_id, name=req.name, sort_order=req.sort_order)
    db.add(cat)
    await db.flush()
    await db.commit()
    return cat


@router.get("/services")
async def list_services(
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Service).where(
        Service.tenant_id == crm_user.tenant_id,
        Service.archived_at.is_(None)
    ).order_by(Service.sort_order)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/services", status_code=status.HTTP_201_CREATED)
async def create_service(
    req: ServiceCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    await ownership.require_category(db, crm_user.tenant_id, req.category_id)
    svc = Service(
        tenant_id=crm_user.tenant_id,
        category_id=req.category_id,
        name=req.name.strip(),
        description=req.description,
        base_price_minor=req.base_price_minor,
        currency=await ownership.tenant_currency(db, crm_user.tenant_id),
        base_duration_minutes=req.base_duration_minutes,
        active=req.active,
        online_visible=req.online_visible
    )
    db.add(svc)
    await db.flush()

    stmt_active_staff = select(StaffBranch).where(
        StaffBranch.tenant_id == crm_user.tenant_id,
        StaffBranch.active == True
    )
    staff_branches = (await db.execute(stmt_active_staff)).scalars().all()
    for sb_item in staff_branches:
        sso = StaffServiceOffer(
            tenant_id=crm_user.tenant_id,
            staff_id=sb_item.staff_id,
            branch_id=sb_item.branch_id,
            service_id=svc.id,
            active=True
        )
        db.add(sso)

    await db.commit()
    return svc


# =========================================================================
# ONLINE BOOKING SETTINGS & PUBLICATION
# =========================================================================

@router.get("/booking-settings")
@router.get("/online-booking/config")
async def get_booking_settings(
    branch_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    policy = await BookingEngine.get_booking_policy(db, crm_user.tenant_id, branch_id or uuid.uuid4())

    # Get Tenant and Slug
    stmt_t = select(Tenant).where(Tenant.id == crm_user.tenant_id)
    t_obj = (await db.execute(stmt_t)).scalar_one_or_none()
    t_slug = t_obj.slug if t_obj else "default"

    # Get Theme
    stmt_theme = select(BookingTheme).where(BookingTheme.tenant_id == crm_user.tenant_id)
    theme = (await db.execute(stmt_theme)).scalars().first()

    # Get Publication (Pure read-only: do NOT create or commit side-effects during GET)
    stmt_pub = select(BookingPublication).where(BookingPublication.tenant_id == crm_user.tenant_id)
    pub = (await db.execute(stmt_pub)).scalars().first()
    is_pub = pub.is_published if pub else False
    pub_slug = (pub.slug if pub and pub.slug else None) or t_slug

    # Calculate canonical public url for this specific tenant
    stmt_dom = select(TenantDomain).where(TenantDomain.tenant_id == crm_user.tenant_id)
    doms = (await db.execute(stmt_dom)).scalars().all()
    canonical_domain = next((d.hostname_normalized for d in doms if d.canonical and d.verification_status == "verified"), None)
    if not canonical_domain:
        canonical_domain = next((d.hostname_normalized for d in doms if d.verification_status == "verified"), None)

    from apps.api.app.core.config import settings
    if settings.ENVIRONMENT in ("development", "test"):
        canonical_public_url = f"http://{t_slug}.localhost:3000"
    else:
        if canonical_domain:
            canonical_public_url = f"https://{canonical_domain}"
        else:
            suffix = settings.BOOKING_DOMAIN_SUFFIX if settings.BOOKING_DOMAIN_SUFFIX.startswith(".") else f".{settings.BOOKING_DOMAIN_SUFFIX}"
            canonical_public_url = f"https://{t_slug}{suffix}"

    return {
        "policy": {
            "book_ahead_days": policy.book_ahead_days,
            "min_advance_minutes": policy.min_advance_minutes,
            "cancellation_cutoff_minutes": policy.cancellation_cutoff_minutes,
            "allow_self_reschedule": policy.allow_self_reschedule,
            "slot_step_minutes": policy.slot_step_minutes,
            "max_services_per_booking": policy.max_services_per_booking,
            "allow_online_booking": policy.allow_online_booking,
        },
        "theme": {
            "primary_color": theme.primary_color if theme else "#1E293B",
            "accent_color": theme.accent_color if theme else "#2563EB",
        },
        "publication": {
            "is_published": is_pub,
            "slug": pub_slug,
            "public_url": canonical_public_url,
        },
        "book_ahead_days": policy.book_ahead_days,
        "min_advance_minutes": policy.min_advance_minutes,
        "cancellation_cutoff_minutes": policy.cancellation_cutoff_minutes,
        "allow_self_reschedule": policy.allow_self_reschedule,
        "slot_step_minutes": policy.slot_step_minutes,
        "max_services_per_booking": policy.max_services_per_booking,
        "allow_online_booking": policy.allow_online_booking,
        "canonical_public_url": canonical_public_url,
        "tenant_slug": t_slug
    }


@router.patch("/booking-settings")
async def update_booking_settings(
    req: BookingPolicyUpdateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(BookingPolicy).where(BookingPolicy.tenant_id == crm_user.tenant_id)
    res = await db.execute(stmt)
    policy = res.scalars().first()
    if not policy:
        policy = BookingPolicy(tenant_id=crm_user.tenant_id)
        db.add(policy)

    if req.book_ahead_days is not None: policy.book_ahead_days = req.book_ahead_days
    if req.min_advance_minutes is not None: policy.min_advance_minutes = req.min_advance_minutes
    if req.cancellation_cutoff_minutes is not None: policy.cancellation_cutoff_minutes = req.cancellation_cutoff_minutes
    if req.allow_self_reschedule is not None: policy.allow_self_reschedule = req.allow_self_reschedule
    if req.slot_step_minutes is not None: policy.slot_step_minutes = req.slot_step_minutes
    if req.max_services_per_booking is not None: policy.max_services_per_booking = req.max_services_per_booking
    if req.allow_online_booking is not None: policy.allow_online_booking = req.allow_online_booking

    await db.commit()
    return policy


@router.patch("/booking-publication")
@router.post("/booking-publication/publish")
async def publish_online_booking(
    payload: Optional[BookingPublicationUpdateRequest] = None,
    publish: Optional[bool] = Query(default=None),
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)

    # Determine target published state from JSON body first, then query param fallback
    if payload is not None and payload.is_published is not None:
        target_state = payload.is_published
    elif publish is not None:
        target_state = publish
    else:
        target_state = True

    stmt = select(BookingPublication).where(BookingPublication.tenant_id == crm_user.tenant_id)
    res = await db.execute(stmt)
    pub = res.scalars().first()
    if pub:
        pub.is_published = target_state
        if target_state:
            pub.published_at = datetime.datetime.now(datetime.timezone.utc)
    else:
        tenant_res = await db.execute(select(Tenant).where(Tenant.id == crm_user.tenant_id))
        t_obj = tenant_res.scalar_one_or_none()
        t_slug = t_obj.slug if t_obj else "default"
        pub = BookingPublication(
            tenant_id=crm_user.tenant_id,
            slug=t_slug,
            is_published=target_state,
            published_at=datetime.datetime.now(datetime.timezone.utc) if target_state else None
        )
        db.add(pub)

    # Sync BookingPolicy.allow_online_booking
    stmt_pol = select(BookingPolicy).where(BookingPolicy.tenant_id == crm_user.tenant_id)
    res_pol = await db.execute(stmt_pol)
    pol = res_pol.scalars().first()
    if pol:
        pol.allow_online_booking = target_state

    # Compute URL before commit to preserve tenant RLS context
    tenant_res = await db.execute(select(Tenant).where(Tenant.id == crm_user.tenant_id))
    t_obj = tenant_res.scalar_one_or_none()
    t_slug = t_obj.slug if t_obj else pub.slug

    stmt_dom = select(TenantDomain).where(TenantDomain.tenant_id == crm_user.tenant_id)
    doms = (await db.execute(stmt_dom)).scalars().all()
    canonical_domain = next((d.hostname_normalized for d in doms if d.canonical and d.verification_status == "verified"), None)
    if not canonical_domain:
        canonical_domain = next((d.hostname_normalized for d in doms if d.verification_status == "verified"), None)

    from apps.api.app.core.config import settings
    if settings.ENVIRONMENT in ("development", "test"):
        canonical_public_url = f"http://{t_slug}.localhost:3000"
    else:
        if canonical_domain:
            canonical_public_url = f"https://{canonical_domain}"
        else:
            suffix = settings.BOOKING_DOMAIN_SUFFIX if settings.BOOKING_DOMAIN_SUFFIX.startswith(".") else f".{settings.BOOKING_DOMAIN_SUFFIX}"
            canonical_public_url = f"https://{t_slug}{suffix}"

    await db.commit()

    return {
        "is_published": pub.is_published,
        "slug": pub.slug,
        "public_url": canonical_public_url,
        "message": "Онлайн-запись опубликована" if pub.is_published else "Онлайн-запись приостановлена"
    }


# =========================================================================
# REPORTS & KPI
# =========================================================================

@router.get("/reports/overview")
async def get_reports_overview(
    from_date: datetime.date,
    to_date: datetime.date,
    branch_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Computes real metrics from DB:
    - Total bookings, completed, cancelled, no-show
    - Planned service value (snapshot totals)
    - Staff utilization = occupied minutes / scheduled minutes
    """
    tenant_id = crm_user.tenant_id
    from_utc = datetime.datetime.combine(from_date, datetime.time.min, tzinfo=datetime.timezone.utc)
    to_utc = datetime.datetime.combine(to_date, datetime.time.max, tzinfo=datetime.timezone.utc)
    report_branches = await _report_branches(db, crm_user, branch_id)
    try:
        money_report = await finance_reports.finance_report(db, tenant_id, from_date, to_date, report_branches)
    except FinanceError as e:
        raise _finance_error(e)

    stmt = select(Booking).where(
        Booking.tenant_id == tenant_id,
        Booking.starts_at_utc >= from_utc,
        Booking.starts_at_utc <= to_utc
    )
    if report_branches is not None:
        stmt = stmt.where(Booking.branch_id.in_(report_branches))

    res = await db.execute(stmt)
    bookings = res.scalars().all()

    total_count = len(bookings)
    completed_count = sum(1 for b in bookings if b.status == "completed")
    cancelled_count = sum(1 for b in bookings if b.status == "cancelled")
    no_show_count = sum(1 for b in bookings if b.status == "no_show")
    arrived_count = sum(1 for b in bookings if b.status in ["arrived", "in_progress"])

    # Planned revenue
    planned_revenue_minor = sum(b.amount_minor_snapshot for b in bookings if b.status != "cancelled")
    # M14: money comes from the ledger only, never from the booking status
    completed_revenue_minor = money_report["total"]["rendered_minor"]     # оказано (начислено)
    paid_revenue_minor = money_report["total"]["received_minor"]          # получено деньгами
    actual_revenue_minor = completed_revenue_minor
    rendered_by_booking = {}
    if bookings:
        rows = (await db.execute(select(Order.booking_id, func.sum(LedgerEntry.amount_minor))
                                 .join(LedgerEntry, LedgerEntry.order_id == Order.id)
                                 .where(Order.tenant_id == tenant_id, LedgerEntry.tenant_id == tenant_id,
                                        Order.booking_id.in_([b.id for b in bookings]),
                                        LedgerEntry.kind.in_(("service_rendered", "adjustment")))
                                 .group_by(Order.booking_id))).all()
        rendered_by_booking = {bid: int(v) for bid, v in rows}

    # Occupied minutes from staff_occupancies
    stmt_occ = select(StaffOccupancy).where(
        StaffOccupancy.tenant_id == tenant_id,
        StaffOccupancy.starts_at_utc >= from_utc,
        StaffOccupancy.ends_at_utc <= to_utc,
        StaffOccupancy.released_at.is_(None)
    )
    res_occ = await db.execute(stmt_occ)
    occupancies = res_occ.scalars().all()
    occupied_minutes = sum((o.ends_at_utc - o.starts_at_utc).total_seconds() / 60 for o in occupancies)

    # Staff breakdown with real booked minutes and scheduled minutes
    staff_stmt = select(StaffProfile).where(StaffProfile.tenant_id == tenant_id)
    if branch_id:
        staff_stmt = staff_stmt.join(StaffBranch, StaffBranch.staff_id == StaffProfile.id).where(StaffBranch.branch_id == branch_id)
    all_staff = (await db.execute(staff_stmt)).scalars().all()
    staff_stats = []
    for s in all_staff:
        st_bookings = [b for b in bookings if b.staff_id == s.id and b.status != "cancelled"]
        st_rev = sum(rendered_by_booking.get(b.id, 0) for b in bookings if b.staff_id == s.id)
        st_booked_mins = sum((b.service_ends_at_utc - b.starts_at_utc).total_seconds() / 60 for b in st_bookings)

        # Calculate scheduled shift minutes in the period
        stmt_sh = select(WeeklyShift).where(WeeklyShift.staff_id == s.id, WeeklyShift.tenant_id == tenant_id)
        if branch_id:
            stmt_sh = stmt_sh.where(WeeklyShift.branch_id == branch_id)
        sh_res = (await db.execute(stmt_sh)).scalars().all()

        total_sched_mins = 0
        curr_d = from_date
        while curr_d <= to_date:
            w_iso = curr_d.isoweekday()
            for sh in sh_res:
                if sh.weekday_iso == w_iso:
                    shift_len = (sh.local_end.hour * 60 + sh.local_end.minute) - (sh.local_start.hour * 60 + sh.local_start.minute)
                    total_sched_mins += max(0, shift_len)
            curr_d += datetime.timedelta(days=1)

        if total_sched_mins == 0:
            total_sched_mins = max(int(st_booked_mins), 8 * 60)

        workload_pct = min(100, int((st_booked_mins / total_sched_mins) * 100)) if total_sched_mins > 0 else 0
        staff_stats.append({
            "staff_id": str(s.id),
            "staff_name": s.display_name,
            "bookings_count": len(st_bookings),
            "booked_minutes": int(st_booked_mins),
            "revenue_minor": st_rev,
            "workload_pct": workload_pct
        })

    # New customers count in period
    cust_stmt = select(func.count(Customer.id)).where(
        Customer.tenant_id == tenant_id,
        Customer.created_at >= from_utc,
        Customer.created_at <= to_utc
    )
    new_customers_count = (await db.execute(cust_stmt)).scalar() or 0

    return {
        "period": {"from": from_date.isoformat(), "to": to_date.isoformat()},
        "period_start": from_date.isoformat(),
        "period_end": to_date.isoformat(),
        "total_bookings": total_count,
        "completed": completed_count,
        "completed_bookings": completed_count,
        "cancelled": cancelled_count,
        "cancelled_bookings": cancelled_count,
        "no_show": no_show_count,
        "arrived_bookings": arrived_count,
        "planned_revenue_minor": planned_revenue_minor,
        "planned_revenue_formatted": f"{planned_revenue_minor / 100:,.0f} ₸".replace(",", " "),
        "completed_revenue_minor": completed_revenue_minor,
        "completed_revenue_formatted": f"{completed_revenue_minor / 100:,.0f} ₸".replace(",", " "),
        "paid_revenue_minor": paid_revenue_minor,
        "paid_revenue_formatted": f"{paid_revenue_minor / 100:,.0f} ₸".replace(",", " "),
        "debt_minor": money_report["total"]["receivables_end_minor"],
        "expenses_minor": money_report["total"]["expenses_minor"],
        "actual_revenue_minor": actual_revenue_minor,
        "actual_revenue_formatted": f"{actual_revenue_minor / 100:,.0f} ₸".replace(",", " "),
        "payment_collection_enabled": True,
        "revenue_semantics_note": "Деньги — из журнала: completed_revenue_minor = оказано (начислено по завершённым визитам, за вычетом возвратов), paid_revenue_minor = получено деньгами (оплаты − возвраты), debt_minor = долг клиентов на конец периода. Авансы не выручка. Подробно: /reports/finance.",
        "new_customers_count": new_customers_count,
        "occupied_minutes": int(occupied_minutes),
        "staff_stats": staff_stats
    }


# =========================================================================
# SUPPORT ASSISTANCE CONSENT (OWNER APPROVAL)
# =========================================================================

@router.get("/access-requests/pending")
async def list_pending_support_access(
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Lists pending support access requests for tenant owner review."""
    from apps.api.app.infrastructure.db.models import SupportAccessRequest, IdentityUser
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stmt = select(SupportAccessRequest, IdentityUser).join(
        IdentityUser, IdentityUser.id == SupportAccessRequest.requester_id
    ).where(
        SupportAccessRequest.tenant_id == crm_user.tenant_id,
        SupportAccessRequest.status == "pending",
        SupportAccessRequest.expires_at > now_utc
    ).order_by(SupportAccessRequest.created_at.desc())
    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": str(req.id),
            "requester_id": str(req.requester_id),
            "requester_name": u.display_name,
            "requester_email": u.email_normalized,
            "reason": req.reason,
            "requested_scope": req.requested_scope,
            "expires_at": req.expires_at.isoformat(),
            "created_at": req.created_at.isoformat()
        }
        for req, u in rows
    ]


@router.post("/access-requests/{request_id}/approve")
async def approve_support_access(
    request_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Business Owner approves temporary limited support access (max 30 min)."""
    from apps.api.app.infrastructure.db.models import SupportAccessRequest, SupportAccessSession
    stmt = select(SupportAccessRequest).where(SupportAccessRequest.id == request_id)
    res = await db.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Access request not found")
    if req.tenant_id != crm_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access request belongs to another company")
    if req.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Access request is already {req.status}")

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    exp = req.expires_at.replace(tzinfo=datetime.timezone.utc) if req.expires_at.tzinfo is None else req.expires_at
    if exp < now_utc:
        req.status = "expired"
        await db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Access request has expired")

    req.status = "approved"
    session = SupportAccessSession(
        request_id=req.id,
        tenant_id=crm_user.tenant_id,
        staff_id=req.requester_id,
        approved_by=crm_user.user.id,
        starts_at=now_utc,
        expires_at=now_utc + datetime.timedelta(minutes=30),
        status="active"
    )
    db.add(session)

    from apps.api.app.api.v1.platform.routes import record_audit_event
    await record_audit_event(
        db=db,
        actor_id=crm_user.user.id,
        actor_email=crm_user.user.email_normalized,
        action="support.request_approved",
        object_type="support_access_session",
        target_tenant_id=crm_user.tenant_id,
        object_id=str(session.id),
        reason=f"Tenant owner approved diagnostic access: {req.reason}"
    )

    await db.commit()
    return {
        "message": "Доступ поддержки успешно одобрен на 30 минут",
        "status": "approved",
        "session_id": str(session.id),
        "expires_at": session.expires_at.isoformat()
    }


@router.post("/access-requests/{request_id}/deny")
async def deny_support_access(
    request_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Business Owner denies temporary support access request."""
    from apps.api.app.infrastructure.db.models import SupportAccessRequest
    stmt = select(SupportAccessRequest).where(SupportAccessRequest.id == request_id)
    res = await db.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Access request not found")
    if req.tenant_id != crm_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access request belongs to another company")
    if req.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Access request is already {req.status}")

    req.status = "denied"
    from apps.api.app.api.v1.platform.routes import record_audit_event
    await record_audit_event(
        db=db,
        actor_id=crm_user.user.id,
        actor_email=crm_user.user.email_normalized,
        action="support.request_denied",
        object_type="support_access_request",
        target_tenant_id=crm_user.tenant_id,
        object_id=str(req.id),
        reason=f"Owner denied support access request: {req.reason}"
    )
    await db.commit()
    return {"message": "Запрос доступа отклонён", "status": "denied"}


@router.get("/access-sessions/active")
async def get_active_support_sessions(
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Lists currently active support sessions for this tenant."""
    from apps.api.app.infrastructure.db.models import SupportAccessSession, IdentityUser
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stmt = select(SupportAccessSession, IdentityUser).join(
        IdentityUser, IdentityUser.id == SupportAccessSession.staff_id
    ).where(
        SupportAccessSession.tenant_id == crm_user.tenant_id,
        SupportAccessSession.status == "active",
        SupportAccessSession.expires_at > now_utc
    ).order_by(SupportAccessSession.starts_at.desc())
    rows = (await db.execute(stmt)).all()
    results = []
    for sess, u in rows:
        exp = sess.expires_at.replace(tzinfo=datetime.timezone.utc) if sess.expires_at.tzinfo is None else sess.expires_at
        mins_left = max(0, int((exp - now_utc).total_seconds() / 60))
        results.append({
            "id": str(sess.id),
            "staff_id": str(sess.staff_id),
            "staff_name": u.display_name or u.email_normalized,
            "staff_email": u.email_normalized,
            "starts_at": sess.starts_at.isoformat(),
            "expires_at": sess.expires_at.isoformat(),
            "minutes_left": mins_left,
            "status": "active"
        })
    return results


@router.post("/access-sessions/{session_id}/revoke")
async def revoke_support_access_session(
    session_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Business Owner revokes an active support access session immediately."""
    from apps.api.app.infrastructure.db.models import SupportAccessSession
    stmt = select(SupportAccessSession).where(SupportAccessSession.id == session_id)
    res = await db.execute(stmt)
    sess = res.scalar_one_or_none()
    if not sess:
        raise HTTPException(status_code=404, detail="Support session not found")
    if sess.tenant_id != crm_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session belongs to another company")
    if sess.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Session is already {sess.status}")

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    sess.status = "revoked"

    from apps.api.app.api.v1.platform.routes import record_audit_event
    await record_audit_event(
        db=db,
        actor_id=crm_user.user.id,
        actor_email=crm_user.user.email_normalized,
        action="support.session_revoked_by_owner",
        object_type="support_access_session",
        target_tenant_id=crm_user.tenant_id,
        object_id=str(sess.id),
        reason="Owner terminated diagnostic support access session"
    )
    await db.commit()
    return {"message": "Сеанс поддержки успешно отозван", "status": "revoked"}


# =========================================================================
# FULL CRM EXPANDED ENDPOINTS (CRM-0 .. CRM-3)
# =========================================================================

@router.get("/customers/{customer_id}")
async def get_customer_card(
    customer_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Customer).where(Customer.id == customer_id, Customer.tenant_id == crm_user.tenant_id)
    res = await db.execute(stmt)
    c = res.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")

    master_staff = None
    if crm_user.role == "master":
        stmt_sp = select(StaffProfile).where(StaffProfile.tenant_id == crm_user.tenant_id, StaffProfile.user_id == crm_user.user.id)
        master_staff = (await db.execute(stmt_sp)).scalars().first()
        if not master_staff:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Master has no staff profile in this company")
        # Check if master has any booking with this customer
        stmt_mb = select(Booking.id).where(
            Booking.tenant_id == crm_user.tenant_id,
            Booking.customer_id == customer_id,
            Booking.staff_id == master_staff.id
        )
        has_booking = (await db.execute(stmt_mb)).scalars().first()
        if not has_booking:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: Master can only view customers with whom they have bookings")

    # Visits history
    stmt_b = select(Booking).where(Booking.customer_id == c.id, Booking.tenant_id == crm_user.tenant_id).order_by(Booking.starts_at_utc.desc())
    if crm_user.role == "master" and master_staff:
        stmt_b = stmt_b.where(Booking.staff_id == master_staff.id)
    res_b = await db.execute(stmt_b)
    bookings = res_b.scalars().all()
    visits = []
    for b in bookings:
        stmt_it = select(BookingItem).where(BookingItem.booking_id == b.id).order_by(BookingItem.sequence)
        items = (await db.execute(stmt_it)).scalars().all()
        fin = await FinanceCoreService.get_visit_financial_summary(b, db)
        stmt_st = select(StaffProfile.display_name).where(StaffProfile.id == b.staff_id)
        st_name = (await db.execute(stmt_st)).scalar() or "Специалист"
        stmt_br = select(Branch.name).where(Branch.id == b.branch_id)
        br_name = (await db.execute(stmt_br)).scalar() or "Филиал"
        visits.append({
            "id": str(b.id),
            "public_ref": b.public_ref,
            "starts_at_utc": b.starts_at_utc.isoformat(),
            "status": b.status,
            "staff_id": str(b.staff_id),
            "staff_name": st_name,
            "branch_id": str(b.branch_id),
            "branch_name": br_name,
            "amount_minor": b.amount_minor_snapshot,
            "cost_minor": fin["cost_minor"],
            "rendered_minor": fin["rendered_minor"],
            "paid_minor": fin["paid_minor"],
            "debt_minor": fin["debt_minor"],
            "payment_status": fin["payment_status"],
            "finance": fin,
            "services": [it.service_name_snapshot for it in items]
        })

    # Notes
    stmt_n = select(CustomerNote).where(CustomerNote.customer_id == c.id).order_by(CustomerNote.created_at.desc())
    if crm_user.role == "master":
        stmt_n = stmt_n.where(CustomerNote.author_id == crm_user.user.id)
    notes_res = await db.execute(stmt_n)
    notes = [{"id": str(n.id), "note": n.note, "created_at": n.created_at.isoformat()} for n in notes_res.scalars().all()]

    is_m = (crm_user.role == "master")
    masked_phone = (f"{c.phone_e164[:7]}***{c.phone_e164[-2:]}" if len(c.phone_e164) >= 9 else "***") if is_m else c.phone_e164

    completed_cnt = sum(1 for b in bookings if b.status == "completed")
    cancelled_cnt = sum(1 for b in bookings if b.status == "cancelled")
    no_show_cnt = sum(1 for b in bookings if b.status == "no_show")

    return {
        "id": str(c.id),
        "full_name": c.full_name,
        "phone": masked_phone,
        "phone_e164": masked_phone,
        "email": None if is_m else c.email,
        "notes_private": None if is_m else c.notes_private,
        "completed_visits": completed_cnt,
        "total_bookings": len(bookings),
        "stats": {
            "total_bookings": len(bookings),
            "completed_visits": completed_cnt,
            "cancelled_visits": cancelled_cnt,
            "no_show_visits": no_show_cnt,
        },
        "created_at": c.created_at.isoformat(),
        "history": visits,
        "notes": notes,
        # M10: other clients of this company with the same phone (family, colleagues) — never merged automatically
        "same_phone_customers": [] if is_m else [
            {"id": str(o.id), "full_name": o.full_name}
            for o in await customer_identity.same_phone_customers(db, crm_user.tenant_id, c.phone_e164, exclude_id=c.id)
        ]
    }


@router.patch("/customers/{customer_id}")
async def update_customer(
    customer_id: uuid.UUID,
    req: CustomerUpdateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(Customer).where(Customer.id == customer_id, Customer.tenant_id == crm_user.tenant_id)
    res = await db.execute(stmt)
    c = res.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")

    if req.full_name is not None:
        c.full_name = req.full_name
    if req.email is not None:
        c.email = req.email
    if req.notes_private is not None:
        c.notes_private = req.notes_private
    if req.phone_e164 is not None:
        try:
            c.phone_e164 = customer_identity.normalize_phone(req.phone_e164)
        except customer_identity.PhoneError as e:
            raise HTTPException(status_code=422, detail={"code": "PHONE_INVALID", "message": str(e)})
        c.phone_digits_index = customer_identity.phone_digits(c.phone_e164)
    if req.full_name is not None and not req.full_name.strip():
        raise HTTPException(status_code=422, detail={"code": "NAME_REQUIRED", "message": "Имя клиента не может быть пустым"})

    await db.commit()
    return {"message": "Данные клиента обновлены", "id": str(c.id), "full_name": c.full_name}


@router.get("/staff/{staff_id}")
async def get_staff_detail(
    staff_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(StaffProfile).where(StaffProfile.id == staff_id, StaffProfile.tenant_id == crm_user.tenant_id)
    res = await db.execute(stmt)
    staff = res.scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")

    stmt_br = select(StaffBranch.branch_id).where(StaffBranch.staff_id == staff.id)
    branch_ids = [str(bid) for bid in (await db.execute(stmt_br)).scalars().all()]

    stmt_off = select(StaffServiceOffer, Service).join(
        Service, Service.id == StaffServiceOffer.service_id
    ).where(StaffServiceOffer.staff_id == staff.id)
    offers = []
    for off, svc in (await db.execute(stmt_off)).all():
        offers.append({
            "service_id": str(svc.id),
            "service_name": svc.name,
            "branch_id": str(off.branch_id),
            "price_override_minor": off.price_override_minor,
            "duration_override_minutes": off.duration_override_minutes,
            "active": off.active,
            "online_visible": off.online_visible
        })

    return {
        "id": str(staff.id),
        "display_name": staff.display_name,
        "role_title": staff.role_title,
        "color": staff.color,
        "active": staff.active,
        "online_bookable": staff.online_bookable,
        "branch_ids": branch_ids,
        "offers": offers
    }


@router.patch("/staff/{staff_id}")
async def update_staff_profile(
    staff_id: uuid.UUID,
    req: StaffUpdateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(StaffProfile).where(StaffProfile.id == staff_id, StaffProfile.tenant_id == crm_user.tenant_id)
    res = await db.execute(stmt)
    staff = res.scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")

    if req.display_name is not None: staff.display_name = req.display_name
    if req.role_title is not None: staff.role_title = req.role_title
    if req.color is not None: staff.color = req.color
    if req.online_bookable is not None: staff.online_bookable = req.online_bookable
    if req.active is not None: staff.active = req.active

    if req.branch_ids is not None:
        for b_id in req.branch_ids:
            await ownership.require_branch(db, crm_user.tenant_id, b_id)
        stmt_del = select(StaffBranch).where(StaffBranch.staff_id == staff.id)
        existing_sb = (await db.execute(stmt_del)).scalars().all()
        for sb in existing_sb:
            await db.delete(sb)
        # deletes must reach the DB before re-inserting the same (staff, branch) pairs
        await db.flush()
        for b_id in req.branch_ids:
            new_sb = StaffBranch(tenant_id=crm_user.tenant_id, staff_id=staff.id, branch_id=b_id)
            db.add(new_sb)
            # Ensure weekly shifts exist for this branch if not present
            stmt_shifts = select(WeeklyShift.id).where(
                WeeklyShift.staff_id == staff.id,
                WeeklyShift.branch_id == b_id
            )
            has_shifts = (await db.execute(stmt_shifts)).first()
            if not has_shifts:
                for weekday in range(1, 8):
                    shift = WeeklyShift(
                        tenant_id=crm_user.tenant_id,
                        staff_id=staff.id,
                        branch_id=b_id,
                        weekday_iso=weekday,
                        local_start=datetime.time(10, 0),
                        local_end=datetime.time(20, 0),
                    )
                    db.add(shift)
            # Ensure staff service offers exist for this branch if not present
            stmt_offers = select(StaffServiceOffer.id).where(
                StaffServiceOffer.staff_id == staff.id,
                StaffServiceOffer.branch_id == b_id
            )
            has_offers = (await db.execute(stmt_offers)).first()
            if not has_offers:
                stmt_existing_svcs = select(Service).where(
                    Service.tenant_id == crm_user.tenant_id,
                    Service.active == True,
                    Service.archived_at.is_(None)
                )
                existing_svcs = (await db.execute(stmt_existing_svcs)).scalars().all()
                for svc_item in existing_svcs:
                    sso = StaffServiceOffer(
                        tenant_id=crm_user.tenant_id,
                        staff_id=staff.id,
                        branch_id=b_id,
                        service_id=svc_item.id,
                        active=True,
                        online_visible=True
                    )
                    db.add(sso)

    await db.commit()
    return {"message": "Профиль сотрудника обновлен", "id": str(staff.id)}


@router.get("/staff/{staff_id}/schedule")
async def get_staff_schedule(
    staff_id: uuid.UUID,
    branch_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(WeeklyShift).where(
        WeeklyShift.staff_id == staff_id,
        WeeklyShift.tenant_id == crm_user.tenant_id
    )
    if branch_id:
        stmt = stmt.where(WeeklyShift.branch_id == branch_id)
    stmt = stmt.order_by(WeeklyShift.weekday_iso)
    shifts = (await db.execute(stmt)).scalars().all()

    results = []
    for s in shifts:
        stmt_br = select(ShiftBreak).where(ShiftBreak.shift_id == s.id)
        breaks = (await db.execute(stmt_br)).scalars().all()
        results.append({
            "branch_id": str(s.branch_id) if s.branch_id else None,
            "weekday_iso": s.weekday_iso,
            "local_start": s.local_start.strftime("%H:%M") if s.local_start else "10:00",
            "local_end": s.local_end.strftime("%H:%M") if s.local_end else "20:00",
            "is_working": True,
            "breaks": [{"local_start": b.local_start.strftime("%H:%M"), "local_end": b.local_end.strftime("%H:%M")} for b in breaks]
        })
    return results


@router.put("/staff/{staff_id}/schedule")
async def update_staff_schedule(
    staff_id: uuid.UUID,
    req: Union[StaffScheduleUpdateRequest, List[WeeklyShiftDto], Dict[str, Any]],
    branch_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    if not branch_id:
        stmt_sb = select(StaffBranch.branch_id).where(StaffBranch.staff_id == staff_id)
        branch_id = (await db.execute(stmt_sb)).scalars().first()
    if not branch_id:
        raise HTTPException(status_code=400, detail="Staff is not assigned to any branch")

    # Verify branch belongs to tenant
    stmt_b_check = select(Branch.id).where(Branch.id == branch_id, Branch.tenant_id == crm_user.tenant_id)
    if not (await db.execute(stmt_b_check)).scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Invalid branch for tenant")

    # Verify staff belongs to tenant
    stmt_s_check = select(StaffProfile.id).where(StaffProfile.id == staff_id, StaffProfile.tenant_id == crm_user.tenant_id)
    if not (await db.execute(stmt_s_check)).scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Staff not found in tenant")

    # Delete ONLY shifts for this specific branch
    stmt_old = select(WeeklyShift).where(
        WeeklyShift.staff_id == staff_id,
        WeeklyShift.tenant_id == crm_user.tenant_id,
        WeeklyShift.branch_id == branch_id
    )
    old_shifts = (await db.execute(stmt_old)).scalars().all()
    for os in old_shifts:
        stmt_b = select(ShiftBreak).where(ShiftBreak.shift_id == os.id)
        for ob in (await db.execute(stmt_b)).scalars().all():
            await db.delete(ob)
        await db.delete(os)

    shifts_list = req.shifts if isinstance(req, StaffScheduleUpdateRequest) else (req.get("shifts", []) if isinstance(req, dict) else req)

    for item in shifts_list:
        w_iso = item.weekday_iso if hasattr(item, "weekday_iso") else item.get("weekday_iso")
        is_wk = item.is_working if hasattr(item, "is_working") else item.get("is_working", True)
        l_start = item.local_start if hasattr(item, "local_start") else item.get("local_start", "10:00")
        l_end = item.local_end if hasattr(item, "local_end") else item.get("local_end", "20:00")
        raw_breaks = item.breaks if hasattr(item, "breaks") else item.get("breaks", [])

        if not (1 <= w_iso <= 7):
            raise HTTPException(status_code=422, detail="weekday_iso must be between 1 and 7")
        if not is_wk:
            continue
        st_parts = [int(p) for p in l_start.split(":")]
        end_parts = [int(p) for p in l_end.split(":")]
        start_time = datetime.time(st_parts[0], st_parts[1])
        end_time = datetime.time(end_parts[0], end_parts[1])
        if start_time >= end_time:
            raise HTTPException(status_code=422, detail="Shift start must be before end time")

        shift = WeeklyShift(
            tenant_id=crm_user.tenant_id,
            staff_id=staff_id,
            branch_id=branch_id,
            weekday_iso=w_iso,
            local_start=start_time,
            local_end=end_time,
            effective_from=datetime.datetime.now(datetime.timezone.utc)
        )
        db.add(shift)
        await db.flush()

        for b_item in (raw_breaks or []):
            b_l_start = b_item.local_start if hasattr(b_item, "local_start") else b_item.get("local_start", "14:00")
            b_l_end = b_item.local_end if hasattr(b_item, "local_end") else b_item.get("local_end", "15:00")
            b_st = [int(p) for p in b_l_start.split(":")]
            b_end = [int(p) for p in b_l_end.split(":")]
            brk_start = datetime.time(b_st[0], b_st[1])
            brk_end = datetime.time(b_end[0], b_end[1])
            if brk_start >= brk_end or brk_start < start_time or brk_end > end_time:
                raise HTTPException(status_code=422, detail="Break must be within shift hours")
            s_break = ShiftBreak(
                tenant_id=crm_user.tenant_id,
                shift_id=shift.id,
                local_start=brk_start,
                local_end=brk_end
            )
            db.add(s_break)

    await db.commit()
    return {"message": "График работы успешно обновлен"}


@router.get("/staff/{staff_id}/time-off", response_model=List[StaffTimeOffResponse])
async def list_staff_time_off(
    staff_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists scheduled time-off / vacations for a master."""
    stmt_s = select(StaffProfile.id).where(StaffProfile.id == staff_id, StaffProfile.tenant_id == crm_user.tenant_id)
    if not (await db.execute(stmt_s)).scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Staff not found")

    stmt = select(StaffTimeOff).where(
        StaffTimeOff.tenant_id == crm_user.tenant_id,
        StaffTimeOff.staff_id == staff_id
    ).order_by(StaffTimeOff.from_at_utc.asc())
    time_offs = (await db.execute(stmt)).scalars().all()
    return [
        StaffTimeOffResponse(
            id=t.id,
            staff_id=t.staff_id,
            from_at_utc=t.from_at_utc,
            to_at_utc=t.to_at_utc,
            reason=t.reason
        )
        for t in time_offs
    ]


@router.post("/staff/{staff_id}/time-off", response_model=StaffTimeOffResponse, status_code=status.HTTP_201_CREATED)
async def create_staff_time_off(
    staff_id: uuid.UUID,
    req: StaffTimeOffCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Schedules a vacation or leave period for a master."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt_s = select(StaffProfile.id).where(StaffProfile.id == staff_id, StaffProfile.tenant_id == crm_user.tenant_id)
    if not (await db.execute(stmt_s)).scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Staff not found")

    if req.from_at_utc >= req.to_at_utc:
        raise HTTPException(status_code=422, detail="Time-off start must be before end time")

    new_id = uuid.uuid4()
    time_off = StaffTimeOff(
        id=new_id,
        tenant_id=crm_user.tenant_id,
        staff_id=staff_id,
        from_at_utc=req.from_at_utc,
        to_at_utc=req.to_at_utc,
        reason=req.reason
    )
    db.add(time_off)
    await db.commit()
    return StaffTimeOffResponse(
        id=new_id,
        staff_id=staff_id,
        from_at_utc=req.from_at_utc,
        to_at_utc=req.to_at_utc,
        reason=req.reason
    )


@router.delete("/staff/{staff_id}/time-off/{time_off_id}")
async def delete_staff_time_off(
    staff_id: uuid.UUID,
    time_off_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Deletes or cancels a master's scheduled vacation/time-off."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(StaffTimeOff).where(
        StaffTimeOff.id == time_off_id,
        StaffTimeOff.staff_id == staff_id,
        StaffTimeOff.tenant_id == crm_user.tenant_id
    )
    res = await db.execute(stmt)
    time_off = res.scalar_one_or_none()
    if not time_off:
        raise HTTPException(status_code=404, detail="Time-off record not found")

    await db.delete(time_off)
    await db.commit()
    return {"message": "Отпуск / отгул успешно удален"}


@router.patch("/services/{service_id}")
async def update_service(
    service_id: uuid.UUID,
    req: ServiceUpdateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(Service).where(Service.id == service_id, Service.tenant_id == crm_user.tenant_id)
    svc = (await db.execute(stmt)).scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")

    if req.category_id is not None:
        await ownership.require_category(db, crm_user.tenant_id, req.category_id)
    if req.name is not None: svc.name = req.name.strip()
    if req.category_id is not None: svc.category_id = req.category_id
    if req.description is not None: svc.description = req.description
    if req.base_price_minor is not None: svc.base_price_minor = req.base_price_minor
    if req.base_duration_minutes is not None: svc.base_duration_minutes = req.base_duration_minutes
    if req.active is not None: svc.active = req.active
    if req.online_visible is not None: svc.online_visible = req.online_visible

    await db.commit()
    return svc


@router.delete("/services/{service_id}")
async def delete_service(
    service_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(Service).where(Service.id == service_id, Service.tenant_id == crm_user.tenant_id)
    svc = (await db.execute(stmt)).scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")

    svc.active = False
    svc.archived_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()
    return {"message": "Услуга архивирована"}


@router.patch("/service-categories/{category_id}")
async def update_service_category(
    category_id: uuid.UUID,
    req: ServiceCategoryUpdateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(ServiceCategory).where(ServiceCategory.id == category_id, ServiceCategory.tenant_id == crm_user.tenant_id)
    cat = (await db.execute(stmt)).scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    if req.name is not None: cat.name = req.name
    if req.sort_order is not None: cat.sort_order = req.sort_order

    await db.commit()
    return cat


@router.patch("/booking-theme")
async def update_booking_theme(
    req: BookingBrandingUpdateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(BookingTheme).where(BookingTheme.tenant_id == crm_user.tenant_id)
    theme = (await db.execute(stmt)).scalars().first()
    if not theme:
        theme = BookingTheme(tenant_id=crm_user.tenant_id)
        db.add(theme)

    if req.primary_color is not None: theme.primary_color = req.primary_color
    if req.accent_color is not None: theme.accent_color = req.accent_color
    if req.logo_url is not None: theme.logo_url = req.logo_url

    await db.commit()
    return {"primary_color": theme.primary_color, "accent_color": theme.accent_color}


@router.patch("/branches/{branch_id}")
async def update_branch(
    branch_id: uuid.UUID,
    req: BranchUpdateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(Branch).where(Branch.id == branch_id, Branch.tenant_id == crm_user.tenant_id)
    branch = (await db.execute(stmt)).scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    if req.name is not None: branch.name = req.name
    if req.city is not None: branch.city = req.city
    if req.address is not None: branch.address = req.address
    if req.timezone_iana is not None:
        branch.timezone_iana = ownership.require_timezone(req.timezone_iana)
    elif getattr(req, "timezone", None) is not None:
        branch.timezone_iana = ownership.require_timezone(req.timezone)
    if req.phone is not None:
        branch.phone = req.phone
    elif getattr(req, "phone_number", None) is not None:
        branch.phone = req.phone_number
    if req.weekly_hours is not None:
        branch.weekly_hours = req.weekly_hours

    await db.commit()
    return branch


@router.get("/users")
async def list_crm_users(
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    from apps.api.app.infrastructure.db.models import IdentityUser
    stmt = select(TenantMembership, IdentityUser).join(
        IdentityUser, IdentityUser.id == TenantMembership.user_id
    ).where(TenantMembership.tenant_id == crm_user.tenant_id)
    rows = (await db.execute(stmt)).all()
    grants = {}
    if rows:
        for mid, bid in (await db.execute(select(BranchRoleGrant.membership_id, BranchRoleGrant.branch_id).where(
                BranchRoleGrant.membership_id.in_([m.id for m, _ in rows])))).all():
            grants.setdefault(mid, []).append(str(bid))

    return [{
        "id": str(m.id),
        "user_id": str(u.id),
        "email": u.email_normalized,
        "display_name": u.display_name,
        "role": m.role,
        "status": m.status,
        "branch_ids": grants.get(m.id, []),   # M15: admin branches; empty = all
        "created_at": m.joined_at.isoformat() if m.joined_at else None
    } for m, u in rows]


# =========================================================================
# NOTIFICATIONS (M15): settings, templates, limits, delivery log
# =========================================================================

class NotificationSettingsUpdate(BaseModel):
    email_notifications_enabled: Optional[bool] = None
    daily_email_limit: Optional[int] = Field(default=None, ge=1)


class NotificationTemplateUpdate(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    enabled: bool = True


async def _tenant_settings(db: AsyncSession, tenant_id: uuid.UUID) -> TenantSettings:
    ts = (await db.execute(select(TenantSettings).where(TenantSettings.tenant_id == tenant_id))).scalar_one_or_none()
    if ts is None:   # companies created before settings existed: start from defaults
        name = (await db.execute(select(Tenant.display_name).where(Tenant.id == tenant_id))).scalar_one()
        await db.execute(pg_insert(TenantSettings).values(id=uuid.uuid4(), tenant_id=tenant_id, business_name=name,
                                                          locale="ru", currency="KZT").on_conflict_do_nothing())
        ts = (await db.execute(select(TenantSettings).where(TenantSettings.tenant_id == tenant_id))).scalar_one()
    return ts


async def _notification_settings_out(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    ts = await _tenant_settings(db, tenant_id)
    overrides = {t.code: t for t in (await db.execute(select(NotificationTemplate).where(
        NotificationTemplate.tenant_id == tenant_id))).scalars().all()}
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=24)
    sent = (await db.execute(select(func.count()).select_from(NotificationDelivery).where(
        NotificationDelivery.tenant_id == tenant_id, NotificationDelivery.status == "sent",
        NotificationDelivery.created_at >= since))).scalar_one()
    items = []
    for code, (subject, body) in notification_templates.DEFAULTS.items():
        o = overrides.get(code)
        items.append({"code": code, "label": notification_templates.LABELS[code],
                      "subject": o.subject if o else subject, "body": o.body if o else body,
                      "enabled": o.enabled if o else True, "customized": o is not None})
    return {"email_notifications_enabled": ts.email_notifications_enabled, "daily_email_limit": ts.daily_email_limit,
            "daily_email_limit_max": settings.PLATFORM_DAILY_EMAIL_LIMIT_MAX, "sent_last_24h": sent,
            "platform_email_enabled": settings.EMAIL_NOTIFICATIONS_ENABLED,
            "placeholders": notification_templates.PLACEHOLDERS, "templates": items}


@router.get("/notification-settings")
async def get_notification_settings(
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    out = await _notification_settings_out(db, crm_user.tenant_id)
    await db.commit()
    return out


@router.put("/notification-settings")
async def update_notification_settings(
    req: NotificationSettingsUpdate,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    ts = await _tenant_settings(db, crm_user.tenant_id)
    if req.daily_email_limit is not None:
        if req.daily_email_limit > settings.PLATFORM_DAILY_EMAIL_LIMIT_MAX:
            raise HTTPException(status_code=422, detail={"code": "EMAIL_LIMIT_TOO_HIGH",
                                                         "message": f"Не больше {settings.PLATFORM_DAILY_EMAIL_LIMIT_MAX} писем в сутки"})
        ts.daily_email_limit = req.daily_email_limit
    if req.email_notifications_enabled is not None:
        ts.email_notifications_enabled = req.email_notifications_enabled
    await db.commit()
    await set_tenant_context(db, crm_user.tenant_id)
    return await _notification_settings_out(db, crm_user.tenant_id)


@router.put("/notification-templates/{code}")
async def update_notification_template(
    code: str, req: NotificationTemplateUpdate,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    try:
        notification_templates.validate(code, req.subject, req.body)
    except notification_templates.TemplateError as e:
        raise HTTPException(status_code=404 if e.code == "TEMPLATE_NOT_FOUND" else 422,
                            detail={"code": e.code, "message": e.message})
    await db.execute(pg_insert(NotificationTemplate).values(
        id=uuid.uuid4(), tenant_id=crm_user.tenant_id, code=code, subject=req.subject.strip(), body=req.body.strip(),
        enabled=req.enabled, updated_by_user_id=crm_user.user.id).on_conflict_do_update(
        constraint="uq_notification_template_code",
        set_={"subject": req.subject.strip(), "body": req.body.strip(), "enabled": req.enabled,
              "updated_by_user_id": crm_user.user.id, "updated_at": func.now()}))
    await db.commit()
    await set_tenant_context(db, crm_user.tenant_id)
    return await _notification_settings_out(db, crm_user.tenant_id)


@router.delete("/notification-templates/{code}")
async def reset_notification_template(
    code: str,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    if code not in notification_templates.DEFAULTS:
        raise HTTPException(status_code=404, detail={"code": "TEMPLATE_NOT_FOUND", "message": "Нет такого шаблона"})
    await db.execute(NotificationTemplate.__table__.delete().where(
        NotificationTemplate.tenant_id == crm_user.tenant_id, NotificationTemplate.code == code))
    await db.commit()
    await set_tenant_context(db, crm_user.tenant_id)
    return await _notification_settings_out(db, crm_user.tenant_id)


@router.get("/notification-deliveries")
async def list_notification_deliveries(
    limit: int = Query(50, ge=1, le=200),
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    rows = (await db.execute(select(NotificationDelivery, OutboxEvent.aggregate_id)
                             .join(OutboxEvent, OutboxEvent.id == NotificationDelivery.outbox_event_id)
                             .where(NotificationDelivery.tenant_id == crm_user.tenant_id)
                             .order_by(NotificationDelivery.created_at.desc()).limit(limit))).all()
    return [{"id": str(d.id), "template": d.template_code, "status": d.status, "reason": d.reason,
             "recipient": d.recipient_masked, "booking_id": agg.split(":")[0], "attempts": d.attempts,
             "created_at": d.created_at} for d, agg in rows]


class MemberBranchesRequest(BaseModel):
    branch_ids: List[uuid.UUID]


@router.put("/users/{membership_id}/branches")
async def set_member_branches(
    membership_id: uuid.UUID, req: MemberBranchesRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Which branches an admin works in (M15). Empty list = all branches of the company."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    m = (await db.execute(select(TenantMembership).where(
        TenantMembership.id == membership_id, TenantMembership.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail={"code": "MEMBER_NOT_FOUND", "message": "Сотрудник не найден"})
    if m.role != "admin":
        raise HTTPException(status_code=422, detail={"code": "BRANCHES_FOR_ADMIN_ONLY",
                                                     "message": "Филиалы назначаются администратору: владелец видит все, мастер — свои по профилю"})
    ids = await _tenant_branch_ids(db, crm_user.tenant_id, req.branch_ids)
    await db.execute(BranchRoleGrant.__table__.delete().where(BranchRoleGrant.membership_id == m.id))
    for b in ids:
        db.add(BranchRoleGrant(membership_id=m.id, branch_id=b))
    await db.commit()
    return {"membership_id": str(m.id), "branch_ids": [str(b) for b in ids]}


class MemberStaffProfileRequest(BaseModel):
    staff_id: uuid.UUID


@router.put("/users/{membership_id}/staff-profile")
async def link_member_staff_profile(
    membership_id: uuid.UUID, req: MemberStaffProfileRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Link a master account to its staff profile (M15): the master then sees only own calendar."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    m = (await db.execute(select(TenantMembership).where(
        TenantMembership.id == membership_id, TenantMembership.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail={"code": "MEMBER_NOT_FOUND", "message": "Сотрудник не найден"})
    if m.role != "master":
        raise HTTPException(status_code=422, detail={"code": "PROFILE_FOR_MASTER_ONLY", "message": "Профиль привязывается только к мастеру"})
    sp = (await db.execute(select(StaffProfile).where(
        StaffProfile.id == req.staff_id, StaffProfile.tenant_id == crm_user.tenant_id).with_for_update())).scalar_one_or_none()
    if sp is None:
        raise HTTPException(status_code=422, detail={"code": "STAFF_PROFILE_NOT_FOUND", "message": "Профиль мастера не найден"})
    if sp.user_id is not None and sp.user_id != m.user_id:
        raise HTTPException(status_code=409, detail={"code": "STAFF_PROFILE_LINKED", "message": "У этого мастера уже есть учётная запись"})
    other = (await db.execute(select(StaffProfile).where(
        StaffProfile.tenant_id == crm_user.tenant_id, StaffProfile.user_id == m.user_id, StaffProfile.id != sp.id))).scalars().first()
    if other is not None:
        raise HTTPException(status_code=409, detail={"code": "ACCOUNT_ALREADY_LINKED", "message": "Учётная запись уже привязана к другому профилю"})
    sp.user_id = m.user_id
    await db.commit()
    return {"membership_id": str(m.id), "staff_id": str(sp.id)}


async def _tenant_branch_ids(db: AsyncSession, tenant_id: uuid.UUID, branch_ids) -> list:
    ids = list(dict.fromkeys(branch_ids or []))
    if ids:
        found = set((await db.execute(select(Branch.id).where(Branch.tenant_id == tenant_id, Branch.id.in_(ids)))).scalars().all())
        if found != set(ids):
            raise HTTPException(status_code=422, detail={"code": "BRANCH_NOT_FOUND", "message": "Филиал не найден в этой компании"})
    return ids


@router.post("/invites", status_code=status.HTTP_201_CREATED)
async def create_crm_invite(
    req: InviteCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    import secrets
    import hashlib
    # M15: the owner invites only admins and masters; a master is tied to an unlinked staff profile
    if req.role not in ("admin", "master"):
        raise HTTPException(status_code=422, detail={"code": "INVITE_ROLE_INVALID",
                                                     "message": "Пригласить можно администратора или мастера"})
    staff_id = None
    if req.role == "master" and req.staff_id is not None:
        sp = (await db.execute(select(StaffProfile).where(
            StaffProfile.id == req.staff_id, StaffProfile.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
        if sp is None:
            raise HTTPException(status_code=422, detail={"code": "STAFF_PROFILE_NOT_FOUND", "message": "Профиль мастера не найден"})
        if sp.user_id is not None:
            raise HTTPException(status_code=409, detail={"code": "STAFF_PROFILE_LINKED",
                                                         "message": "У этого мастера уже есть учётная запись"})
        staff_id = sp.id
    branch_ids = await _tenant_branch_ids(db, crm_user.tenant_id, req.branch_ids) if req.role == "admin" else []
    raw_token = secrets.token_urlsafe(32)
    tok_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    inv = Invite(
        tenant_id=crm_user.tenant_id,
        email=req.email.lower().strip(),
        role=req.role,
        invite_type="staff",
        branch_scope="selected" if branch_ids else "all",
        staff_profile_id=staff_id,
        branch_ids=[str(b) for b in branch_ids] or None,
        token_hash=tok_hash,
        expires_at=now_utc + datetime.timedelta(days=7),
    )
    db.add(inv)
    await db.commit()
    out_warning = None
    if req.role == "master" and staff_id is None:
        # legacy CRM form: the account works only after the owner links it to a staff profile
        out_warning = {"code": "STAFF_PROFILE_NOT_LINKED",
                       "message": "Мастер увидит календарь после привязки к профилю: PUT /business/users/{id}/staff-profile"}
    return {
        "warning": out_warning,
        "invite_id": str(inv.id),
        "email": inv.email,
        "role": inv.role,
        "token": raw_token,
        "invite_token": raw_token,
        "invite_url": f"/accept-invite?token={raw_token}"
    }
