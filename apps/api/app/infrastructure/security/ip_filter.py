from fastapi import Request, HTTPException, status
from apps.api.app.core.config import settings
from apps.api.app.infrastructure.security.rate_limiter import get_client_ip

async def enforce_platform_ip_allowlist(request: Request):
    """
    Enforces IP/VPN allowlist for Platform Console management endpoints.
    Protects Staging administration against unauthorized public IP access.
    """
    if not settings.PLATFORM_IP_ALLOWLIST:
        return

    client_ip = get_client_ip(request)
    
    # In test/dev, allow local testing
    if settings.ENVIRONMENT in ("development", "test") and client_ip in ("127.0.0.1", "::1", "testclient"):
        return

    if client_ip not in settings.PLATFORM_IP_ALLOWLIST:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PLATFORM_IP_FORBIDDEN",
                "message": f"Доступ к платформенной консоли с IP-адреса {client_ip} запрещен. Требуется VPN или доверенная сеть."
            }
        )
