import uuid
import datetime
import zoneinfo
from typing import List, Optional, Any, Union, Dict
from fastapi import APIRouter, Depends, HTTPException, Header, status, Query
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from apps.api.app.modules.catalog import ownership
from apps.api.app.infrastructure.security import branch_scope
from apps.api.app.modules.bookings import lifecycle
from apps.api.app.modules.finance import accrual, ledger as finance_ledger
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
from apps.api.app.modules.schemas import (
    BranchResponse, CRMCreateBookingRequest, StatusUpdateRequest,
    CalendarBlockCreateRequest, CustomerCreateRequest, CustomerNoteCreateRequest,
    CustomerUpdateRequest, StaffCreateRequest, StaffUpdateRequest,
    StaffServiceOfferUpdateRequest, StaffScheduleUpdateRequest, ServiceCreateRequest,
    ServiceUpdateRequest, ServiceCategoryCreateRequest, ServiceCategoryUpdateRequest,
    BranchUpdateRequest, BookingPolicyUpdateRequest, BookingBrandingUpdateRequest,
    InviteCreateRequest, RescheduleRequest, CancelRequest, BookingPublicationUpdateRequest
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
            created_by_user_id=crm_user.user.id
        )
        return {
            "booking_id": str(booking.id),
            "public_ref": booking.public_ref,
            "status": booking.status,
            "starts_at_utc": booking.starts_at_utc,
            "total_amount_minor": booking.amount_minor_snapshot
        }
    except BookingEngineError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, "details": e.details})


async def _visit_finance(db: AsyncSession, crm_user: AuthenticatedTenantUser, booking: Booking) -> Optional[dict]:
    if crm_user.role == "master":
        return None  # masters do not see money (M15)
    order = await accrual.booking_order(db, booking)
    if order is None:
        return {"order_id": None, "currency": booking.currency, "sold_minor": booking.amount_minor_snapshot,
                "rendered_minor": 0, "received_minor": 0, "advance_applied_minor": 0, "debt_minor": 0}
    p = await finance_ledger.order_position(db, crm_user.tenant_id, order.id)
    return {"order_id": str(order.id), "order_status": order.status, "currency": p.currency, "sold_minor": p.sold_minor,
            "rendered_minor": p.rendered_minor, "received_minor": p.received_minor,
            "advance_applied_minor": p.advance_applied_minor, "debt_minor": p.debt_minor}


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

    return {
        "id": str(b.id),
        "public_ref": b.public_ref,
        "status": b.status,
        "starts_at_utc": b.starts_at_utc,
        "service_ends_at_utc": b.service_ends_at_utc,
        "staff_id": str(b.staff_id),
        "staff_name": staff.display_name,
        "customer": {
            "id": str(c.id),
            "name": c.full_name,
            "phone": c.phone_e164,
            "notes": c.notes_private
        },
        "amount_minor": b.amount_minor_snapshot,
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
            {"event_type": ev.event_type, "actor_type": ev.actor_type, "actor_id": str(ev.actor_id) if ev.actor_id else None,
             "created_at": ev.created_at, "old": ev.old_json_sanitized, "new": ev.new_json_sanitized}
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
    try:
        booking = await lifecycle.lock_booking(db, crm_user.tenant_id, booking_id)
        await branch_scope.require_booking_access(db, crm_user, booking.branch_id, booking.staff_id)
        old_status = booking.status
        await lifecycle.change_status(db, booking, req.status, actor_type="staff", actor_id=crm_user.user.id,
                                      reason=req.reason or ("Отменено сотрудником в CRM" if req.status == "cancelled" else None))
    except lifecycle.LifecycleError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, "details": e.details})
    await db.commit()
    return {"status": booking.status, "previous_status": old_status, "version": booking.version,
            "message": f"Статус обновлен на '{booking.status}'"}


