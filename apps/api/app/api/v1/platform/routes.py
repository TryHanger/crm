import uuid
import datetime
import secrets
import hashlib
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Header, status, Query
from sqlalchemy import select, and_, or_, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.core.config import settings
from apps.api.app.infrastructure.db.session import get_db
from apps.api.app.infrastructure.security.jwt import get_password_hash
from apps.api.app.infrastructure.security.auth import (
    get_current_platform_staff, require_platform_roles, AuthenticatedPlatformStaff
)
from apps.api.app.infrastructure.db.models import (
    Tenant, TenantDomain, IdentityUser, TenantMembership, Invite, Plan, PlanVersion,
    PlanEntitlement, Subscription, SubscriptionCharge, PaymentRecord, SubscriptionDecision,
    PlatformAuditEvent, PlatformAlert, TenantEntitlementOverride, FeatureCatalog,
    PlatformSupportTicket, SupportMessage, SupportAccessRequest, SupportAccessSession,
    Branch, StaffProfile, Booking
)
from apps.api.app.modules.schemas import (
    PlatformTenantCreateRequest, SuspendTenantRequest, ReactivateTenantRequest,
    IssueChargeRequest, RecordPaymentRequest, FeatureOverrideRequest,
    SupportAccessRequestCreate, SupportTicketCreateRequest, SupportMessageCreateRequest
)

router = APIRouter(prefix="/platform", tags=["Platform Console"])

async def record_audit_event(
    db: AsyncSession,
    actor_id: uuid.UUID,
    actor_email: str,
    action: str,
    object_type: str,
    target_tenant_id: Optional[uuid.UUID] = None,
    object_id: Optional[str] = None,
    before: Optional[Any] = None,
    after: Optional[Any] = None,
    reason: Optional[str] = None
):
    ev = PlatformAuditEvent(
        actor_id=actor_id,
        actor_email=actor_email,
        action=action,
        target_tenant_id=target_tenant_id,
        object_type=object_type,
        object_id=object_id,
        before_sanitized=before,
        after_sanitized=after,
        reason=reason
    )
    db.add(ev)
    await db.flush()


