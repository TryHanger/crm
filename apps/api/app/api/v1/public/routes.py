import uuid
import hashlib
import datetime
import zoneinfo
from typing import List, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy import select, and_, text
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.session import get_db, set_tenant_context
from apps.api.app.infrastructure.domain_resolution.resolver import resolve_public_tenant, ResolvedPublicTenant
from apps.api.app.infrastructure.db.models import (
    Tenant, Branch, Service, ServiceCategory, StaffProfile, StaffBranch,
    StaffServiceOffer, BookingTheme, BookingPolicy, Booking, BookingItem,
    PublicManagementToken
)
from apps.api.app.modules.bookings.service import BookingEngine, BookingEngineError
from apps.api.app.modules.schemas import (
    PublicSiteResponse, BranchResponse, ServiceItemResponse, StaffPublicResponse,
    AvailabilitySearchRequest, AvailabilitySearchResponse, CreatePublicBookingRequest,
    BookingCreatedResponse, PublicManageBookingResponse, RescheduleRequest, CancelRequest
)

router = APIRouter(prefix="/public", tags=["Public Client Booking"])

@router.get("/site", response_model=PublicSiteResponse)
async def get_public_site(
    pub_ctx: ResolvedPublicTenant = Depends(resolve_public_tenant),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns public branding, metadata, and dynamic policies (e.g. cancellation cutoff)
    for the verified tenant subdomain.
    """
    tenant = pub_ctx.tenant

    # Booking theme
    stmt_theme = select(BookingTheme).where(BookingTheme.tenant_id == tenant.id)
    res_theme = await db.execute(stmt_theme)
    theme = res_theme.scalar_one_or_none()

    # Policy
    policy = await BookingEngine.get_booking_policy(db, tenant.id, pub_ctx.publication.branch_id or uuid.uuid4())

    return PublicSiteResponse(
        tenant_id=tenant.id,
        slug=tenant.slug,
        display_name=tenant.display_name,
        business_name=tenant.display_name,
        timezone=tenant.timezone_default,
        primary_color=theme.primary_color if theme else "#1E293B",
        accent_color=theme.accent_color if theme else "#D97706",
        logo_url=theme.logo_url if theme else None,
        cancellation_cutoff_minutes=policy.cancellation_cutoff_minutes,
        book_ahead_days=policy.book_ahead_days,
        min_advance_minutes=policy.min_advance_minutes,
        max_services_per_booking=policy.max_services_per_booking,
        is_published=pub_ctx.publication.is_published
    )


@router.get("/branches", response_model=List[BranchResponse])
async def get_public_branches(
    pub_ctx: ResolvedPublicTenant = Depends(resolve_public_tenant),
    db: AsyncSession = Depends(get_db)
):
    """Returns active branches of the company."""
    stmt = select(Branch).where(
        Branch.tenant_id == pub_ctx.tenant.id,
        Branch.status == "active"
    )
    res = await db.execute(stmt)
    branches = res.scalars().all()
    return [
        BranchResponse(
            id=b.id,
            name=b.name,
            city=b.city,
            address=b.address,
            timezone_iana=b.timezone_iana,
            phone=b.phone,
            weekly_hours=b.weekly_hours
        )
        for b in branches
    ]


@router.get("/services", response_model=List[ServiceItemResponse])
async def get_public_services(
    branch_id: Optional[uuid.UUID] = None,
    pub_ctx: ResolvedPublicTenant = Depends(resolve_public_tenant),
    db: AsyncSession = Depends(get_db)
):
    """Returns services published for online booking."""
    stmt = select(Service, ServiceCategory).outerjoin(
        ServiceCategory, ServiceCategory.id == Service.category_id
    ).where(
        Service.tenant_id == pub_ctx.tenant.id,
        Service.active == True,
        Service.online_visible == True,
        Service.archived_at.is_(None)
    ).order_by(Service.sort_order, Service.name)

    res = await db.execute(stmt)
    items = []
    for s, cat in res.all():
        price_tenge = s.base_price_minor / 100
        items.append(ServiceItemResponse(
            id=s.id,
            category_id=cat.id if cat else None,
            category_name=cat.name if cat else "Общие услуги",
            name=s.name,
            description=s.description,
            base_price_minor=s.base_price_minor,
            price_formatted=f"{price_tenge:,.0f} ₸".replace(",", " "),
            currency=s.currency,
            base_duration_minutes=s.base_duration_minutes
        ))
    return items


@router.get("/staff", response_model=List[StaffPublicResponse])
async def get_public_staff(
    branch_id: uuid.UUID,
    service_ids: Optional[str] = None,  # comma-separated UUIDs
    pub_ctx: ResolvedPublicTenant = Depends(resolve_public_tenant),
    db: AsyncSession = Depends(get_db)
):
    """Returns staff members available in this branch who can perform the selected services."""
    parsed_s_ids = []
    if service_ids:
        try:
            parsed_s_ids = [uuid.UUID(s.strip()) for s in service_ids.split(",") if s.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid service_ids format")

    stmt = select(StaffProfile).join(
        StaffBranch, StaffBranch.staff_id == StaffProfile.id
    ).where(
        StaffProfile.tenant_id == pub_ctx.tenant.id,
        StaffBranch.branch_id == branch_id,
        StaffProfile.active == True,
        StaffProfile.online_bookable == True,
        StaffBranch.active == True
    )
    res = await db.execute(stmt)
    staff_list = res.scalars().all()

    # Filter by ability to perform all services
    valid_staff = []
    for sp in staff_list:
        if parsed_s_ids:
            try:
                await BookingEngine.calculate_quote_for_staff(db, pub_ctx.tenant.id, branch_id, sp.id, parsed_s_ids)
                valid_staff.append(sp)
            except BookingEngineError:
                continue
        else:
            valid_staff.append(sp)

    return [
        StaffPublicResponse(
            id=s.id,
            display_name=s.display_name,
            role_title=s.role_title,
            color=s.color
        )
        for s in valid_staff
    ]


@router.get("/staff/{staff_id}/services", response_model=List[ServiceItemResponse])
async def get_staff_services(
    staff_id: uuid.UUID,
    branch_id: Optional[uuid.UUID] = None,
    pub_ctx: ResolvedPublicTenant = Depends(resolve_public_tenant),
    db: AsyncSession = Depends(get_db)
):
    """Deep-link scenario: returns services offered by a specific master with their price/duration overrides."""
    stmt = select(Service, StaffServiceOffer, ServiceCategory).join(
        StaffServiceOffer, StaffServiceOffer.service_id == Service.id
    ).outerjoin(
        ServiceCategory, ServiceCategory.id == Service.category_id
    ).where(
        Service.tenant_id == pub_ctx.tenant.id,
        StaffServiceOffer.staff_id == staff_id,
        StaffServiceOffer.active == True,
        StaffServiceOffer.online_visible == True,
        Service.active == True
    )
    if branch_id:
        stmt = stmt.where(StaffServiceOffer.branch_id == branch_id)

    res = await db.execute(stmt)
    results = []
    for s, offer, cat in res.all():
        effective_price = offer.price_override_minor if offer.price_override_minor is not None else s.base_price_minor
        effective_duration = offer.duration_override_minutes if offer.duration_override_minutes is not None else s.base_duration_minutes
        price_tenge = effective_price / 100

        results.append(ServiceItemResponse(
            id=s.id,
            category_id=cat.id if cat else None,
            category_name=cat.name if cat else "Услуги мастера",
            name=s.name,
            description=s.description,
            base_price_minor=effective_price,
            price_formatted=f"{price_tenge:,.0f} ₸".replace(",", " "),
            currency=s.currency,
            base_duration_minutes=effective_duration
        ))
    return results


@router.post("/availability/search", response_model=AvailabilitySearchResponse)
@router.post("/availability", response_model=AvailabilitySearchResponse)
async def search_availability(
    req: AvailabilitySearchRequest,
    pub_ctx: ResolvedPublicTenant = Depends(resolve_public_tenant),
    db: AsyncSession = Depends(get_db)
):
    """
    Deterministic slot search:
    - Service-first, Master-first, Time-first
    - 'any master' mode ranks: 1) earliest start time, 2) lowest quote price, 3) stable UUID
    - Boundaries are calculated in the branch's local timezone
    """
    if not req.service_ids or len(req.service_ids) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "EMPTY_SERVICES", "message": "At least one service must be selected to search availability"}
        )

    stmt_b = select(Branch).where(Branch.id == req.branch_id, Branch.tenant_id == pub_ctx.tenant.id)
    res_b = await db.execute(stmt_b)
    branch = res_b.scalar_one_or_none()
    try:
        tz = zoneinfo.ZoneInfo(branch.timezone_iana or "Asia/Almaty") if branch else zoneinfo.ZoneInfo("Asia/Almaty")
    except Exception:
        tz = zoneinfo.ZoneInfo("Asia/Almaty")

    from_local = datetime.datetime.combine(req.from_date, datetime.time.min, tzinfo=tz)
    to_local = datetime.datetime.combine(req.to_date, datetime.time.max, tzinfo=tz)
    from_utc = from_local.astimezone(datetime.timezone.utc)
    to_utc = to_local.astimezone(datetime.timezone.utc)

    try:
        data = await BookingEngine.search_availability(
            db=db,
            tenant_id=pub_ctx.tenant.id,
            branch_id=req.branch_id,
            service_ids=req.service_ids,
            from_utc=from_utc,
            to_utc=to_utc,
            staff_id=req.staff_id,
            staff_mode=req.staff_mode,
            is_public=True
        )
        return data
    except BookingEngineError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, "details": e.details})


@router.post("/bookings", response_model=BookingCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_public_booking(
    req: CreatePublicBookingRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    pub_ctx: ResolvedPublicTenant = Depends(resolve_public_tenant),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates an online appointment atomically:
    - Exclusion constraint on staff_occupancies prevents double booking.
    - Status immediately confirmed.
    - Returns public reference and opaque management token.
    """
    try:
        booking, mgmt_token, raw_token = await BookingEngine.create_booking(
            db=db,
            tenant_id=pub_ctx.tenant.id,
            branch_id=req.branch_id,
            staff_id=req.staff_id,
            service_ids=req.service_ids,
            starts_at_utc=req.starts_at_utc,
            customer_name=req.customer_name,
            customer_phone_e164=req.customer_phone,
            customer_email=req.customer_email,
            notes=req.notes,
            source="public",
            idempotency_key=idempotency_key,
            quote_id=req.quote_id,
            expected_price_minor=req.expected_price_minor
        )

        mgmt_url = f"https://{pub_ctx.domain.hostname_normalized}/manage/{raw_token}"

        return BookingCreatedResponse(
            booking_id=booking.id,
            public_ref=booking.public_ref,
            status=booking.status,
            starts_at_utc=booking.starts_at_utc,
            service_ends_at_utc=booking.service_ends_at_utc,
            total_amount_minor=booking.amount_minor_snapshot,
            currency=booking.currency,
            management_token=raw_token,
            management_url=mgmt_url
        )
    except BookingEngineError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, "details": e.details})


