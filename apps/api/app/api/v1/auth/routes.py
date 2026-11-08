import uuid
import datetime
import hashlib
from typing import Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.session import get_db
from apps.api.app.infrastructure.db.models import IdentityUser, TenantMembership, PlatformStaff, Tenant, Invite
from apps.api.app.infrastructure.security.jwt import verify_password, get_password_hash, create_access_token
from apps.api.app.infrastructure.security.auth import get_current_user
from apps.api.app.modules.schemas import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])

class AcceptInviteRequest(BaseModel):
    token: str
    password: str = Field(min_length=8)
    display_name: Optional[str] = None

@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticates staff user or platform administrator."""
    stmt = select(IdentityUser).where(IdentityUser.email_normalized == req.email.lower().strip())
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()

    if not user or not user.password_hash or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    # Check memberships and platform role
    stmt_m = select(TenantMembership).where(TenantMembership.user_id == user.id, TenantMembership.status == "active")
    res_m = await db.execute(stmt_m)
    memberships = res_m.scalars().all()
    crm_role = memberships[0].role if memberships else None

    stmt_p = select(PlatformStaff).where(PlatformStaff.user_id == user.id, PlatformStaff.status == "active")
    res_p = await db.execute(stmt_p)
    p_staff = res_p.scalar_one_or_none()
    platform_role = p_staff.platform_role if p_staff else None

    token = create_access_token({
        "sub": str(user.id),
        "email": user.email_normalized,
        "name": user.display_name,
        "role": crm_role,
        "platform_role": platform_role
    })

    return TokenResponse(
        access_token=token,
        user_id=user.id,
        display_name=user.display_name,
        email=user.email_normalized,
        role=crm_role,
        platform_role=platform_role
    )

@router.get("/me")
async def get_me(user: IdentityUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Returns current authenticated identity."""
    stmt_m = select(TenantMembership, Tenant).join(Tenant, Tenant.id == TenantMembership.tenant_id).where(
        TenantMembership.user_id == user.id,
        TenantMembership.status == "active"
    )
    res_m = await db.execute(stmt_m)
    memberships_data = []
    for m, t in res_m.all():
        memberships_data.append({
            "membership_id": str(m.id),
            "tenant_id": str(t.id),
            "tenant_slug": t.slug,
            "tenant_name": t.display_name,
            "role": m.role
        })

    stmt_p = select(PlatformStaff).where(PlatformStaff.user_id == user.id, PlatformStaff.status == "active")
    res_p = await db.execute(stmt_p)
    p_staff = res_p.scalar_one_or_none()

    return {
        "user_id": str(user.id),
        "email": user.email_normalized,
        "display_name": user.display_name,
        "crm_memberships": memberships_data,
        "platform_role": p_staff.platform_role if p_staff else None
    }


@router.post("/accept-invite", response_model=TokenResponse)
async def accept_invite(req: AcceptInviteRequest, db: AsyncSession = Depends(get_db)):
    """Accepts an owner or staff invitation, sets user password, and activates membership."""
    tok_hash = hashlib.sha256(req.token.strip().encode()).hexdigest()
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    stmt_inv = select(Invite).where(
        Invite.token_hash == tok_hash,
        Invite.consumed_at.is_(None)
    )
    res_inv = await db.execute(stmt_inv)
    invite = res_inv.scalar_one_or_none()

    if not invite or (invite.expires_at and invite.expires_at < now_utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Приглашение недействительно или срок его действия истек"
        )

    # Find or update user
    stmt_u = select(IdentityUser).where(IdentityUser.email_normalized == invite.email.lower().strip())
    res_u = await db.execute(stmt_u)
    user = res_u.scalar_one_or_none()
    if not user:
        user = IdentityUser(
            oidc_subject=f"oidc_{uuid.uuid4()}",
            email_normalized=invite.email.lower().strip(),
            display_name=req.display_name or invite.email.split("@")[0],
            password_hash=get_password_hash(req.password)
        )
        db.add(user)
        await db.flush()
    else:
        user.password_hash = get_password_hash(req.password)
        if req.display_name:
            user.display_name = req.display_name

    # Activate tenant membership
    stmt_m = select(TenantMembership).where(
        TenantMembership.tenant_id == invite.tenant_id,
        TenantMembership.user_id == user.id
    )
    res_m = await db.execute(stmt_m)
    membership = res_m.scalar_one_or_none()
    if not membership:
        membership = TenantMembership(
            tenant_id=invite.tenant_id,
            user_id=user.id,
            role=invite.role,
            status="active"
        )
        db.add(membership)
    else:
        membership.status = "active"

    invite.consumed_at = now_utc
    await db.commit()

    # Generate token
    token = create_access_token({
        "sub": str(user.id),
        "email": user.email_normalized,
        "name": user.display_name,
        "role": membership.role,
        "platform_role": None
    })

    return TokenResponse(
        access_token=token,
        user_id=user.id,
        display_name=user.display_name,
        email=user.email_normalized,
        role=membership.role,
        platform_role=None
    )
