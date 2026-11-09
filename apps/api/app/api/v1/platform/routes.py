import uuid
import datetime
import secrets
import hashlib
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Header, status, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.core.config import settings
from apps.api.app.infrastructure.db.session import get_db
from apps.api.app.infrastructure.security.jwt import get_password_hash, verify_password
from apps.api.app.infrastructure.security.auth import (
    get_current_platform_staff, require_platform_roles, AuthenticatedPlatformStaff
)
from apps.api.app.infrastructure.db.models import (
    Tenant, TenantDomain, IdentityUser, TenantMembership, Invite, Plan, PlanVersion,
    PlanEntitlement, Subscription, SubscriptionCharge, PaymentRecord, SubscriptionDecision,
    PlatformAuditEvent, PlatformAlert, TenantEntitlementOverride, FeatureCatalog,
    PlatformSupportTicket, SupportMessage, SupportAccessRequest, SupportAccessSession,
    PlatformStaff, PlatformSetting, Branch, StaffProfile, Booking, Service
)
from apps.api.app.modules.schemas import (
    PlatformTenantCreateRequest, SuspendTenantRequest, ReactivateTenantRequest,
    IssueChargeRequest, RecordPaymentRequest, FeatureOverrideRequest,
    SupportAccessRequestCreate, SupportTicketCreateRequest, SupportMessageCreateRequest,
    PlanVersionCreateRequest, RenewSubscriptionRequest, ChangePlanRequest,
    FeatureOverrideCreateRequest, PlatformStaffCreateRequest, PlatformStaffActivateRequest, PlatformSettingUpdateRequest
)

router = APIRouter(prefix="/platform", tags=["Platform Console"])

async def record_audit_event(
    db: AsyncSession,
    actor_id: Optional[uuid.UUID],
    actor_email: Optional[str],
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


# =========================================================================
# MODULE 1: OVERVIEW & DASHBOARD
# =========================================================================

@router.get("/overview")
async def platform_overview(
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns platform-wide operational aggregates, urgent attention items, and recent tenants."""
    now_utc = datetime.datetime.now(datetime.timezone.utc)

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

    # Attention items: urgent today + upcoming days
    stmt_subs_all = select(Subscription, Tenant, PlanVersion, Plan).join(
        Tenant, Tenant.id == Subscription.tenant_id
    ).join(
        PlanVersion, PlanVersion.id == Subscription.plan_version_id
    ).join(
        Plan, Plan.id == PlanVersion.plan_id
    ).order_by(Subscription.period_end.asc())
    res_subs_all = await db.execute(stmt_subs_all)
    all_subs_rows = res_subs_all.all()

    urgent_today = []
    upcoming_days = []

    for sub_obj, ten_obj, pv_obj, p_obj in all_subs_rows:
        p_end = sub_obj.period_end.replace(tzinfo=datetime.timezone.utc) if sub_obj.period_end.tzinfo is None else sub_obj.period_end
        g_end = sub_obj.grace_ends_at.replace(tzinfo=datetime.timezone.utc) if sub_obj.grace_ends_at and sub_obj.grace_ends_at.tzinfo is None else sub_obj.grace_ends_at

        item = {
            "tenant_id": str(ten_obj.id),
            "tenant_name": ten_obj.display_name,
            "tenant_slug": ten_obj.slug,
            "subscription_id": str(sub_obj.id),
            "plan_name": p_obj.name,
            "status": sub_obj.lifecycle_status,
            "period_end": sub_obj.period_end,
            "grace_ends_at": sub_obj.grace_ends_at,
        }

        # Urgent today: in grace period, or pending suspension, or period ended in past
        if sub_obj.lifecycle_status in ["grace", "pending_suspension", "expired_pending_action"] or (g_end and g_end <= now_utc):
            item["issue"] = "Льготный период истёк или ожидается приостановка" if sub_obj.lifecycle_status == "pending_suspension" else "В льготном периоде — требуется оплата"
            urgent_today.append(item)
        elif p_end <= now_utc + datetime.timedelta(days=7):
            days_left = max(0, (p_end - now_utc).days)
            item["issue"] = f"Подписка истекает через {days_left} дн."
            upcoming_days.append(item)

    # Recent tenants (last 5)
    stmt_rec = select(Tenant).order_by(Tenant.created_at.desc()).limit(5)
    res_rec = await db.execute(stmt_rec)
    rec_tenants = res_rec.scalars().all()
    recent_tenants_list = []
    for rt in rec_tenants:
        # Get subscription for rt
        stmt_s = select(Subscription, PlanVersion, Plan).join(
            PlanVersion, PlanVersion.id == Subscription.plan_version_id
        ).join(
            Plan, Plan.id == PlanVersion.plan_id
        ).where(Subscription.tenant_id == rt.id).order_by(Subscription.created_at.desc())
        s_row = (await db.execute(stmt_s)).first()
        recent_tenants_list.append({
            "id": str(rt.id),
            "slug": rt.slug,
            "display_name": rt.display_name,
            "vertical": rt.vertical,
            "lifecycle_status": rt.lifecycle_status,
            "created_at": rt.created_at,
            "plan_name": s_row[2].name if s_row else "—",
            "subscription_status": s_row[0].lifecycle_status if s_row else "—"
        })

    return {
        "total_tenants": total_tenants,
        "active_subscriptions": active_subs,
        "suspended_tenants": suspended_tenants,
        "total_revenue_minor": total_revenue_minor,
        "total_revenue_formatted": f"{total_revenue_minor / 100:,.0f} ₸".replace(",", " "),
        "non_mrr_disclaimer": "Сумма подтверждённых ручных оплат без рекуррентного автосписания",
        "alerts_count": len(alerts),
        "recent_alerts": [
            {"type": a.alert_type, "severity": a.severity, "message": a.message, "created_at": a.created_at}
            for a in alerts[:5]
        ],
        "attention_items": {
            "urgent_today": urgent_today[:10],
            "upcoming_days": upcoming_days[:10]
        },
        "recent_tenants": recent_tenants_list
    }


# =========================================================================
# MODULE 2: COMPANIES REGISTRY & LIFECYCLE
# =========================================================================

@router.get("/tenants")
async def list_tenants(
    query: Optional[str] = None,
    status_filter: Optional[str] = None,
    niche: Optional[str] = None,
    plan_code: Optional[str] = None,
    payment_status: Optional[str] = None,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Lists companies with non-PII subscription metadata and multi-field filters."""
    stmt = select(Tenant).order_by(Tenant.created_at.desc())
    if query:
        term = f"%{query.strip()}%"
        stmt = stmt.where(or_(Tenant.display_name.ilike(term), Tenant.slug.ilike(term)))
    if status_filter:
        stmt = stmt.where(Tenant.lifecycle_status == status_filter)
    if niche:
        stmt = stmt.where(Tenant.vertical == niche)

    res = await db.execute(stmt)
    tenants = res.scalars().all()

    results = []
    for t in tenants:
        stmt_sub = select(Subscription, PlanVersion, Plan).join(
            PlanVersion, PlanVersion.id == Subscription.plan_version_id
        ).join(
            Plan, Plan.id == PlanVersion.plan_id
        ).where(Subscription.tenant_id == t.id).order_by(Subscription.created_at.desc())
        res_sub = await db.execute(stmt_sub)
        sub_row = res_sub.first()

        # Check plan filter
        if plan_code and (not sub_row or sub_row[2].code != plan_code):
            continue

        # Check payment status filter
        stmt_last_charge = select(SubscriptionCharge).where(
            SubscriptionCharge.tenant_id == t.id
        ).order_by(SubscriptionCharge.created_at.desc())
        last_charge = (await db.execute(stmt_last_charge)).scalars().first()
        is_paid = last_charge and last_charge.charge_status == "paid"
        if payment_status == "paid" and not is_paid:
            continue
        if payment_status == "unpaid" and is_paid:
            continue

        results.append({
            "id": str(t.id),
            "slug": t.slug,
            "display_name": t.display_name,
            "lifecycle_status": t.lifecycle_status,
            "vertical": t.vertical,
            "created_at": t.created_at,
            "subscription": {
                "id": str(sub_row[0].id),
                "status": sub_row[0].lifecycle_status,
                "plan_code": sub_row[2].code,
                "plan_name": sub_row[2].name,
                "price_minor": sub_row[1].price_minor,
                "period_end": sub_row[0].period_end,
                "trial_ends_at": sub_row[0].trial_ends_at,
                "grace_ends_at": sub_row[0].grace_ends_at
            } if sub_row else None,
            "payment_status": "paid" if is_paid else "pending"
        })
    return results


@router.post("/tenants", status_code=status.HTTP_201_CREATED)
async def create_tenant(
    req: PlatformTenantCreateRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "support"])),
    db: AsyncSession = Depends(get_db)
):
    """Creates a new company workspace, default Start plan, and invites the owner."""
    stmt_slug = select(Tenant).where(Tenant.slug == req.slug.lower().strip())
    res_slug = await db.execute(stmt_slug)
    if res_slug.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Company slug '{req.slug}' is already registered")

    tenant = Tenant(
        slug=req.slug.lower().strip(),
        display_name=req.display_name,
        vertical=req.vertical,
        lifecycle_status="active",
        timezone_default="Asia/Almaty"
    )
    db.add(tenant)
    await db.flush()

    domain = TenantDomain(
        tenant_id=tenant.id,
        hostname_normalized=f"{tenant.slug}.book.example.kz",
        domain_type="system_subdomain",
        verification_status="verified",
        canonical=True,
        verified_at=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(domain)

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

    membership = TenantMembership(
        tenant_id=tenant.id,
        user_id=owner_user.id,
        role="owner",
        status="invited"
    )
    db.add(membership)
    await db.flush()
    tenant.owner_membership_id = membership.id

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

    stmt_p = select(PlanVersion).join(Plan, Plan.id == PlanVersion.plan_id).where(Plan.code == req.plan_code).order_by(PlanVersion.version.desc())
    res_p = await db.execute(stmt_p)
    pv = res_p.scalars().first()
    if not pv:
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
    is_test = settings.ENVIRONMENT in ["test", "development"]
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

    stmt_sub = select(Subscription, PlanVersion, Plan).join(
        PlanVersion, PlanVersion.id == Subscription.plan_version_id
    ).join(
        Plan, Plan.id == PlanVersion.plan_id
    ).where(Subscription.tenant_id == tenant.id).order_by(Subscription.created_at.desc())
    res_sub = await db.execute(stmt_sub)
    sub_row = res_sub.first()

    stmt_dom = select(TenantDomain).where(TenantDomain.tenant_id == tenant.id)
    res_dom = await db.execute(stmt_dom)
    domains = res_dom.scalars().all()

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
        "vertical": tenant.vertical,
        "suspended_at": tenant.suspended_at,
        "suspension_reason": tenant.suspension_reason,
        "created_at": tenant.created_at,
        "domains": [{"hostname": d.hostname_normalized, "domain_type": d.domain_type, "status": d.verification_status, "canonical": d.canonical} for d in domains],
        "subscription": {
            "id": str(sub_row[0].id),
            "status": sub_row[0].lifecycle_status,
            "plan_code": sub_row[2].code,
            "plan_name": sub_row[2].name,
            "price_minor": sub_row[1].price_minor,
            "currency": sub_row[1].currency,
            "period_start": sub_row[0].period_start,
            "period_end": sub_row[0].period_end,
            "trial_ends_at": sub_row[0].trial_ends_at,
            "grace_ends_at": sub_row[0].grace_ends_at,
            "renewal_mode": sub_row[0].renewal_mode
        } if sub_row else None,
        "usage_aggregates": {
            "branches_count": branch_count,
            "staff_count": staff_count,
            "total_bookings_count": booking_count
        }
    }