@router.get("/overview")
async def platform_overview(
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns platform-wide non-PII operational aggregates."""
    # Total tenants
    stmt_t = select(func.count(Tenant.id))
    res_t = await db.execute(stmt_t)
    total_tenants = res_t.scalar() or 0

    # Active subscriptions
    stmt_sub = select(func.count(Subscription.id)).where(Subscription.lifecycle_status.in_(["trial", "active", "grace"]))
    res_sub = await db.execute(stmt_sub)
    active_subs = res_sub.scalar() or 0

    # Suspended tenants
    stmt_susp = select(func.count(Tenant.id)).where(Tenant.lifecycle_status == "suspended")
    res_susp = await db.execute(stmt_susp)
    suspended_tenants = res_susp.scalar() or 0

    # Total recorded revenue
    stmt_rev = select(func.sum(PaymentRecord.amount_minor))
    res_rev = await db.execute(stmt_rev)
    total_revenue_minor = res_rev.scalar() or 0

    # Active alerts
    stmt_alert = select(PlatformAlert).where(PlatformAlert.resolved == False).order_by(PlatformAlert.created_at.desc())
    res_alert = await db.execute(stmt_alert)
    alerts = res_alert.scalars().all()

    return {
        "total_tenants": total_tenants,
        "active_subscriptions": active_subs,
        "suspended_tenants": suspended_tenants,
        "total_revenue_minor": total_revenue_minor,
        "total_revenue_formatted": f"{total_revenue_minor / 100:,.0f} ₸".replace(",", " "),
        "alerts_count": len(alerts),
        "recent_alerts": [
            {"type": a.alert_type, "severity": a.severity, "message": a.message, "created_at": a.created_at}
            for a in alerts[:5]
        ]
    }


# =========================================================================
# TENANTS REGISTRY & LIFECYCLE
# =========================================================================

@router.get("/tenants")
async def list_tenants(
    query: Optional[str] = None,
    status_filter: Optional[str] = None,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Lists companies with non-PII subscription metadata."""
    stmt = select(Tenant).order_by(Tenant.created_at.desc())
    if query:
        term = f"%{query.strip()}%"
        stmt = stmt.where(or_(Tenant.display_name.ilike(term), Tenant.slug.ilike(term)))
    if status_filter:
        stmt = stmt.where(Tenant.lifecycle_status == status_filter)

    res = await db.execute(stmt)
    tenants = res.scalars().all()

    results = []
    for t in tenants:
        # Fetch current subscription
        stmt_sub = select(Subscription, PlanVersion, Plan).join(
            PlanVersion, PlanVersion.id == Subscription.plan_version_id
        ).join(
            Plan, Plan.id == PlanVersion.plan_id
        ).where(Subscription.tenant_id == t.id).order_by(Subscription.created_at.desc())
        res_sub = await db.execute(stmt_sub)
        sub_row = res_sub.first()

        results.append({
            "id": str(t.id),
            "slug": t.slug,
            "display_name": t.display_name,
            "lifecycle_status": t.lifecycle_status,
            "vertical": t.vertical,
            "created_at": t.created_at,
            "subscription": {
                "status": sub_row[0].lifecycle_status,
                "plan_name": sub_row[2].name,
                "period_end": sub_row[0].period_end,
                "trial_ends_at": sub_row[0].trial_ends_at
            } if sub_row else None
        })
    return results


@router.post("/tenants", status_code=status.HTTP_201_CREATED)
async def create_tenant(
    req: PlatformTenantCreateRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "support"])),
    db: AsyncSession = Depends(get_db)
):
    """Creates a new company workspace, default Start plan, and invites the owner."""
    # Check slug uniqueness
    stmt_slug = select(Tenant).where(Tenant.slug == req.slug.lower().strip())
    res_slug = await db.execute(stmt_slug)
    if res_slug.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Company slug '{req.slug}' is already registered")

    # Create tenant
    tenant = Tenant(
        slug=req.slug.lower().strip(),
        display_name=req.display_name,
        vertical=req.vertical,
        lifecycle_status="active",
        timezone_default="Asia/Almaty"
    )
    db.add(tenant)
    await db.flush()

    # Subdomain
    domain = TenantDomain(
        tenant_id=tenant.id,
        hostname_normalized=f"{tenant.slug}.book.example.kz",
        domain_type="system_subdomain",
        verification_status="verified",
        canonical=True,
        verified_at=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(domain)

    # Owner user
    stmt_u = select(IdentityUser).where(IdentityUser.email_normalized == req.owner_email.lower().strip())
    res_u = await db.execute(stmt_u)
    owner_user = res_u.scalar_one_or_none()
    if not owner_user:
        owner_user = IdentityUser(
            oidc_subject=f"oidc_{uuid.uuid4()}",
            email_normalized=req.owner_email.lower().strip(),
            display_name=req.owner_name,
            password_hash=None
        )
        db.add(owner_user)
        await db.flush()

    # Membership in "invited" status until invite acceptance
    membership = TenantMembership(
        tenant_id=tenant.id,
        user_id=owner_user.id,
        role="owner",
        status="invited"
    )
    db.add(membership)
    await db.flush()
    tenant.owner_membership_id = membership.id

    # Create one-time secure Owner Invite record
    raw_invite_token = secrets.token_urlsafe(32)
    tok_hash = hashlib.sha256(raw_invite_token.encode()).hexdigest()
    invite = Invite(
        tenant_id=tenant.id,
        email=req.owner_email.lower().strip(),
        invite_type="owner_invite",
        role="owner",
        token_hash=tok_hash,
        expires_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=48),
        sent_at=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(invite)

    # Assign default plan (Start trial 14 days)
    stmt_p = select(PlanVersion).join(Plan, Plan.id == PlanVersion.plan_id).where(Plan.code == req.plan_code).order_by(PlanVersion.version.desc())
    res_p = await db.execute(stmt_p)
    pv = res_p.scalars().first()
    if not pv:
        # Fallback to any active plan version
        res_any = await db.execute(select(PlanVersion).where(PlanVersion.is_active == True))
        pv = res_any.scalars().first()

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    sub = Subscription(
        tenant_id=tenant.id,
        plan_version_id=pv.id,
        lifecycle_status="trial",
        period_start=now_utc,
        period_end=now_utc + datetime.timedelta(days=14),
        trial_ends_at=now_utc + datetime.timedelta(days=14),
        grace_ends_at=now_utc + datetime.timedelta(days=21),
        renewal_mode="manual"
    )
    db.add(sub)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="tenant.created",
        object_type="tenant",
        target_tenant_id=tenant.id,
        object_id=str(tenant.id),
        after={"slug": tenant.slug, "display_name": tenant.display_name}
    )

    await db.commit()
    is_test = settings.ENVIRONMENT == "test"
    return {
        "tenant_id": str(tenant.id),
        "slug": tenant.slug,
        "display_name": tenant.display_name,
        "owner_status": "invited",
        "invite_token": raw_invite_token if is_test else None,
        "invite_url": f"https://{settings.CRM_DOMAIN}/accept-invite?token={raw_invite_token}" if is_test else None
    }


