import re
from dataclasses import dataclass
from fastapi import Request, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from apps.api.app.core.config import settings
from apps.api.app.infrastructure.db.session import get_db, set_tenant_context
from apps.api.app.infrastructure.db.models import Tenant, TenantDomain, BookingPublication
from apps.api.app.infrastructure.domain_resolution import host_policy

@dataclass
class ResolvedPublicTenant:
    tenant: Tenant
    domain: TenantDomain
    publication: BookingPublication

# kept for existing imports; single implementation lives in host_policy
normalize_hostname = host_policy.normalize_hostname

async def resolve_public_tenant(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> ResolvedPublicTenant:
    """
    Extracts the client booking tenant based on the incoming Host header.
    Validates host in tenant_domains and sets PostgreSQL transaction-scoped RLS context.
    Trusts X-Forwarded-Host only from configured trusted proxies.
    """
    hostname = host_policy.request_hostname(request)

    if not hostname:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SITE_NOT_FOUND", "message": "Host header is missing, invalid, or empty"}
        )

    # Local development/test bypass via demo_slug, x-demo-slug, or *.localhost subdomain
    is_local_host = hostname in ("localhost", "127.0.0.1", "testserver") or hostname.endswith(".localhost")
    demo_slug = None
    if settings.ENVIRONMENT in ("development", "test") and is_local_host:
        demo_slug = request.query_params.get("demo_slug") or request.headers.get("x-demo-slug")
        if not demo_slug and hostname.endswith(".localhost") and hostname != "localhost":
            demo_slug = hostname.split(".")[0]

    if demo_slug:
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

    # Fallback ONLY for explicit local development/test environments on .localhost
    if not row and settings.ENVIRONMENT in ("development", "test") and is_local_host:
        subdomain = hostname.split(".")[0]
        if subdomain and subdomain not in ("localhost", "api", "console", "app", "www", "testserver"):
            stmt_slug = (
                select(TenantDomain, Tenant)
                .join(Tenant, Tenant.id == TenantDomain.tenant_id)
                .where(Tenant.slug == subdomain.lower())
            )
            row = (await db.execute(stmt_slug)).first()

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