@router.get("/tenants/{tenant_id}/users")
async def get_tenant_users(
    tenant_id: uuid.UUID,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns company members and active pending invites for the 'Доступы' tab."""
    stmt_m = select(TenantMembership, IdentityUser).join(
        IdentityUser, IdentityUser.id == TenantMembership.user_id
    ).where(TenantMembership.tenant_id == tenant_id).order_by(TenantMembership.joined_at.desc())
    res_m = await db.execute(stmt_m)
    members_data = []
    for m, u in res_m.all():
        joined_str = m.joined_at.isoformat() if m.joined_at else None
        members_data.append({
            "membership_id": str(m.id),
            "user_id": str(u.id),
            "email": u.email_normalized,
            "display_name": u.display_name or u.email_normalized,
            "role": m.role,
            "status": m.status,
            "joined_at": joined_str,
            "created_at": joined_str
        })

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stmt_inv = select(Invite).where(
        Invite.tenant_id == tenant_id,
        Invite.consumed_at.is_(None),
        Invite.expires_at > now_utc
    ).order_by(Invite.sent_at.desc())
    res_inv = await db.execute(stmt_inv)
    invites_data = []
    for inv in res_inv.scalars().all():
        invites_data.append({
            "id": str(inv.id),
            "email": inv.email,
            "role": inv.role,
            "invite_type": inv.invite_type,
            "status": "pending",
            "sent_at": inv.sent_at.isoformat() if inv.sent_at else None,
            "expires_at": inv.expires_at.isoformat() if inv.expires_at else None
        })

    return {
        "members": members_data,
        "invites": invites_data
    }


@router.post("/tenants/{tenant_id}/resend-invite")
async def resend_tenant_invite(
    tenant_id: uuid.UUID,
    req: dict,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "support"])),
    db: AsyncSession = Depends(get_db)
):
    """Generates a refreshed invitation link for owner/staff without changing credentials."""
    email = req.get("email")
    if not email:
        raise HTTPException(status_code=422, detail="Email is required")

    email_clean = email.lower().strip()
    raw_invite_token = secrets.token_urlsafe(32)
    tok_hash = hashlib.sha256(raw_invite_token.encode()).hexdigest()
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    # Check existing invite
    stmt = select(Invite).where(Invite.tenant_id == tenant_id, Invite.email == email_clean)
    res = await db.execute(stmt)
    inv = res.scalars().first()
    if inv:
        inv.token_hash = tok_hash
        inv.expires_at = now_utc + datetime.timedelta(hours=48)
        inv.sent_at = now_utc
    else:
        inv = Invite(
            tenant_id=tenant_id,
            email=email_clean,
            invite_type="owner_invite",
            role="owner",
            token_hash=tok_hash,
            expires_at=now_utc + datetime.timedelta(hours=48),
            sent_at=now_utc
        )
        db.add(inv)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="tenant.invite_resent",
        object_type="invite",
        target_tenant_id=tenant_id,
        object_id=str(inv.id),
        after={"email": email_clean}
    )

    await db.commit()
    invite_url = f"https://{settings.CRM_DOMAIN}/accept-invite?token={raw_invite_token}"
    return {
        "status": "sent",
        "email": email_clean,
        "invite_token": raw_invite_token,
        "invite_url": invite_url,
        "message": f"Приглашение для {email_clean} успешно обновлено"
    }


@router.get("/tenants/{tenant_id}/entitlements")
async def get_tenant_entitlements(
    tenant_id: uuid.UUID,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns effective entitlements (plan base + tenant-specific overrides) for 'Модули и лимиты'."""
    # Find current subscription plan version
    stmt_sub = select(Subscription).where(Subscription.tenant_id == tenant_id).order_by(Subscription.created_at.desc())
    res_sub = await db.execute(stmt_sub)
    sub = res_sub.scalars().first()

    base_entitlements = {}
    if sub:
        stmt_pe = select(PlanEntitlement).where(PlanEntitlement.plan_version_id == sub.plan_version_id)
        res_pe = await db.execute(stmt_pe)
        for pe in res_pe.scalars().all():
            base_entitlements[pe.feature_key] = {
                "limit_value": pe.limit_value,
                "enabled": pe.enabled,
                "source": "plan"
            }

    # Fetch active overrides
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stmt_ov = select(TenantEntitlementOverride).where(
        TenantEntitlementOverride.tenant_id == tenant_id,
        TenantEntitlementOverride.expires_at > now_utc
    )
    res_ov = await db.execute(stmt_ov)
    overrides = res_ov.scalars().all()
    overrides_dict = {}
    for ov in overrides:
        overrides_dict[ov.feature_key] = {
            "override_value": ov.override_value,
            "reason": ov.reason,
            "expires_at": ov.expires_at,
            "authorized_by": str(ov.authorized_by)
        }

    # Merge into effective map
    all_keys = set(base_entitlements.keys()).union(set(overrides_dict.keys())).union({
        "max_branches", "max_active_staff", "online_booking", "basic_reports", "custom_domain", "loyalty_program"
    })

    effective = []
    for k in sorted(all_keys):
        base = base_entitlements.get(k, {"limit_value": None, "enabled": False, "source": "none"})
        ov = overrides_dict.get(k)
        effective.append({
            "feature_key": k,
            "plan_value": base.get("limit_value"),
            "plan_enabled": base.get("enabled", False),
            "is_overridden": ov is not None,
            "override_value": ov["override_value"] if ov else None,
            "override_reason": ov["reason"] if ov else None,
            "override_expires_at": ov["expires_at"] if ov else None,
            "effective_value": ov["override_value"] if ov and ov["override_value"] is not None else base.get("limit_value")
        })

    return effective


@router.post("/tenants/{tenant_id}/entitlements")
async def set_tenant_entitlement_override(
    tenant_id: uuid.UUID,
    req: FeatureOverrideCreateRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "support"])),
    db: AsyncSession = Depends(get_db)
):
    """Sets an exception override with mandatory justification and explicit expiration."""
    if not req.reason or len(req.reason.strip()) < 5:
        raise HTTPException(status_code=422, detail="Mandatory reason must be provided (at least 5 characters)")

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    expires_at = now_utc + datetime.timedelta(days=req.expires_days)

    ov = TenantEntitlementOverride(
        tenant_id=tenant_id,
        feature_key=req.feature_key,
        override_value=req.override_value,
        reason=req.reason,
        valid_from=now_utc,
        expires_at=expires_at,
        authorized_by=staff.user.id
    )
    db.add(ov)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="tenant.entitlement_overridden",
        object_type="tenant_entitlement_override",
        target_tenant_id=tenant_id,
        object_id=req.feature_key,
        after={"feature_key": req.feature_key, "override_value": req.override_value, "expires_at": str(expires_at)},
        reason=req.reason
    )

    await db.commit()
    return {"status": "success", "feature_key": req.feature_key, "override_value": req.override_value, "expires_at": expires_at}