@router.get("/tenants/{tenant_id}")
async def get_tenant_details(
    tenant_id: uuid.UUID,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Tenant).where(Tenant.id == tenant_id)
    res = await db.execute(stmt)
    tenant = res.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Subscription
    stmt_sub = select(Subscription, PlanVersion, Plan).join(
        PlanVersion, PlanVersion.id == Subscription.plan_version_id
    ).join(
        Plan, Plan.id == PlanVersion.plan_id
    ).where(Subscription.tenant_id == tenant.id).order_by(Subscription.created_at.desc())
    res_sub = await db.execute(stmt_sub)
    sub_row = res_sub.first()

    # Domains
    stmt_dom = select(TenantDomain).where(TenantDomain.tenant_id == tenant.id)
    res_dom = await db.execute(stmt_dom)
    domains = res_dom.scalars().all()

    # Usage aggregates (strictly non-PII!)
    stmt_bcnt = select(func.count(Branch.id)).where(Branch.tenant_id == tenant.id)
    res_bcnt = await db.execute(stmt_bcnt)
    branch_count = res_bcnt.scalar() or 0

    stmt_scnt = select(func.count(StaffProfile.id)).where(StaffProfile.tenant_id == tenant.id)
    res_scnt = await db.execute(stmt_scnt)
    staff_count = res_scnt.scalar() or 0

    stmt_bookcnt = select(func.count(Booking.id)).where(Booking.tenant_id == tenant.id)
    res_bookcnt = await db.execute(stmt_bookcnt)
    booking_count = res_bookcnt.scalar() or 0

    return {
        "id": str(tenant.id),
        "slug": tenant.slug,
        "display_name": tenant.display_name,
        "lifecycle_status": tenant.lifecycle_status,
        "suspended_at": tenant.suspended_at,
        "suspension_reason": tenant.suspension_reason,
        "created_at": tenant.created_at,
        "domains": [{"hostname": d.hostname_normalized, "status": d.verification_status} for d in domains],
        "subscription": {
            "id": str(sub_row[0].id),
            "status": sub_row[0].lifecycle_status,
            "plan_code": sub_row[2].code,
            "plan_name": sub_row[2].name,
            "period_end": sub_row[0].period_end,
            "trial_ends_at": sub_row[0].trial_ends_at,
            "grace_ends_at": sub_row[0].grace_ends_at
        } if sub_row else None,
        "usage_aggregates": {
            "branches_count": branch_count,
            "staff_count": staff_count,
            "total_bookings_count": booking_count
        }
    }


