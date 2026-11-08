import uuid
from typing import Optional, List, Callable
from dataclasses import dataclass
from fastapi import Depends, HTTPException, status, Header, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from apps.api.app.infrastructure.db.session import get_db, set_tenant_context
from apps.api.app.infrastructure.db.models import IdentityUser, TenantMembership, PlatformStaff, Tenant
from apps.api.app.infrastructure.security.jwt import decode_access_token

security = HTTPBearer(auto_error=False)

@dataclass
class AuthenticatedTenantUser:
    user: IdentityUser
    membership: TenantMembership
    tenant_id: uuid.UUID
    role: str  # owner, admin, master

@dataclass
class AuthenticatedPlatformStaff:
    user: IdentityUser
    staff: PlatformStaff
    platform_role: str  # platform_owner, support, finance


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> IdentityUser:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(credentials.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id_str = payload["sub"]
    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid subject format")

    stmt = select(IdentityUser).where(IdentityUser.id == user_id, IdentityUser.account_status == "active")
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User account not found or inactive")
    return user


async def get_current_platform_staff(
    user: IdentityUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> AuthenticatedPlatformStaff:
    stmt = select(PlatformStaff).where(PlatformStaff.user_id == user.id, PlatformStaff.status == "active")
    res = await db.execute(stmt)
    staff = res.scalar_one_or_none()
    if not staff:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have platform management staff permissions"
        )
    return AuthenticatedPlatformStaff(user=user, staff=staff, platform_role=staff.platform_role)


def require_platform_roles(allowed_roles: List[str]):
    async def role_checker(staff_auth: AuthenticatedPlatformStaff = Depends(get_current_platform_staff)):
        if staff_auth.platform_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation requires platform role in {allowed_roles}. Current role: {staff_auth.platform_role}"
            )
        return staff_auth
    return role_checker


async def get_crm_tenant_user(
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    user: IdentityUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> AuthenticatedTenantUser:
    """
    Resolves the authenticated user's active membership in the requested tenant.
    Never trusts tenant ID alone: strictly queries tenant_memberships where user_id matches.
    Sets the transaction-scoped app.current_tenant for PostgreSQL RLS!
    """
    # 1. Determine requested tenant
    target_tenant_id: Optional[uuid.UUID] = None
    if x_tenant_id:
        try:
            target_tenant_id = uuid.UUID(x_tenant_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid X-Tenant-ID UUID format")

    stmt = select(TenantMembership).where(
        TenantMembership.user_id == user.id,
        TenantMembership.status == "active"
    )
    if target_tenant_id:
        stmt = stmt.where(TenantMembership.tenant_id == target_tenant_id)

    res = await db.execute(stmt)
    memberships = res.scalars().all()

    if not memberships:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: user has no active membership in the requested company"
        )

    # Use selected or first active membership
    active_membership = memberships[0]

    # Verify tenant is not deleted/archived
    stmt_t = select(Tenant).where(Tenant.id == active_membership.tenant_id)
    res_t = await db.execute(stmt_t)
    tenant = res_t.scalar_one_or_none()
    if not tenant or tenant.lifecycle_status == "archived":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company workspace not found or archived")

    # Set PostgreSQL transaction-scoped RLS context
    await set_tenant_context(db, active_membership.tenant_id)

    return AuthenticatedTenantUser(
        user=user,
        membership=active_membership,
        tenant_id=active_membership.tenant_id,
        role=active_membership.role
    )


def require_crm_roles(allowed_roles: List[str]):
    async def role_checker(crm_user: AuthenticatedTenantUser = Depends(get_crm_tenant_user)):
        if crm_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: role '{crm_user.role}' lacks permission. Required: {allowed_roles}"
            )
        return crm_user
    return role_checker