@router.get("/tenants/{tenant_id}/activity")
async def get_tenant_activity(
    tenant_id: uuid.UUID,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns platform audit trail specific to this tenant for the 'Активность' tab."""
    stmt = select(PlatformAuditEvent).where(
        PlatformAuditEvent.target_tenant_id == tenant_id
    ).order_by(PlatformAuditEvent.occurred_at.desc()).limit(50)
    res = await db.execute(stmt)
    events = res.scalars().all()
    return [
        {
            "id": str(e.id),
            "actor_email": e.actor_email,
            "action": e.action,
            "object_type": e.object_type,
            "reason": e.reason,
            "before": e.before_sanitized,
            "after": e.after_sanitized,
            "occurred_at": e.occurred_at
        }
        for e in events
    ]


@router.post("/tenants/{tenant_id}/change-plan")
async def change_tenant_plan(
    tenant_id: uuid.UUID,
    req: ChangePlanRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Switches tenant to another active plan version with decision audit."""
    stmt_sub = select(Subscription).where(Subscription.tenant_id == tenant_id).order_by(Subscription.created_at.desc())
    res_sub = await db.execute(stmt_sub)
    sub = res_sub.scalars().first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    # Find active plan version
    stmt_p = select(PlanVersion).join(Plan, Plan.id == PlanVersion.plan_id).where(
        Plan.code == req.new_plan_code, PlanVersion.is_active == True
    ).order_by(PlanVersion.version.desc())
    res_p = await db.execute(stmt_p)
    new_pv = res_p.scalars().first()
    if not new_pv:
        raise HTTPException(status_code=400, detail=f"No active version found for plan '{req.new_plan_code}'")

    old_pv_id = sub.plan_version_id
    sub.plan_version_id = new_pv.id

    decision = SubscriptionDecision(
        tenant_id=tenant_id,
        decision_type="change_plan",
        reason=req.reason or "Tariff plan migration",
        actor_id=staff.user.id,
        old_state=str(old_pv_id),
        new_state=str(new_pv.id)
    )
    db.add(decision)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="tenant.plan_changed",
        object_type="subscription",
        target_tenant_id=tenant_id,
        object_id=str(sub.id),
        before={"plan_version_id": str(old_pv_id)},
        after={"plan_version_id": str(new_pv.id), "plan_code": req.new_plan_code},
        reason=req.reason
    )

    await db.commit()
    return {"status": "success", "new_plan_code": req.new_plan_code, "plan_version_id": str(new_pv.id)}