@router.post("/tenants/{tenant_id}/suspend")
async def suspend_tenant(
    tenant_id: uuid.UUID,
    req: SuspendTenantRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Manual suspension of tenant:
    - Blocks new public bookings
    - Puts CRM in read-only mode
    - Preserves historical appointments and customer data
    - Audited with actor and explicit reason
    """
    stmt = select(Tenant).where(Tenant.id == tenant_id)
    res = await db.execute(stmt)
    tenant = res.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    old_status = tenant.lifecycle_status
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    tenant.lifecycle_status = "suspended"
    tenant.suspended_at = now_utc
    tenant.suspension_reason = req.reason

    # Update subscription
    stmt_sub = select(Subscription).where(Subscription.tenant_id == tenant.id).order_by(Subscription.created_at.desc())
    res_sub = await db.execute(stmt_sub)
    sub = res_sub.scalars().first()
    old_sub_status = sub.lifecycle_status if sub else "unknown"
    if sub:
        sub.lifecycle_status = "suspended"
        sub.suspended_at = now_utc

    # Decision record
    decision = SubscriptionDecision(
        tenant_id=tenant.id,
        decision_type="suspend",
        reason=req.reason,
        actor_id=staff.user.id,
        old_state=old_status,
        new_state="suspended"
    )
    db.add(decision)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="tenant.suspended",
        object_type="tenant",
        target_tenant_id=tenant.id,
        object_id=str(tenant.id),
        before={"lifecycle_status": old_status, "sub_status": old_sub_status},
        after={"lifecycle_status": "suspended"},
        reason=req.reason
    )

    await db.commit()
    return {"status": "suspended", "message": "Компания успешно приостановлена"}


@router.post("/tenants/{tenant_id}/reactivate")
async def reactivate_tenant(
    tenant_id: uuid.UUID,
    req: ReactivateTenantRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Reactivates a suspended company workspace."""
    stmt = select(Tenant).where(Tenant.id == tenant_id)
    res = await db.execute(stmt)
    tenant = res.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    old_status = tenant.lifecycle_status
    tenant.lifecycle_status = "active"
    tenant.suspended_at = None
    tenant.suspension_reason = None

    # Update subscription
    stmt_sub = select(Subscription).where(Subscription.tenant_id == tenant.id).order_by(Subscription.created_at.desc())
    res_sub = await db.execute(stmt_sub)
    sub = res_sub.scalars().first()
    if sub:
        sub.lifecycle_status = "active"
        sub.suspended_at = None

    decision = SubscriptionDecision(
        tenant_id=tenant.id,
        decision_type="reactivate",
        reason=req.reason,
        actor_id=staff.user.id,
        old_state=old_status,
        new_state="active"
    )
    db.add(decision)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="tenant.reactivated",
        object_type="tenant",
        target_tenant_id=tenant.id,
        object_id=str(tenant.id),
        before={"lifecycle_status": old_status},
        after={"lifecycle_status": "active"},
        reason=req.reason
    )

    await db.commit()
    return {"status": "active", "message": "Доступ компании успешно восстановлен"}


# =========================================================================
# MANUAL BILLING LEDGER
# =========================================================================

@router.post("/subscriptions/{subscription_id}/charges", status_code=status.HTTP_201_CREATED)
async def issue_charge(
    subscription_id: uuid.UUID,
    req: IssueChargeRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "finance"])),
    db: AsyncSession = Depends(get_db)
):
    """Issues a manual billing charge for a subscription period."""
    stmt = select(Subscription).where(Subscription.id == subscription_id)
    res = await db.execute(stmt)
    sub = res.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    charge = SubscriptionCharge(
        tenant_id=sub.tenant_id,
        subscription_id=sub.id,
        period_start=req.period_start,
        period_end=req.period_end,
        amount_minor=req.amount_minor,
        currency=req.currency,
        charge_status="issued",
        evidence_reference=req.evidence_reference,
        created_by=staff.user.id
    )
    db.add(charge)
    await db.flush()
    await db.commit()
    return {"charge_id": str(charge.id), "amount_minor": charge.amount_minor, "status": charge.charge_status}


