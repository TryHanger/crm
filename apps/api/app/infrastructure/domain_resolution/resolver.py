import re
from dataclasses import dataclass
from fastapi import Request, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from apps.api.app.infrastructure.db.session import get_db, set_tenant_context
from apps.api.app.infrastructure.db.models import Tenant, TenantDomain, BookingPublication

@dataclass
class ResolvedPublicTenant:
    tenant: Tenant
    domain: TenantDomain
    publication: BookingPublication

def normalize_hostname(raw_host: str) -> str:
    """Strips port and normalizes host to lowercase ASCII."""
    if not raw_host:
        return ""
    # Strip port if present
    host = raw_host.split(":")[0].strip().lower()
    return host

async def resolve_public_tenant(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> ResolvedPublicTenant:
    """
    Extracts the client booking tenant based on the incoming Host header.
    Validates host in tenant_domains and sets PostgreSQL RLS context.
    """
    # Prefer Host header (or X-Forwarded-Host from trusted edge)
    host_header = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    hostname = normalize_hostname(host_header)

    if not hostname:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SITE_NOT_FOUND", "message": "Host header is missing or empty"}
        )

    # Allow query param slug for local development/testing e.g. ?demo_slug=barberhouse or header X-Demo-Slug
    demo_slug = request.query_params.get("demo_slug") or request.headers.get("x-demo-slug")
    if demo_slug and ("localhost" in hostname or "127.0.0.1" in hostname or "testserver" in hostname):
        stmt = (
            select(TenantDomain, Tenant)
            .join(Tenant, Tenant.id == TenantDomain.tenant_id)
            .where(Tenant.slug == demo_slug.lower())
        )
    else:
        stmt = (
            select(TenantDomain, Tenant)
            .join(Tenant, Tenant.id == TenantDomain.tenant_id)
            .where(TenantDomain.hostname_normalized == hostname)
        )

    res = await db.execute(stmt)
    row = res.first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SITE_NOT_FOUND", "message": f"Online booking site not found for hostname '{hostname}'"}
        )

    domain, tenant = row

    if domain.verification_status != "verified":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOMAIN_UNVERIFIED", "message": "Domain is not verified for online booking"}
        )

    if tenant.lifecycle_status == "archived":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SITE_NOT_FOUND", "message": "Booking site is inactive"}
        )

    if tenant.lifecycle_status == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "TENANT_SUSPENDED", "message": "Online booking is temporarily suspended"}
        )

    # Set PostgreSQL transaction-scoped RLS context
    await set_tenant_context(db, tenant.id)

    # Check publication status
    stmt_pub = select(BookingPublication).where(
        BookingPublication.tenant_id == tenant.id,
        BookingPublication.is_published == True
    )
    res_pub = await db.execute(stmt_pub)
    pub = res_pub.scalars().first()

    if not pub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SITE_NOT_PUBLISHED", "message": "Online booking is not published for this company"}
        )

    return ResolvedPublicTenant(tenant=tenant, domain=domain, publication=pub)