@router.post("/tenants/{tenant_id}/suspend")
async def suspend_tenant(
    tenant_id: uuid.UUID,
    req: SuspendTenantRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner"])),
    db: AsyncSession = Depends(get_db)
):
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

    stmt_sub = select(Subscription).where(Subscription.tenant_id == tenant.id).order_by(Subscription.created_at.desc())
    res_sub = await db.execute(stmt_sub)
    sub = res_sub.scalars().first()
    old_sub_status = sub.lifecycle_status if sub else "unknown"
    if sub:
        sub.lifecycle_status = "suspended"
        sub.suspended_at = now_utc

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
    stmt = select(Tenant).where(Tenant.id == tenant_id)
    res = await db.execute(stmt)
    tenant = res.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    old_status = tenant.lifecycle_status
    tenant.lifecycle_status = "active"
    tenant.suspended_at = None
    tenant.suspension_reason = None

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
# MODULE 3: SUBSCRIPTIONS & MANUAL BILLING LEDGER
# =========================================================================

@router.get("/subscriptions")
async def list_subscriptions(
    status_filter: Optional[str] = None,
    query: Optional[str] = None,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns all subscriptions with tenant details and status filters."""
    stmt = select(Subscription, Tenant, PlanVersion, Plan).join(
        Tenant, Tenant.id == Subscription.tenant_id
    ).join(
        PlanVersion, PlanVersion.id == Subscription.plan_version_id
    ).join(
        Plan, Plan.id == PlanVersion.plan_id
    ).order_by(Subscription.period_end.asc())

    if status_filter:
        stmt = stmt.where(Subscription.lifecycle_status == status_filter)
    if query:
        term = f"%{query.strip()}%"
        stmt = stmt.where(or_(Tenant.display_name.ilike(term), Tenant.slug.ilike(term)))

    res = await db.execute(stmt)
    rows = res.all()

    results = []
    for sub, ten, pv, p in rows:
        results.append({
            "id": str(sub.id),
            "tenant_id": str(ten.id),
            "tenant_name": ten.display_name,
            "tenant_slug": ten.slug,
            "plan_code": p.code,
            "plan_name": p.name,
            "price_minor": pv.price_minor,
            "currency": pv.currency,
            "lifecycle_status": sub.lifecycle_status,
            "period_start": sub.period_start,
            "period_end": sub.period_end,
            "trial_ends_at": sub.trial_ends_at,
            "grace_ends_at": sub.grace_ends_at,
            "renewal_mode": sub.renewal_mode
        })
    return results


@router.post("/subscriptions/{subscription_id}/renew")
async def renew_subscription(
    subscription_id: uuid.UUID,
    req: RenewSubscriptionRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "finance"])),
    db: AsyncSession = Depends(get_db)
):
    """Manually extends subscription, optionally registering an issued charge and confirmed payment."""
    stmt = select(Subscription, Tenant, PlanVersion).join(
        Tenant, Tenant.id == Subscription.tenant_id
    ).join(
        PlanVersion, PlanVersion.id == Subscription.plan_version_id
    ).where(Subscription.id == subscription_id)
    res = await db.execute(stmt)
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Subscription not found")

    sub, tenant, pv = row
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    old_end = sub.period_end.replace(tzinfo=datetime.timezone.utc) if sub.period_end.tzinfo is None else sub.period_end
    base_start = max(now_utc, old_end)
    new_end = base_start + datetime.timedelta(days=req.extend_days)

    old_status = sub.lifecycle_status
    sub.period_end = new_end
    sub.lifecycle_status = "active"
    # IMPORTANT: Do NOT automatically unsuspend a manually suspended company!
    # Restoration of access requires explicit authorized reactivation with documented reason.

    amount = req.amount_minor if req.amount_minor is not None else pv.price_minor
    charge = None
    pmt = None

    if req.record_payment:
        evidence_clean = (req.evidence_reference or "").strip()
        if not evidence_clean:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Explicit payment evidence reference from bank statement or receipt is required when recording payment"
            )
        charge = SubscriptionCharge(
            tenant_id=tenant.id,
            subscription_id=sub.id,
            period_start=base_start,
            period_end=new_end,
            amount_minor=amount,
            currency=pv.currency,
            charge_status="paid",
            evidence_reference=evidence_clean,
            created_by=staff.user.id
        )
        db.add(charge)
        await db.flush()

        pmt = PaymentRecord(
            charge_id=charge.id,
            tenant_id=tenant.id,
            amount_minor=amount,
            currency=pv.currency,
            recorded_by=staff.user.id,
            payment_method=req.payment_method,
            evidence_reference=evidence_clean,
            note=f"Оплата за продление подписки до {new_end.strftime('%d.%m.%Y')}"
        )
        db.add(pmt)
    else:
        # P0-04: Issue new billing charge awaiting manual payment
        charge = SubscriptionCharge(
            tenant_id=tenant.id,
            subscription_id=sub.id,
            period_start=base_start,
            period_end=new_end,
            amount_minor=amount,
            currency=pv.currency,
            charge_status="issued",
            evidence_reference=None,
            created_by=staff.user.id
        )
        db.add(charge)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="subscription.renewed",
        object_type="subscription",
        target_tenant_id=tenant.id,
        object_id=str(sub.id),
        before={"period_end": str(old_end), "status": old_status},
        after={"period_end": str(new_end), "status": "active", "payment_recorded": req.record_payment}
    )

    await db.commit()
    return {
        "subscription_id": str(sub.id),
        "lifecycle_status": sub.lifecycle_status,
        "new_period_end": new_end,
        "charge_id": str(charge.id) if charge else None,
        "payment_id": str(pmt.id) if pmt else None,
        "message": f"Подписка продлена до {new_end.strftime('%d.%m.%Y')}"
    }


@router.get("/charges")
async def list_charges(
    status_filter: Optional[str] = None,
    tenant_id: Optional[uuid.UUID] = None,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns manual billing charges ledger with payments."""
    stmt = select(SubscriptionCharge, Tenant).join(
        Tenant, Tenant.id == SubscriptionCharge.tenant_id
    ).order_by(SubscriptionCharge.created_at.desc())

    if status_filter:
        stmt = stmt.where(SubscriptionCharge.charge_status == status_filter)
    if tenant_id:
        stmt = stmt.where(SubscriptionCharge.tenant_id == tenant_id)

    res = await db.execute(stmt)
    rows = res.all()

    results = []
    for ch, ten in rows:
        # Fetch payments
        stmt_p = select(PaymentRecord).where(PaymentRecord.charge_id == ch.id)
        pmts = (await db.execute(stmt_p)).scalars().all()
        results.append({
            "id": str(ch.id),
            "tenant_id": str(ten.id),
            "tenant_name": ten.display_name,
            "period_start": ch.period_start,
            "period_end": ch.period_end,
            "amount_minor": ch.amount_minor,
            "currency": ch.currency,
            "charge_status": ch.charge_status,
            "evidence_reference": ch.evidence_reference,
            "created_at": ch.created_at,
            "payments": [
                {
                    "id": str(p.id),
                    "amount_minor": p.amount_minor,
                    "evidence_reference": p.evidence_reference,
                    "payment_method": p.payment_method,
                    "recorded_at": p.recorded_at,
                    "note": p.note
                }
                for p in pmts
            ]
        })
    return results


@router.post("/subscriptions/{subscription_id}/charges", status_code=status.HTTP_201_CREATED)
async def issue_charge(
    subscription_id: uuid.UUID,
    req: IssueChargeRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "finance"])),
    db: AsyncSession = Depends(get_db)
):
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
    # Row locking via SELECT ... FOR UPDATE to prevent concurrent race condition double payments
    stmt = select(SubscriptionCharge).where(SubscriptionCharge.id == charge_id).with_for_update()
    res = await db.execute(stmt)
    charge = res.scalar_one_or_none()
    if not charge:
        raise HTTPException(status_code=404, detail="Charge not found")

    if req.amount_minor <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero")

    evidence_clean = req.evidence_reference.strip()
    if not evidence_clean:
        raise HTTPException(status_code=422, detail="Valid payment evidence reference from bank/receipt is required")

    # Strict idempotency key bound to (charge_id, amount, currency, evidence, method)
    if idempotency_key:
        stmt_idem = select(PaymentRecord).where(PaymentRecord.idempotency_key == idempotency_key)
        existing_pmt = (await db.execute(stmt_idem)).scalar_one_or_none()
        if existing_pmt:
            if (
                existing_pmt.charge_id == charge.id
                and existing_pmt.amount_minor == req.amount_minor
                and existing_pmt.currency == charge.currency
                and existing_pmt.evidence_reference == evidence_clean
                and existing_pmt.payment_method == req.payment_method
            ):
                return {
                    "payment_id": str(existing_pmt.id),
                    "status": charge.charge_status,
                    "amount_minor": existing_pmt.amount_minor,
                    "replay": True
                }
            else:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Idempotency key already used with different payment payload"
                )

    # Calculate previous payments and remaining balance
    stmt_prev = select(func.coalesce(func.sum(PaymentRecord.amount_minor), 0)).where(PaymentRecord.charge_id == charge.id)
    prev_total = (await db.execute(stmt_prev)).scalar() or 0
    remaining = charge.amount_minor - prev_total

    if req.amount_minor > remaining:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Payment amount ({req.amount_minor}) exceeds remaining charge balance ({remaining})"
        )

    new_total = prev_total + req.amount_minor
    if new_total == charge.amount_minor:
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
        evidence_reference=evidence_clean,
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
        after={
            "amount_minor": req.amount_minor,
            "evidence": evidence_clean,
            "status": charge.charge_status,
            "idempotency_key": idempotency_key
        }
    )

    await db.commit()
    return {
        "payment_id": str(pmt.id),
        "status": charge.charge_status,
        "amount_minor": pmt.amount_minor,
        "remaining_balance_minor": max(0, charge.amount_minor - new_total)
    }