@router.post("/charges/{charge_id}/record-payment", status_code=status.HTTP_201_CREATED)
async def record_payment(
    charge_id: uuid.UUID,
    req: RecordPaymentRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "finance"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Records a confirmed manual payment (bank transfer receipt) with Idempotency protection.
    Updates charge status to 'paid'.
    """
    stmt = select(SubscriptionCharge).where(SubscriptionCharge.id == charge_id)
    res = await db.execute(stmt)
    charge = res.scalar_one_or_none()
    if not charge:
        raise HTTPException(status_code=404, detail="Charge not found")

    if req.amount_minor <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero")

    if idempotency_key:
        stmt_idem = select(PaymentRecord).where(PaymentRecord.idempotency_key == idempotency_key)
        res_idem = await db.execute(stmt_idem)
        existing_pmt = res_idem.scalar_one_or_none()
        if existing_pmt:
            return {"payment_id": str(existing_pmt.id), "status": charge.charge_status, "replay": True}

    # Sum previous payments for this charge
    stmt_prev = select(func.coalesce(func.sum(PaymentRecord.amount_minor), 0)).where(PaymentRecord.charge_id == charge.id)
    prev_total = (await db.execute(stmt_prev)).scalar() or 0
    new_total = prev_total + req.amount_minor

    if new_total >= charge.amount_minor:
        charge.charge_status = "paid"
    else:
        charge.charge_status = "partially_paid"

    pmt = PaymentRecord(
        charge_id=charge.id,
        tenant_id=charge.tenant_id,
        amount_minor=req.amount_minor,
        currency=charge.currency,
        recorded_by=staff.user.id,
        payment_method=req.payment_method,
        evidence_reference=req.evidence_reference,
        note=req.note,
        idempotency_key=idempotency_key
    )
    db.add(pmt)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="payment.recorded",
        object_type="payment_record",
        target_tenant_id=charge.tenant_id,
        object_id=str(charge.id),
        after={"amount_minor": req.amount_minor, "evidence": req.evidence_reference}
    )

    await db.commit()
    return {"payment_id": str(pmt.id), "status": charge.charge_status, "amount_minor": pmt.amount_minor}


# =========================================================================
# AUDIT LOGS
# =========================================================================

@router.get("/audit")
async def get_audit_logs(
    target_tenant_id: Optional[uuid.UUID] = None,
    action: Optional[str] = None,
    limit: int = 50,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "finance"])),
    db: AsyncSession = Depends(get_db)
):
    """Returns append-only platform audit trail."""
    stmt = select(PlatformAuditEvent).order_by(PlatformAuditEvent.occurred_at.desc()).limit(limit)
    if target_tenant_id:
        stmt = stmt.where(PlatformAuditEvent.target_tenant_id == target_tenant_id)
    if action:
        stmt = stmt.where(PlatformAuditEvent.action == action)

    res = await db.execute(stmt)
    events = res.scalars().all()
    return [
        {
            "id": str(e.id),
            "actor_id": str(e.actor_id) if e.actor_id else None,
            "actor_email": e.actor_email,
            "action": e.action,
            "target_tenant_id": str(e.target_tenant_id) if e.target_tenant_id else None,
            "object_type": e.object_type,
            "object_id": e.object_id,
            "reason": e.reason,
            "before": e.before_sanitized,
            "after": e.after_sanitized,
            "occurred_at": e.occurred_at
        }
        for e in events
    ]


# =========================================================================
# SUPPORT LIMITED ACCESS REQUEST FLOW
# =========================================================================

@router.post("/access-requests", status_code=status.HTTP_201_CREATED)
async def create_access_request(
    req: SupportAccessRequestCreate,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "support"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Platform support requests temporary limited access to a tenant's workspace.
    Requires explicit approval by tenant Owner before access is granted!
    """
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    access_req = SupportAccessRequest(
        tenant_id=req.tenant_id,
        requester_id=staff.user.id,
        reason=req.reason,
        requested_scope=req.requested_scope,
        status="pending",
        expires_at=now_utc + datetime.timedelta(hours=24)
    )
    db.add(access_req)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="support.access_requested",
        object_type="support_access_request",
        target_tenant_id=req.tenant_id,
        reason=req.reason
    )

    await db.commit()
    return {"request_id": str(access_req.id), "status": "pending", "message": "Запрос отправлен владельцу компании"}


