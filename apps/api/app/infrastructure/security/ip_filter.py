import ipaddress
from typing import List
from fastapi import Request, HTTPException, status
from apps.api.app.core.config import settings
from apps.api.app.infrastructure.security.rate_limiter import get_client_ip

def is_ip_allowed(client_ip: str, allowlist: List[str]) -> bool:
    """
    Checks if client IP matches an explicit IP or CIDR network in allowlist.
    Handles IPv4 and IPv6 transparently.
    """
    if not client_ip or not allowlist:
        return False

    try:
        parsed_client = ipaddress.ip_address(client_ip)
    except ValueError:
        return client_ip in allowlist

    for entry in allowlist:
        entry = entry.strip()
        if not entry:
            continue
        try:
            network = ipaddress.ip_network(entry, strict=False)
            if parsed_client in network:
                return True
        except ValueError:
            if client_ip == entry:
                return True

    return False

async def enforce_platform_ip_allowlist(request: Request):
    """
    Enforces IP/VPN allowlist for Platform Console management endpoints.
    Protects Staging and Production administration against unauthorized access.
    Fail-closed: In staging/production, if allowlist is empty or IP not allowed, access is denied.
    """
    client_ip = get_client_ip(request)

    # In development and test modes, allow local loopback testing if allowlist is not explicitly set
    if settings.ENVIRONMENT in ("development", "test"):
        if not settings.PLATFORM_IP_ALLOWLIST:
            return
        if client_ip in ("127.0.0.1", "::1", "testclient") and not request.headers.get("x-test-force-ip-check"):
            return

    # In staging / production, an empty allowlist is strictly forbidden (fail-closed deny-all)
    if not settings.PLATFORM_IP_ALLOWLIST:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PLATFORM_IP_ALLOWLIST_EMPTY",
                "message": "Доступ к платформенной консоли заблокирован: список разрешенных IP не сконфигурирован."
            }
        )

    if not is_ip_allowed(client_ip, settings.PLATFORM_IP_ALLOWLIST):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PLATFORM_IP_FORBIDDEN",
                "message": f"Доступ к платформенной консоли с IP-адреса {client_ip} запрещен. Требуется авторизованный IP или VPN."
            }
        )