# =========================================================================
# MODULE 4: TARIFF PLANS CATALOG & VERSIONING
# =========================================================================

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

@router.post("/plans/{plan_id}/versions", status_code=status.HTTP_201_CREATED)
async def create_plan_version(
    plan_id: uuid.UUID,
    req: PlanVersionCreateRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Creates a new version of the plan, keeping earlier versions intact for existing tenants."""
    stmt_p = select(Plan).where(Plan.id == plan_id)
    plan = (await db.execute(stmt_p)).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Determine next version number
    stmt_last = select(PlanVersion).where(PlanVersion.plan_id == plan.id).order_by(PlanVersion.version.desc())
    last_v = (await db.execute(stmt_last)).scalars().first()
    next_ver = (last_v.version + 1) if last_v else 1

    # Deactivate prior active version
    if last_v and last_v.is_active:
        last_v.is_active = False

    new_pv = PlanVersion(
        plan_id=plan.id,
        version=next_ver,
        price_minor=req.price_minor,
        currency=req.currency,
        is_active=True
    )
    db.add(new_pv)
    await db.flush()

    pe_list = [
        PlanEntitlement(plan_version_id=new_pv.id, feature_key="max_branches", limit_value=req.max_branches, enabled=True),
        PlanEntitlement(plan_version_id=new_pv.id, feature_key="max_active_staff", limit_value=req.max_active_staff, enabled=True),
        PlanEntitlement(plan_version_id=new_pv.id, feature_key="online_booking", limit_value=None, enabled=req.online_booking),
        PlanEntitlement(plan_version_id=new_pv.id, feature_key="basic_reports", limit_value=None, enabled=req.basic_reports),
    ]
    db.add_all(pe_list)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="plan.version_created",
        object_type="plan_version",
        target_tenant_id=None,
        object_id=str(new_pv.id),
        after={"plan_code": plan.code, "version": next_ver, "price_minor": req.price_minor}
    )

    await db.commit()
    return {"plan_id": str(plan.id), "version": next_ver, "plan_version_id": str(new_pv.id)}


# =========================================================================
# MODULE 5: SYSTEM FEATURE CATALOG
# =========================================================================

@router.get("/modules/catalog")
async def get_modules_catalog(
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns platform feature catalog items."""
    stmt = select(FeatureCatalog).order_by(FeatureCatalog.key)
    res = await db.execute(stmt)
    items = res.scalars().all()

    if not items:
        # Seed standard feature catalog
        defaults = [
            ("online_booking", "Онлайн-запись клиентов", "available", True, "Публичный веб-виджет бронирования"),
            ("basic_reports", "Базовые отчёты", "available", True, "Дашборд выручки и загрузки мастеров"),
            ("loyalty_program", "Программа лояльности", "beta", True, "Бонусы и персональные скидки клиентов"),
            ("custom_domain", "Свой домен компании", "available", True, "Подключение собственного SSL-домена"),
            ("ip_telephony", "Интеграция с IP-телефонией", "planned", False, "Всплывающая карточка звонка"),
            ("api_access", "REST API для интеграций", "internal_test", True, "Доступ сторонних систем по токену"),
            ("max_branches", "Количество филиалов", "available", True, "Лимит доступных филиалов"),
            ("max_active_staff", "Количество мастеров", "available", True, "Лимит активных сотрудников в графике")
        ]
        for k, name, stage, cfg, desc in defaults:
            db.add(FeatureCatalog(key=k, name=name, release_stage=stage, configurable=cfg, description=desc))
        await db.commit()
        stmt = select(FeatureCatalog).order_by(FeatureCatalog.key)
        items = (await db.execute(stmt)).scalars().all()

    return [
        {
            "key": it.key,
            "name": it.name,
            "release_stage": it.release_stage,
            "configurable": it.configurable,
            "description": it.description
        }
        for it in items
    ]


# =========================================================================
# MODULE 6: SUPPORT & TEMPORARY ACCESS
# =========================================================================

@router.get("/support/tickets")
async def list_support_tickets(
    status_filter: Optional[str] = None,
    tenant_id: Optional[uuid.UUID] = None,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(PlatformSupportTicket, Tenant).join(
        Tenant, Tenant.id == PlatformSupportTicket.tenant_id
    ).order_by(PlatformSupportTicket.created_at.desc())

    if status_filter:
        stmt = stmt.where(PlatformSupportTicket.status == status_filter)
    if tenant_id:
        stmt = stmt.where(PlatformSupportTicket.tenant_id == tenant_id)

    res = await db.execute(stmt)
    rows = res.all()
    results = []
    for tick, ten in rows:
        # Message count
        stmt_mc = select(func.count(SupportMessage.id)).where(SupportMessage.ticket_id == tick.id)
        mc = (await db.execute(stmt_mc)).scalar() or 0
        results.append({
            "id": str(tick.id),
            "tenant_id": str(ten.id),
            "tenant_name": ten.display_name,
            "tenant_slug": ten.slug,
            "subject": tick.subject,
            "status": tick.status,
            "priority": tick.priority,
            "messages_count": mc,
            "created_at": tick.created_at,
            "updated_at": tick.updated_at
        })
    return results


@router.post("/support/tickets", status_code=status.HTTP_201_CREATED)
async def create_support_ticket(
    req: SupportTicketCreateRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "support"])),
    db: AsyncSession = Depends(get_db)
):
    ticket = PlatformSupportTicket(
        tenant_id=req.tenant_id,
        creator_id=staff.user.id,
        subject=req.subject,
        status="open",
        priority=req.priority
    )
    db.add(ticket)
    await db.flush()

    if req.initial_message:
        msg = SupportMessage(
            ticket_id=ticket.id,
            sender_id=staff.user.id,
            sender_role="platform_support",
            message=req.initial_message,
            is_internal=False
        )
        db.add(msg)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="support.ticket_created",
        object_type="support_ticket",
        target_tenant_id=req.tenant_id,
        object_id=str(ticket.id),
        after={"subject": req.subject, "priority": req.priority}
    )

    await db.commit()
    return {"ticket_id": str(ticket.id), "status": ticket.status}


