import time
import ipaddress
import collections
from typing import Dict, List, Tuple, Callable
from fastapi import Request, HTTPException, status
from apps.api.app.core.config import settings

class SlidingWindowRateLimiter:
    """
    Thread-safe in-memory sliding window rate limiter.
    Enforces request limits per client IP or custom identifier.
    """
    def __init__(self):
        self._history: Dict[str, List[float]] = collections.defaultdict(list)

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> Tuple[bool, int, int]:
        now = time.time()
        cutoff = now - window_seconds
        
        # Evict timestamps older than current window
        timestamps = [ts for ts in self._history[key] if ts > cutoff]
        self._history[key] = timestamps
        
        if len(timestamps) >= max_requests:
            oldest = timestamps[0]
            retry_after = max(1, int(oldest + window_seconds - now))
            return False, 0, retry_after
        
        timestamps.append(now)
        self._history[key] = timestamps
        remaining = max_requests - len(timestamps)
        return True, remaining, 0

    def reset(self):
        """Clears all rate limit history (used in tests)."""
        self._history.clear()

limiter = SlidingWindowRateLimiter()

def is_trusted_peer(host: str) -> bool:
    """Checks if the direct peer is a trusted proxy or loopback."""
    if not host:
        return False
    if host in ("127.0.0.1", "::1", "localhost", "testclient"):
        return True
    if host in settings.TRUSTED_PROXIES:
        return True
    try:
        parsed = ipaddress.ip_address(host)
        for tp in settings.TRUSTED_PROXIES:
            try:
                if parsed in ipaddress.ip_network(tp, strict=False):
                    return True
            except ValueError:
                if host == tp:
                    return True
                # Attempt hostname resolution for Docker container service names (e.g. 'proxy', 'nginx')
                try:
                    import socket
                    resolved_ips = {ai[4][0] for ai in socket.getaddrinfo(tp, None)}
                    if host in resolved_ips:
                        return True
                except Exception:
                    pass
    except ValueError:
        pass
    return False

def get_client_ip(request: Request) -> str:
    """
    Extracts validated client IP, defending against header spoofing.
    Only trusts proxy headers if the connecting peer is in TRUSTED_PROXIES.
    """
    client_host = request.client.host if request.client else "127.0.0.1"

    if not is_trusted_peer(client_host):
        # Peer is not trusted; ignore any client-supplied forwarded headers
        return client_host

    # When connected through a trusted proxy, prefer X-Real-IP set by Nginx ($remote_addr)
    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip

    # If X-Forwarded-For is provided, walk right-to-left stopping at the first untrusted IP
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        ips = [ip.strip() for ip in forwarded.split(",") if ip.strip()]
        for candidate in reversed(ips):
            if not is_trusted_peer(candidate):
                return candidate
        if ips:
            return ips[0]

    return client_host

def rate_limit(max_requests: int, window_seconds: int = 60, group: str = "default"):
    """
    FastAPI dependency factory enforcing rate limits on endpoints.
    """
    async def dependency(request: Request):
        if not getattr(settings, "RATE_LIMIT_ENABLED", True):
            return

        # In automated test and local development, bypass rate limit unless testing rate limiting explicitly
        if settings.ENVIRONMENT in ("test", "development") and request.headers.get("x-test-rate-limit") != "1":
            return

        ip = get_client_ip(request)
        key = f"{group}:{ip}"
        
        allowed, remaining, retry_after = limiter.is_allowed(key, max_requests, window_seconds)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": "Слишком много запросов. Пожалуйста, повторите позже.",
                    "retry_after": retry_after
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(max_requests),
                    "X-RateLimit-Remaining": "0"
                }
            )
    return dependency
