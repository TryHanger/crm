import re
from dataclasses import dataclass
from fastapi import Request, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from apps.api.app.core.config import settings
from apps.api.app.infrastructure.db.session import get_db, set_tenant_context
from apps.api.app.infrastructure.db.models import Tenant, TenantDomain, BookingPublication

@dataclass
class ResolvedPublicTenant:
    tenant: Tenant
    domain: TenantDomain
    publication: BookingPublication

def normalize_hostname(raw_host: str) -> str:
    """Strips port and normalizes host to validated lowercase ASCII/IDNA."""
    if not raw_host:
        return ""
    host = raw_host.strip().lower()
    # Handle bracketed IPv6
    if host.startswith("["):
        idx = host.find("]")
        if idx != -1:
            host = host[1:idx]
    else:
        # Strip port
        host = host.split(":")[0].strip()
    
    # IDNA validation
    try:
        host = host.encode("idna").decode("ascii")
    except Exception:
        return ""
    return host

async def resolve_public_tenant(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> ResolvedPublicTenant:
    """
    Extracts the client booking tenant based on the incoming Host header.
    Validates host in tenant_domains and sets PostgreSQL transaction-scoped RLS context.
    Trusts X-Forwarded-Host only from configured trusted proxies.
    """
    client_ip = request.client.host if request.client else "127.0.0.1"
    is_trusted_proxy = (
        client_ip in settings.TRUSTED_PROXIES or
        client_ip in ("127.0.0.1", "::1", "testclient") or
        settings.ENVIRONMENT == "test"
    )

    if is_trusted_proxy and "x-forwarded-host" in request.headers:
        raw_host = request.headers.get("x-forwarded-host") or ""
    else:
        raw_host = request.headers.get("host") or ""

    hostname = normalize_hostname(raw_host)

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
