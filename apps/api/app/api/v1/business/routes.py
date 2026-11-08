import uuid
import datetime
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Header, status, Query
from sqlalchemy import select, and_, or_, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.session import get_db, set_tenant_context
from apps.api.app.infrastructure.security.auth import get_crm_tenant_user, require_crm_roles, AuthenticatedTenantUser
from apps.api.app.infrastructure.db.models import (
    Tenant, Branch, Service, ServiceCategory, StaffProfile, StaffBranch,
    StaffServiceOffer, WeeklyShift, ShiftBreak, StaffTimeOff, Customer,
    CustomerNote, Booking, BookingItem, StaffOccupancy, CalendarBlock,
    BookingEvent, BookingPolicy, BookingTheme, BookingPublication,
    TenantMembership, Invite, Subscription, PlanVersion, PlanEntitlement,
    TenantEntitlementOverride
)
from apps.api.app.modules.bookings.service import BookingEngine, BookingEngineError
from apps.api.app.modules.schemas import (
    BranchResponse, CRMCreateBookingRequest, StatusUpdateRequest,
    CalendarBlockCreateRequest, CustomerCreateRequest, CustomerNoteCreateRequest,
    StaffCreateRequest, StaffServiceOfferUpdateRequest, ServiceCreateRequest,
    ServiceCategoryCreateRequest, BookingPolicyUpdateRequest, BookingBrandingUpdateRequest,
    InviteCreateRequest, RescheduleRequest, CancelRequest
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
        timezone_iana=data.get("timezone_iana", "Asia/Almaty"),
        phone=data.get("phone")
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

    # Master role access control
    if crm_user.role == "master":
        stmt_sp = select(StaffProfile).where(
            StaffProfile.tenant_id == tenant_id,
            StaffProfile.user_id == crm_user.user.id
        )
        res_sp = await db.execute(stmt_sp)
        master_profile = res_sp.scalar_one_or_none()
        if not master_profile:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Master profile not linked to user account"
            )
        effective_staff_id = master_profile.id

    day_start_utc = datetime.datetime.combine(date, datetime.time.min, tzinfo=datetime.timezone.utc)
    day_end_utc = datetime.datetime.combine(date, datetime.time.max, tzinfo=datetime.timezone.utc)

    # 1. Staff on duty
    stmt_staff = select(StaffProfile).join(
        StaffBranch, StaffBranch.staff_id == StaffProfile.id
    ).where(
        StaffProfile.tenant_id == tenant_id,
        StaffBranch.branch_id == branch_id,
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
        "staff": [
            {"id": str(s.id), "display_name": s.display_name, "role_title": s.role_title, "color": s.color}
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
    """Creates a booking manually from CRM via unified BookingEngine."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
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
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message})


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

    if crm_user.role == "master":
        stmt_sp = select(StaffProfile).where(
            StaffProfile.tenant_id == crm_user.tenant_id,
            StaffProfile.user_id == crm_user.user.id
        )
        res_sp = await db.execute(stmt_sp)
        sp = res_sp.scalar_one_or_none()
        if not sp or b.staff_id != sp.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: master cannot view appointments assigned to other staff"
            )

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
        "events": [
            {"event_type": ev.event_type, "actor_type": ev.actor_type, "created_at": ev.created_at}
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
    """
    Validates state machine transitions:
    confirmed -> arrived -> in_progress -> completed, no_show, cancelled
    """
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(Booking).where(Booking.id == booking_id, Booking.tenant_id == crm_user.tenant_id)
    res = await db.execute(stmt)
    booking = res.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    old_status = booking.status
    target_status = req.status.lower()

    if crm_user.role == "master":
        stmt_sp = select(StaffProfile).where(
            StaffProfile.tenant_id == crm_user.tenant_id,
            StaffProfile.user_id == crm_user.user.id
        )
        res_sp = await db.execute(stmt_sp)
        sp = res_sp.scalar_one_or_none()
        if not sp or booking.staff_id != sp.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: master cannot change status of appointments assigned to other staff"
            )

    VALID_TRANSITIONS = {
        "confirmed": ["arrived", "in_progress", "completed", "no_show", "cancelled"],
        "arrived": ["in_progress", "completed", "cancelled"],
        "in_progress": ["completed", "cancelled"],
        "completed": [],
        "no_show": [],
        "cancelled": []
    }

    if target_status not in VALID_TRANSITIONS.get(old_status, []):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid transition from '{old_status}' to '{target_status}'"
        )

    booking.status = target_status
    if target_status == "cancelled":
        booking.cancelled_at = datetime.datetime.now(datetime.timezone.utc)
        booking.cancellation_reason = req.reason or "Отменено сотрудником в CRM"
        # Release occupancy
        stmt_occ = select(StaffOccupancy).where(StaffOccupancy.booking_id == booking.id, StaffOccupancy.released_at.is_(None))
        res_occ = await db.execute(stmt_occ)
        for o in res_occ.scalars().all():
            o.released_at = datetime.datetime.now(datetime.timezone.utc)

    # Event
    event = BookingEvent(
        tenant_id=crm_user.tenant_id,
        booking_id=booking.id,
        event_type="status_changed",
        actor_type="staff",
        actor_id=crm_user.user.id,
        old_json_sanitized={"status": old_status},
        new_json_sanitized={"status": target_status, "reason": req.reason}
    )
    db.add(event)
    await db.commit()

    return {"status": booking.status, "message": f"Статус обновлен на '{booking.status}'"}


@router.post("/bookings/{booking_id}/reschedule")
async def crm_reschedule_booking(
    booking_id: uuid.UUID,
    req: RescheduleRequest,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    if crm_user.role == "master":
        stmt_b = select(Booking).where(Booking.id == booking_id, Booking.tenant_id == crm_user.tenant_id)
        res_b = await db.execute(stmt_b)
        b = res_b.scalar_one_or_none()
        if b:
            stmt_sp = select(StaffProfile).where(
                StaffProfile.tenant_id == crm_user.tenant_id,
                StaffProfile.user_id == crm_user.user.id
            )
            res_sp = await db.execute(stmt_sp)
            sp = res_sp.scalar_one_or_none()
            if not sp or b.staff_id != sp.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: master cannot reschedule appointments assigned to other staff"
                )
    try:
        updated = await BookingEngine.reschedule_booking(
            db=db,
            tenant_id=crm_user.tenant_id,
            booking_id=booking_id,
            new_starts_at_utc=req.new_starts_at_utc,
            new_staff_id=req.new_staff_id,
            is_client=False
        )
        return {"status": updated.status, "starts_at_utc": updated.starts_at_utc, "version": updated.version}
    except BookingEngineError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message})


@router.post("/bookings/{booking_id}/cancel")
async def crm_cancel_booking(
    booking_id: uuid.UUID,
    req: CancelRequest,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    if crm_user.role == "master":
        stmt_b = select(Booking).where(Booking.id == booking_id, Booking.tenant_id == crm_user.tenant_id)
        res_b = await db.execute(stmt_b)
        b = res_b.scalar_one_or_none()
        if b:
            stmt_sp = select(StaffProfile).where(
                StaffProfile.tenant_id == crm_user.tenant_id,
                StaffProfile.user_id == crm_user.user.id
            )
            res_sp = await db.execute(stmt_sp)
            sp = res_sp.scalar_one_or_none()
            if not sp or b.staff_id != sp.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: master cannot cancel appointments assigned to other staff"
                )
    try:
        cancelled = await BookingEngine.cancel_booking(
            db=db,
            tenant_id=crm_user.tenant_id,
            booking_id=booking_id,
            reason=req.reason or "Отменено сотрудником в CRM",
            is_client=False
        )
        return {"status": cancelled.status, "message": "Запись успешно отменена"}
    except BookingEngineError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message})


# =========================================================================
# CALENDAR BLOCKS
# =========================================================================

@router.post("/calendar-blocks", status_code=status.HTTP_201_CREATED)
async def create_calendar_block(
    req: CalendarBlockCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a calendar block and takes an exclusion occupancy."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
    if crm_user.role == "master":
        stmt_sp = select(StaffProfile).where(
            StaffProfile.tenant_id == crm_user.tenant_id,
            StaffProfile.user_id == crm_user.user.id
        )
        res_sp = await db.execute(stmt_sp)
        sp = res_sp.scalar_one_or_none()
        if not sp or req.staff_id != sp.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: master cannot create blocks for other staff"
            )
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
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Время уже занято другой записью или блокировкой")

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

    if search:
        s_term = f"%{search.strip()}%"
        stmt = stmt.where(or_(Customer.full_name.ilike(s_term), Customer.phone_e164.like(s_term)))
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
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    phone_digits = "".join(filter(str.isdigit, req.phone_e164))

    # Duplicate check within tenant
    stmt_dup = select(Customer).where(Customer.tenant_id == crm_user.tenant_id, Customer.phone_e164 == req.phone_e164)
    res_dup = await db.execute(stmt_dup)
    existing = res_dup.scalar_one_or_none()
    if existing:
        return {"id": str(existing.id), "full_name": existing.full_name, "duplicate_detected": True}

    cust = Customer(
        tenant_id=crm_user.tenant_id,
        full_name=req.full_name,
        phone_e164=req.phone_e164,
        phone_digits_index=phone_digits,
        email=req.email,
        notes_private=req.notes_private,
        data_source="crm_manual"
    )
    db.add(cust)
    await db.flush()
    await db.commit()
    return {"id": str(cust.id), "full_name": cust.full_name, "duplicate_detected": False}


@router.post("/customers/{customer_id}/notes")
async def add_customer_note(
    customer_id: uuid.UUID,
    req: CustomerNoteCreateRequest,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
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
    db.add(staff)
    await db.flush()

    for b_id in req.branch_ids:
        sb = StaffBranch(tenant_id=crm_user.tenant_id, staff_id=staff.id, branch_id=b_id)
        db.add(sb)

    await db.flush()
    await db.commit()
    return staff


@router.put("/staff/{staff_id}/services")
async def update_staff_services(
    staff_id: uuid.UUID,
    offers: List[StaffServiceOfferUpdateRequest],
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Sets master-specific price and duration overrides."""
    await check_crm_write_permitted(crm_user.tenant_id, db)
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
    svc = Service(
        tenant_id=crm_user.tenant_id,
        category_id=req.category_id,
        name=req.name,
        description=req.description,
        base_price_minor=req.base_price_minor,
        base_duration_minutes=req.base_duration_minutes,
        active=req.active,
        online_visible=req.online_visible
    )
    db.add(svc)
    await db.flush()
    await db.commit()
    return svc


# =========================================================================
# ONLINE BOOKING SETTINGS & PUBLICATION
# =========================================================================

@router.get("/booking-settings")
async def get_booking_settings(
    branch_id: Optional[uuid.UUID] = None,
    crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user),
    db: AsyncSession = Depends(get_db)
):
    policy = await BookingEngine.get_booking_policy(db, crm_user.tenant_id, branch_id or uuid.uuid4())
    return policy


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


@router.post("/booking-publication/publish")
async def publish_online_booking(
    publish: bool = True,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    await check_crm_write_permitted(crm_user.tenant_id, db)
    stmt = select(BookingPublication).where(BookingPublication.tenant_id == crm_user.tenant_id)
    res = await db.execute(stmt)
    pub = res.scalars().first()
    if pub:
        pub.is_published = publish
        if publish:
            pub.published_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()
    return {"is_published": publish, "message": "Статус публикации обновлен"}


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

    # Planned revenue
    planned_revenue_minor = sum(b.amount_minor_snapshot for b in bookings if b.status != "cancelled")

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

    return {
        "period": {"from": from_date.isoformat(), "to": to_date.isoformat()},
        "total_bookings": total_count,
        "completed": completed_count,
        "cancelled": cancelled_count,
        "no_show": no_show_count,
        "planned_revenue_minor": planned_revenue_minor,
        "planned_revenue_formatted": f"{planned_revenue_minor / 100:,.0f} ₸".replace(",", " "),
        "occupied_minutes": int(occupied_minutes)
    }


# =========================================================================
# SUPPORT ASSISTANCE CONSENT (OWNER APPROVAL)
# =========================================================================

@router.post("/access-requests/{request_id}/approve")
async def approve_support_access(
    request_id: uuid.UUID,
    crm_user: AuthenticatedTenantUser = Depends(require_crm_roles(["owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Business Owner approves temporary limited support access (max 30 min)."""
    from apps.api.app.infrastructure.db.models import SupportAccessRequest, SupportAccessSession
    stmt = select(SupportAccessRequest).where(
        SupportAccessRequest.id == request_id,
        SupportAccessRequest.tenant_id == crm_user.tenant_id,
        SupportAccessRequest.status == "pending"
    )
    res = await db.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Access request not found or not pending")

    req.status = "approved"
    now_utc = datetime.datetime.now(datetime.timezone.utc)
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
    await db.commit()
    return {"message": "Доступ поддержки успешно одобрен на 30 минут"}