async def _resolve_management_token(token: str, db: AsyncSession) -> Tuple[PublicManagementToken, Booking]:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    stmt_func = text("SELECT tenant_id, booking_id FROM lookup_public_management_token(:th)")
    res_f = await db.execute(stmt_func, {"th": token_hash})
    row = res_f.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Management link is invalid or expired")

    tenant_id, booking_id = row[0], row[1]
    await set_tenant_context(db, tenant_id)

    # Fetch booking and token within tenant context
    stmt_booking = (
        select(Booking)
        .options(selectinload(Booking.customer))
        .where(Booking.id == booking_id, Booking.tenant_id == tenant_id)
    )
    res_b = await db.execute(stmt_booking)
    booking = res_b.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    stmt_tok = select(PublicManagementToken).where(
        PublicManagementToken.token_hash == token_hash,
        PublicManagementToken.tenant_id == tenant_id
    )
    res_t = await db.execute(stmt_tok)
    mgmt_tok = res_t.scalar_one_or_none()

    return mgmt_tok, booking


@router.get("/manage/{token}", response_model=PublicManageBookingResponse)
@router.get("/bookings/manage/{token}", response_model=PublicManageBookingResponse, include_in_schema=False)
async def get_manage_booking(
    token: str,
    db: AsyncSession = Depends(get_db)
):
    """Returns booking details using cryptographic self-service token with masked PII."""
    mgmt_tok, booking = await _resolve_management_token(token, db)

    # Fetch booking items
    stmt_items = select(BookingItem).where(BookingItem.booking_id == booking.id).order_by(BookingItem.sequence)
    res_items = await db.execute(stmt_items)
    items = res_items.scalars().all()

    # Mask phone (e.g. +7 777 *** 56 78)
    raw_phone = booking.customer.phone_e164 if booking.customer else ""
    masked_phone = raw_phone[:5] + "***" + raw_phone[-4:] if len(raw_phone) >= 9 else raw_phone

    policy = await BookingEngine.get_booking_policy(db, booking.tenant_id, booking.branch_id)
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    cutoff = datetime.timedelta(minutes=policy.cancellation_cutoff_minutes)
    can_cancel = (booking.status == "confirmed") and (booking.starts_at_utc - now_utc >= cutoff)
    can_reschedule = (booking.status == "confirmed") and policy.allow_self_reschedule

    return PublicManageBookingResponse(
        booking_id=booking.id,
        public_ref=booking.public_ref,
        status=booking.status,
        starts_at_utc=booking.starts_at_utc,
        service_ends_at_utc=booking.service_ends_at_utc,
        total_amount_minor=booking.amount_minor_snapshot,
        currency=booking.currency,
        customer_name=booking.customer.full_name if booking.customer else "Клиент",
        customer_phone_masked=masked_phone,
        cancellation_cutoff_minutes=policy.cancellation_cutoff_minutes,
        can_cancel=can_cancel,
        can_reschedule=can_reschedule,
        items=[
            {
                "service_name": it.service_name_snapshot,
                "duration_minutes": it.duration_minutes_snapshot,
                "price_minor": it.price_minor_snapshot
            }
            for it in items
        ]
    )


