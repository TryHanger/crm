import time
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

def get_client_ip(request: Request) -> str:
    """Extracts client IP, respecting trusted proxies."""
    client_host = request.client.host if request.client else "127.0.0.1"
    is_trusted = (
        client_host in settings.TRUSTED_PROXIES or
        client_host in ("127.0.0.1", "::1", "localhost", "testclient")
    )
    if is_trusted and "x-forwarded-for" in request.headers:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
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