@router.get("/support/tickets/{ticket_id}")
async def get_support_ticket_details(
    ticket_id: uuid.UUID,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(PlatformSupportTicket, Tenant).join(
        Tenant, Tenant.id == PlatformSupportTicket.tenant_id
    ).where(PlatformSupportTicket.id == ticket_id)
    res = await db.execute(stmt)
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")

    tick, ten = row
    stmt_msgs = select(SupportMessage, IdentityUser).join(
        IdentityUser, IdentityUser.id == SupportMessage.sender_id
    ).where(SupportMessage.ticket_id == tick.id).order_by(SupportMessage.created_at.asc())
    res_msgs = await db.execute(stmt_msgs)
    msgs = []
    for m, u in res_msgs.all():
        msgs.append({
            "id": str(m.id),
            "sender_id": str(m.sender_id),
            "sender_name": u.display_name,
            "sender_role": m.sender_role,
            "message": m.message,
            "is_internal": m.is_internal,
            "created_at": m.created_at
        })

    return {
        "id": str(tick.id),
        "tenant_id": str(ten.id),
        "tenant_name": ten.display_name,
        "subject": tick.subject,
        "status": tick.status,
        "priority": tick.priority,
        "created_at": tick.created_at,
        "messages": msgs
    }


@router.post("/support/tickets/{ticket_id}/messages", status_code=status.HTTP_201_CREATED)
async def add_support_message(
    ticket_id: uuid.UUID,
    req: SupportMessageCreateRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "support"])),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(PlatformSupportTicket).where(PlatformSupportTicket.id == ticket_id)
    ticket = (await db.execute(stmt)).scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    msg = SupportMessage(
        ticket_id=ticket.id,
        sender_id=staff.user.id,
        sender_role="platform_support",
        message=req.message,
        is_internal=req.is_internal
    )
    db.add(msg)
    ticket.updated_at = datetime.datetime.now(datetime.timezone.utc)

    await db.commit()
    return {"message_id": str(msg.id), "status": "sent"}