@router.post("/bookings/{booking_id}/reschedule")
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
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns company clients with visit stats. Strict tenant isolation!"""
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
        conds = [Customer.full_name.ilike(name_term, escape="\\")]
        digits = customer_identity.search_digits(search)
        if digits:
            conds.append(Customer.phone_digits_index.like(f"%{digits}%"))
        stmt = stmt.where(or_(*conds))
    stmt = stmt.order_by(Customer.created_at.desc())
    res = await db.execute(stmt)
    customers = res.scalars().all()

    results = []
    for c in customers:
        # Total visits count
        stmt_cnt = select(func.count(Booking.id)).where(Booking.customer_id == c.id, Booking.status == "completed")
        res_cnt = await db.execute(stmt_cnt)
        visit_cnt = res_cnt.scalar() or 0

        # Mask phone for master role
        phone_display = (c.phone_e164[:5] + "***" + c.phone_e164[-4:]) if (crm_user.role == "master" and len(c.phone_e164) >= 9) else c.phone_e164
        email_display = "***" if (crm_user.role == "master" and c.email) else c.email

        results.append({
            "id": str(c.id),
            "full_name": c.full_name,
            "phone": phone_display,
            "email": email_display,
            "notes": c.notes_private if crm_user.role != "master" else None,
            "completed_visits": visit_cnt,
            "created_at": c.created_at
        })
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
    await db.commit()
    c = resolved.customer
    return {"id": str(c.id), "full_name": c.full_name, "phone_e164": c.phone_e164,
            "duplicate_detected": not resolved.created,
            "same_phone_customers": [{"id": str(o.id), "full_name": o.full_name} for o in resolved.same_phone_others]}


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
    return {"message": "Заметка добавлена"}


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

    stmt = select(Booking).where(
        Booking.tenant_id == tenant_id,
        Booking.starts_at_utc >= from_utc,
        Booking.starts_at_utc <= to_utc
    )
    if branch_id:
        stmt = stmt.where(Booking.branch_id == branch_id)

    res = await db.execute(stmt)
    bookings = res.scalars().all()

    total_count = len(bookings)
    completed_count = sum(1 for b in bookings if b.status == "completed")
    cancelled_count = sum(1 for b in bookings if b.status == "cancelled")
    no_show_count = sum(1 for b in bookings if b.status == "no_show")
    arrived_count = sum(1 for b in bookings if b.status in ["arrived", "in_progress"])

    # Planned revenue
    planned_revenue_minor = sum(b.amount_minor_snapshot for b in bookings if b.status != "cancelled")
    # Completed visits value (service delivered, not confirmed payment)
    completed_revenue_minor = sum(b.amount_minor_snapshot for b in bookings if b.status == "completed")
    # Confirmed cash/ledger payments
    paid_revenue_minor = 0
    actual_revenue_minor = completed_revenue_minor

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
        st_rev = sum(b.amount_minor_snapshot for b in bookings if b.staff_id == s.id and b.status == "completed")
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
        "paid_revenue_formatted": "0 ₸",
        "actual_revenue_minor": actual_revenue_minor,
        "actual_revenue_formatted": f"{actual_revenue_minor / 100:,.0f} ₸".replace(",", " "),
        "payment_collection_enabled": False,
        "revenue_semantics_note": "completed_revenue_minor отражает стоимость фактически оказанных услуг (завершенные визиты), а не подтвержденные кассовые поступления. Денежный эквайринг/ledger отключен.",
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
        visits.append({
            "id": str(b.id),
            "public_ref": b.public_ref,
            "starts_at_utc": b.starts_at_utc.isoformat(),
            "status": b.status,
            "amount_minor": b.amount_minor_snapshot,
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

    return {
        "id": str(c.id),
        "full_name": c.full_name,
        "phone": masked_phone,
        "phone_e164": masked_phone,
        "email": None if is_m else c.email,
        "notes_private": None if is_m else c.notes_private,
        "completed_visits": sum(1 for b in bookings if b.status == "completed"),
        "total_bookings": len(bookings),
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
    req: StaffScheduleUpdateRequest,
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

    for item in req.shifts:
        if not (1 <= item.weekday_iso <= 7):
            raise HTTPException(status_code=422, detail="weekday_iso must be between 1 and 7")
        if not item.is_working:
            continue
        st_parts = [int(p) for p in item.local_start.split(":")]
        end_parts = [int(p) for p in item.local_end.split(":")]
        start_time = datetime.time(st_parts[0], st_parts[1])
        end_time = datetime.time(end_parts[0], end_parts[1])
        if start_time >= end_time:
            raise HTTPException(status_code=422, detail="Shift start must be before end time")

        shift = WeeklyShift(
            tenant_id=crm_user.tenant_id,
            staff_id=staff_id,
            branch_id=branch_id,
            weekday_iso=item.weekday_iso,
            local_start=start_time,
            local_end=end_time,
            effective_from=datetime.datetime.now(datetime.timezone.utc)
        )
        db.add(shift)
        await db.flush()

        for b_item in (item.breaks or []):
            b_st = [int(p) for p in b_item.local_start.split(":")]
            b_end = [int(p) for p in b_item.local_end.split(":")]
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

    return [{
        "id": str(m.id),
        "user_id": str(u.id),
        "email": u.email_normalized,
        "display_name": u.display_name,
        "role": m.role,
        "status": m.status,
        "created_at": m.joined_at.isoformat() if m.joined_at else None
    } for m, u in rows]


@router.post("/invites", status_code=status.HTTP_201_CREATED)
async def create_crm_invite(
    req: InviteCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    import secrets
    import hashlib
    raw_token = secrets.token_urlsafe(32)
    tok_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    inv = Invite(
        tenant_id=crm_user.tenant_id,
        email=req.email.lower().strip(),
        role=req.role,
        invite_type="staff",
        branch_scope="all",
        token_hash=tok_hash,
        expires_at=now_utc + datetime.timedelta(days=7),
    )
    db.add(inv)
    await db.commit()
    return {
        "invite_id": str(inv.id),
        "email": inv.email,
        "role": inv.role,
        "token": raw_token,
        "invite_token": raw_token,
        "invite_url": f"/accept-invite?token={raw_token}"
    }