@router.post("/manage/{token}/cancel")
@router.post("/bookings/manage/{token}/cancel", include_in_schema=False)
async def public_cancel_booking(
    token: str,
    req: CancelRequest,
    db: AsyncSession = Depends(get_db)
):
    """Allows client to cancel appointment within the allowed cutoff window."""
    mgmt_tok, booking = await _resolve_management_token(token, db)
    try:
        updated = await BookingEngine.cancel_booking(
            db=db,
            tenant_id=booking.tenant_id,
            booking_id=booking.id,
            reason=req.reason or "Клиент отменил через онлайн-ссылку",
            is_client=True
        )
        return {"status": updated.status, "message": "Запись успешно отменена"}
    except BookingEngineError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, "details": e.details})


@router.post("/manage/{token}/reschedule")
@router.post("/bookings/manage/{token}/reschedule", include_in_schema=False)
async def public_reschedule_booking(
    token: str,
    req: RescheduleRequest,
    db: AsyncSession = Depends(get_db)
):
    """Allows client to reschedule appointment to a new slot."""
    mgmt_tok, booking = await _resolve_management_token(token, db)
    try:
        updated = await BookingEngine.reschedule_booking(
            db=db,
            tenant_id=booking.tenant_id,
            booking_id=booking.id,
            new_starts_at_utc=req.new_starts_at_utc,
            new_staff_id=req.new_staff_id,
            is_client=True
        )
        return {
            "status": updated.status,
            "version": updated.version,
            "starts_at_utc": updated.starts_at_utc,
            "message": "Запись успешно перенесена"
        }
    except BookingEngineError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, "details": e.details})