# =========================================================================
# PLAN CATALOG MANAGEMENT
# =========================================================================

from pydantic import BaseModel, Field

class CreatePlanRequest(BaseModel):
    code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=2, max_length=128)
    description: Optional[str] = None
    price_minor: int = Field(ge=0)
    currency: str = "KZT"
    max_branches: int = Field(default=1, ge=1)
    max_active_staff: int = Field(default=5, ge=1)

@router.get("/plans")
async def get_plans(
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns platform plan catalog with active versions and entitlements."""
    stmt = select(Plan).order_by(Plan.created_at)
    res = await db.execute(stmt)
    plans = res.scalars().all()
    results = []
    for p in plans:
        stmt_v = select(PlanVersion).where(PlanVersion.plan_id == p.id, PlanVersion.is_active == True).order_by(PlanVersion.version.desc())
        res_v = await db.execute(stmt_v)
        v = res_v.scalars().first()
        entitlements = {}
        if v:
            stmt_e = select(PlanEntitlement).where(PlanEntitlement.plan_version_id == v.id)
            res_e = await db.execute(stmt_e)
            for pe in res_e.scalars().all():
                entitlements[pe.feature_key] = {"enabled": pe.enabled, "limit": pe.limit_value}
        results.append({
            "id": str(p.id),
            "code": p.code,
            "name": p.name,
            "description": p.description,
            "active_version": {
                "id": str(v.id),
                "version": v.version,
                "price_minor": v.price_minor,
                "currency": v.currency,
                "entitlements": entitlements
            } if v else None
        })
    return results

@router.post("/plans", status_code=status.HTTP_201_CREATED)
async def create_plan(
    req: CreatePlanRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Creates a new tariff plan with baseline version and entitlements."""
    stmt_check = select(Plan).where(Plan.code == req.code.strip().lower())
    res_c = await db.execute(stmt_check)
    if res_c.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Plan code already exists")

    plan = Plan(
        code=req.code.strip().lower(),
        name=req.name,
        description=req.description
    )
    db.add(plan)
    await db.flush()

    pv = PlanVersion(
        plan_id=plan.id,
        version=1,
        price_minor=req.price_minor,
        currency=req.currency,
        is_active=True
    )
    db.add(pv)
    await db.flush()

    pe_list = [
        PlanEntitlement(plan_version_id=pv.id, feature_key="max_branches", limit_value=req.max_branches, enabled=True),
        PlanEntitlement(plan_version_id=pv.id, feature_key="max_active_staff", limit_value=req.max_active_staff, enabled=True),
        PlanEntitlement(plan_version_id=pv.id, feature_key="online_booking", limit_value=None, enabled=True),
        PlanEntitlement(plan_version_id=pv.id, feature_key="basic_reports", limit_value=None, enabled=True),
    ]
    db.add_all(pe_list)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="plan.created",
        object_type="plan",
        target_tenant_id=None,
        object_id=str(plan.id),
        after={"code": plan.code, "name": plan.name, "price_minor": pv.price_minor}
    )

    await db.commit()
    return {"plan_id": str(plan.id), "code": plan.code, "name": plan.name}