@router.get("/support/diagnosis/{tenant_id}")
async def get_tenant_diagnosis(
    tenant_id: uuid.UUID,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns safe non-PII diagnostic snapshot for troubleshooting."""
    stmt_t = select(Tenant).where(Tenant.id == tenant_id)
    t = (await db.execute(stmt_t)).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    stmt_dom = select(TenantDomain).where(TenantDomain.tenant_id == t.id)
    domains = (await db.execute(stmt_dom)).scalars().all()

    stmt_sub = select(Subscription, PlanVersion, Plan).join(
        PlanVersion, PlanVersion.id == Subscription.plan_version_id
    ).join(
        Plan, Plan.id == PlanVersion.plan_id
    ).where(Subscription.tenant_id == t.id).order_by(Subscription.created_at.desc())
    sub_row = (await db.execute(stmt_sub)).first()

    stmt_b = select(func.count(Branch.id)).where(Branch.tenant_id == t.id)
    branch_count = (await db.execute(stmt_b)).scalar() or 0

    stmt_s = select(func.count(StaffProfile.id)).where(StaffProfile.tenant_id == t.id)
    staff_count = (await db.execute(stmt_s)).scalar() or 0

    stmt_srv = select(func.count(Service.id)).where(Service.tenant_id == t.id)
    service_count = (await db.execute(stmt_srv)).scalar() or 0

    stmt_bk = select(func.count(Booking.id)).where(Booking.tenant_id == t.id)
    booking_count = (await db.execute(stmt_bk)).scalar() or 0

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stmt_ov = select(TenantEntitlementOverride).where(
        TenantEntitlementOverride.tenant_id == t.id,
        TenantEntitlementOverride.expires_at > now_utc
    )
    overrides = (await db.execute(stmt_ov)).scalars().all()

    # Real DB health probe
    try:
        await db.execute(text("SELECT 1"))
        db_health = "healthy"
    except Exception:
        db_health = "unhealthy"

    return {
        "tenant": {
            "id": str(t.id),
            "slug": t.slug,
            "display_name": t.display_name,
            "lifecycle_status": t.lifecycle_status,
            "vertical": t.vertical,
            "timezone": t.timezone_default
        },
        "domains": [{"hostname": d.hostname_normalized, "status": d.verification_status, "type": d.domain_type} for d in domains],
        "subscription": {
            "status": sub_row[0].lifecycle_status,
            "plan_code": sub_row[2].code,
            "plan_name": sub_row[2].name,
            "period_end": sub_row[0].period_end
        } if sub_row else None,
        "metrics": {
            "branches": branch_count,
            "staff": staff_count,
            "services": service_count,
            "bookings_total": booking_count
        },
        "active_overrides": [
            {"key": o.feature_key, "value": o.override_value, "expires_at": o.expires_at}
            for o in overrides
        ],
        "infrastructure": {
            "db_status": db_health,
            "rls_enforcement": "strict",
            "read_only": t.lifecycle_status == "suspended"
        }
    }


@router.get("/access-requests")
async def list_access_requests(
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(SupportAccessRequest, Tenant, IdentityUser).join(
        Tenant, Tenant.id == SupportAccessRequest.tenant_id
    ).join(
        IdentityUser, IdentityUser.id == SupportAccessRequest.requester_id
    ).order_by(SupportAccessRequest.created_at.desc())
    res = await db.execute(stmt)
    rows = res.all()
    results = []
    for req, ten, u in rows:
        results.append({
            "id": str(req.id),
            "tenant_id": str(ten.id),
            "tenant_name": ten.display_name,
            "requester_name": u.display_name,
            "requester_email": u.email_normalized,
            "reason": req.reason,
            "requested_scope": req.requested_scope,
            "status": req.status,
            "expires_at": req.expires_at,
            "created_at": req.created_at
        })
    return results


@router.post("/access-requests", status_code=status.HTTP_201_CREATED)
async def create_access_request(
    req: SupportAccessRequestCreate,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "support"])),
    db: AsyncSession = Depends(get_db)
):
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


@router.post("/access-requests/{request_id}/approve")
async def approve_access_request(
    request_id: uuid.UUID,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
):
    """Platform operators (support, owner, etc.) cannot approve tenant access requests.
    Explicit tenant owner authorization via Business CRM is strictly required."""
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Self-approval is forbidden. Support access requests must be authorized by the tenant owner in Business CRM."
    )


@router.get("/support/delegated-tenant/{tenant_id}")
async def get_delegated_tenant_data(
    tenant_id: uuid.UUID,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "support"])),
    db: AsyncSession = Depends(get_db)
):
    """Returns delegated tenant data strictly guarded by an active, owner-approved support session."""
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stmt = select(SupportAccessSession).where(
        SupportAccessSession.tenant_id == tenant_id,
        SupportAccessSession.staff_id == staff.user.id,
        SupportAccessSession.status == "active",
        SupportAccessSession.expires_at > now_utc
    )
    sess = (await db.execute(stmt)).scalars().first()
    if not sess:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: No active, owner-approved support session exists for this tenant, or session has expired/been revoked."
        )

    # Scoped read with tenant context
    from apps.api.app.infrastructure.db.session import set_tenant_context
    await set_tenant_context(db, tenant_id)
    stmt_b = select(Branch).where(Branch.tenant_id == tenant_id)
    branches = (await db.execute(stmt_b)).scalars().all()
    stmt_s = select(StaffProfile).where(StaffProfile.tenant_id == tenant_id)
    staff_members = (await db.execute(stmt_s)).scalars().all()

    return {
        "tenant_id": str(tenant_id),
        "session_id": str(sess.id),
        "expires_at": sess.expires_at.isoformat(),
        "branches_count": len(branches),
        "staff_count": len(staff_members),
        "delegated_access": "read_only_active"
    }


@router.post("/access-requests/{request_id}/revoke")
async def revoke_access_request(
    request_id: uuid.UUID,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner", "support"])),
    db: AsyncSession = Depends(get_db)
):
    """Immediately revokes support access."""
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stmt = select(SupportAccessSession).where(
        SupportAccessSession.request_id == request_id,
        SupportAccessSession.status == "active"
    )
    sess = (await db.execute(stmt)).scalars().first()
    if sess:
        sess.status = "revoked"
        sess.revoked_at = now_utc

    stmt_r = select(SupportAccessRequest).where(SupportAccessRequest.id == request_id)
    req = (await db.execute(stmt_r)).scalars().first()
    if req:
        req.status = "revoked"

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="support.session_revoked",
        object_type="support_access_session",
        target_tenant_id=sess.tenant_id if sess else None,
        object_id=str(sess.id) if sess else str(request_id)
    )

    await db.commit()
    return {"status": "revoked", "message": "Сеанс поддержки немедленно отозван"}


@router.get("/support/active-session")
async def get_active_support_session(
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns current active support session for the staff member to render the top banner."""
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stmt = select(SupportAccessSession, Tenant).join(
        Tenant, Tenant.id == SupportAccessSession.tenant_id
    ).where(
        SupportAccessSession.staff_id == staff.user.id,
        SupportAccessSession.status == "active",
        SupportAccessSession.expires_at > now_utc
    ).order_by(SupportAccessSession.starts_at.desc())
    row = (await db.execute(stmt)).first()
    if not row:
        return {"has_active_session": False}

    sess, ten = row
    exp = sess.expires_at.replace(tzinfo=datetime.timezone.utc) if sess.expires_at.tzinfo is None else sess.expires_at
    minutes_left = max(0, int((exp - now_utc).total_seconds() / 60))
    return {
        "has_active_session": True,
        "session_id": str(sess.id),
        "request_id": str(sess.request_id),
        "tenant_id": str(ten.id),
        "tenant_name": ten.display_name,
        "minutes_left": minutes_left,
        "expires_at": sess.expires_at
    }


# =========================================================================
# MODULE 7: AUDIT LOGS
# =========================================================================

@router.get("/audit")
async def get_audit_logs(
    target_tenant_id: Optional[uuid.UUID] = None,
    action: Optional[str] = None,
    actor_email: Optional[str] = None,
    limit: int = 50,
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns append-only platform audit trail with full diff capability."""
    stmt = select(PlatformAuditEvent).order_by(PlatformAuditEvent.occurred_at.desc()).limit(limit)
    if target_tenant_id:
        stmt = stmt.where(PlatformAuditEvent.target_tenant_id == target_tenant_id)
    if action:
        stmt = stmt.where(PlatformAuditEvent.action == action)
    if actor_email:
        stmt = stmt.where(PlatformAuditEvent.actor_email.ilike(f"%{actor_email.strip()}%"))

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
# MODULE 8: PLATFORM STAFF & SETTINGS
# =========================================================================

@router.get("/staff")
async def list_platform_staff(
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    """Returns platform operators and their roles."""
    stmt = select(PlatformStaff, IdentityUser).join(
        IdentityUser, IdentityUser.id == PlatformStaff.user_id
    ).order_by(PlatformStaff.created_at)
    res = await db.execute(stmt)
    rows = res.all()
    return [
        {
            "id": str(ps.id),
            "user_id": str(u.id),
            "email": u.email_normalized,
            "display_name": u.display_name,
            "platform_role": ps.platform_role,
            "status": ps.status,
            "created_at": ps.created_at
        }
        for ps, u in rows
    ]


@router.post("/staff", status_code=status.HTTP_201_CREATED)
async def create_platform_staff(
    req: PlatformStaffCreateRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner"])),
    db: AsyncSession = Depends(get_db)
):
    """Adds or invites a platform staff operator without known default passwords.
    Generates a secure one-time activation link."""
    email_clean = req.email.lower().strip()
    stmt_u = select(IdentityUser).where(IdentityUser.email_normalized == email_clean)
    res_u = await db.execute(stmt_u)
    user = res_u.scalar_one_or_none()

    if user:
        # Check boundary: prevent silent privilege escalation of regular CRM users
        stmt_m = select(TenantMembership).where(TenantMembership.user_id == user.id)
        crm_memberships = (await db.execute(stmt_m)).scalars().all()
        if crm_memberships and not req.allow_crm_user_upgrade:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This identity belongs to a regular CRM tenant user. Upgrading CRM users to platform operators requires explicit confirmation (allow_crm_user_upgrade=True)."
            )
    else:
        # User created with unusable temporary secret hash until activation
        user = IdentityUser(
            oidc_subject=f"platform_{uuid.uuid4()}",
            email_normalized=email_clean,
            display_name=req.display_name,
            password_hash=get_password_hash(secrets.token_urlsafe(32))
        )
        db.add(user)
        await db.flush()

    stmt_ps = select(PlatformStaff).where(PlatformStaff.user_id == user.id)
    existing_ps = (await db.execute(stmt_ps)).scalar_one_or_none()
    if existing_ps:
        existing_ps.platform_role = req.platform_role
        existing_ps.status = "pending_activation"
        ps_obj = existing_ps
    else:
        ps_obj = PlatformStaff(
            user_id=user.id,
            platform_role=req.platform_role,
            status="pending_activation"
        )
        db.add(ps_obj)
        await db.flush()

    # Generate cryptographically secure one-time activation token
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)

    invite = Invite(
        tenant_id=None,
        email=email_clean,
        invite_type="platform_staff_invite",
        role=req.platform_role,
        token_hash=token_hash,
        expires_at=expires_at
    )
    db.add(invite)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="platform_staff.created",
        object_type="platform_staff",
        object_id=str(user.id),
        after={"email": email_clean, "role": req.platform_role, "status": "pending_activation"}
    )

    await db.commit()
    return {
        "staff_id": str(ps_obj.id),
        "email": email_clean,
        "platform_role": req.platform_role,
        "status": "pending_activation",
        "activation_token": raw_token,
        "activation_url": f"/activate-platform?token={raw_token}",
        "expires_at": expires_at.isoformat()
    }


@router.post("/staff/activate")
async def activate_platform_staff(
    req: PlatformStaffActivateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Operator sets personal password and activates their platform staff account using one-time token."""
    token_hash = hashlib.sha256(req.activation_token.strip().encode()).hexdigest()
    stmt = select(Invite).where(
        Invite.invite_type == "platform_staff_invite",
        Invite.token_hash == token_hash
    )
    invite = (await db.execute(stmt)).scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid activation token")

    if invite.consumed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Activation token has already been used")

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    exp = invite.expires_at.replace(tzinfo=datetime.timezone.utc) if invite.expires_at.tzinfo is None else invite.expires_at
    if exp < now_utc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Activation token has expired")

    stmt_u = select(IdentityUser).where(IdentityUser.email_normalized == invite.email)
    user = (await db.execute(stmt_u)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")

    # FC-P0-03: Distinguish between brand new platform staff account and existing CRM user identity
    stmt_m = select(TenantMembership).where(TenantMembership.user_id == user.id)
    crm_memberships = (await db.execute(stmt_m)).scalars().all()

    if crm_memberships:
        # Existing CRM account: MUST NOT overwrite existing password!
        # Requires authenticated confirmation with current password to prove user agreement.
        if not req.current_password or not verify_password(req.current_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Activating platform role for an existing CRM user requires confirmation with their current password. The existing account password cannot be overwritten via staff invitation."
            )
        # CRUCIAL: user.password_hash is NOT modified! Existing password is preserved.
    else:
        # Brand new platform account: require setting a secure password (>= 8 chars)
        if not req.password or len(req.password) < 8:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Password must be at least 8 characters long for new platform operator activation."
            )
        user.password_hash = get_password_hash(req.password)

    if req.display_name:
        user.display_name = req.display_name

    stmt_ps = select(PlatformStaff).where(PlatformStaff.user_id == user.id)
    ps = (await db.execute(stmt_ps)).scalar_one_or_none()
    if ps:
        ps.status = "active"

    invite.consumed_at = now_utc

    await record_audit_event(
        db=db,
        actor_id=user.id,
        actor_email=user.email_normalized,
        action="platform_staff.activated",
        object_type="platform_staff",
        object_id=str(user.id),
        after={"email": user.email_normalized, "status": "active"}
    )

    await db.commit()
    return {"status": "activated", "email": user.email_normalized, "message": "Учётная запись успешно активирована"}


@router.get("/settings")
async def get_platform_settings(
    staff: AuthenticatedPlatformStaff = Depends(get_current_platform_staff),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(PlatformSetting).order_by(PlatformSetting.key)
    res = await db.execute(stmt)
    items = res.scalars().all()
    results = {it.key: it.value_json for it in items}
    return {
        "settings_map": results,
        "items": [
            {
                "key": it.key,
                "value": it.value_json,
                "description": it.description,
                "updated_at": it.updated_at
            }
            for it in items
        ]
    }


@router.patch("/settings/{key}")
async def update_platform_setting(
    key: str,
    req: PlatformSettingUpdateRequest,
    staff: AuthenticatedPlatformStaff = Depends(require_platform_roles(["platform_owner"])),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(PlatformSetting).where(PlatformSetting.key == key)
    res = await db.execute(stmt)
    setting = res.scalar_one_or_none()

    old_val = setting.value_json if setting else None
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    if setting:
        setting.value_json = req.value
        if req.description:
            setting.description = req.description
        setting.updated_at = now_utc
    else:
        setting = PlatformSetting(
            key=key,
            value_json=req.value,
            description=req.description,
            updated_at=now_utc
        )
        db.add(setting)

    await record_audit_event(
        db=db,
        actor_id=staff.user.id,
        actor_email=staff.user.email_normalized,
        action="platform_setting.updated",
        object_type="platform_setting",
        object_id=key,
        before={"value": old_val},
        after={"value": req.value}
    )

    await db.commit()
    return {"key": key, "value": req.value, "updated_at": now_utc}
