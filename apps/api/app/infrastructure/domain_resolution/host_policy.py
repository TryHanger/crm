"""Какие группы API доступны на каком домене (M03-D2).

    {slug}.book.<root>   -> только /api/v1/public          (клиентская запись, same-origin)
    CRM_DOMAIN           -> /api/v1/auth, /api/v1/business  (CRM салона)
    PLATFORM_DOMAIN      -> /api/v1/auth, /api/v1/platform  (Platform Console)
    API_DOMAIN           -> /api/v1/auth, /api/v1/business, /api/v1/platform
    /health/*            -> на любом хосте (пробы балансировщика)

В строгом режиме (по умолчанию везде, кроме development/test) запрос на неизвестный Host
и запрос к чужой группе API получают 404, сервер не отвечает данными «первой попавшейся» компании.
Существование конкретной компании под booking-хостом проверяет resolver по tenant_domains.
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import Request

from apps.api.app.core.config import settings
from apps.api.app.infrastructure.security.rate_limiter import is_trusted_peer

GROUPS = ("public", "auth", "business", "platform")
_API_GROUP_RE = re.compile(r"^/api/v1/([a-z-]+)(?:/|$)")
_SLUG_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "testserver"}

ALLOWED_GROUPS = {
    "booking": {"public"},
    "crm": {"auth", "business"},
    "console": {"auth", "platform"},
    "api": {"auth", "business", "platform"},
    "local": set(GROUPS),
}


def normalize_hostname(raw_host: str) -> str:
    """Strips port and normalizes host to validated lowercase ASCII/IDNA."""
    if not raw_host:
        return ""
    host = raw_host.strip().lower()
    if host.startswith("["):
        idx = host.find("]")
        if idx != -1:
            host = host[1:idx]
    else:
        host = host.split(":")[0].strip()
    try:
        host = host.encode("idna").decode("ascii")
    except Exception:
        return ""
    return host.rstrip(".")


def request_hostname(request: Request) -> str:
    """Host запроса; X-Forwarded-Host учитывается только от доверенного прокси."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    trusted = is_trusted_peer(client_ip) or settings.ENVIRONMENT == "test"
    if trusted and "x-forwarded-host" in request.headers:
        raw = request.headers.get("x-forwarded-host") or ""
        raw = raw.split(",")[0]  # первый, если прокси дописали цепочку
    else:
        raw = request.headers.get("host") or ""
    return normalize_hostname(raw)


def strict_mode() -> bool:
    override = getattr(settings, "STRICT_HOST_ROUTING", None)
    if override is not None:
        return bool(override)
    return settings.ENVIRONMENT not in ("development", "test")


def _suffix() -> str:
    s = settings.BOOKING_DOMAIN_SUFFIX.strip().lower()
    return s if s.startswith(".") else f".{s}"


def booking_slug(hostname: str) -> Optional[str]:
    """slug, если хост — системный адрес записи `{slug}{BOOKING_DOMAIN_SUFFIX}` с одной меткой."""
    suffix = _suffix()
    if not hostname.endswith(suffix):
        return None
    label = hostname[: -len(suffix)]
    return label if _SLUG_LABEL_RE.match(label) else None


def classify_host(hostname: str, strict: bool) -> Optional[str]:
    if not hostname:
        return None
    if hostname == settings.CRM_DOMAIN.lower():
        return "crm"
    if hostname == settings.PLATFORM_DOMAIN.lower():
        return "console"
    if hostname == settings.API_DOMAIN.lower():
        return "api"
    if booking_slug(hostname):
        return "booking"
    if not strict and (hostname in _LOCAL_HOSTS or hostname.endswith(".localhost")):
        return "local"
    return None


def api_group(path: str) -> Optional[str]:
    m = _API_GROUP_RE.match(path)
    return m.group(1) if m else None


def check(hostname: str, path: str, strict: Optional[bool] = None) -> Optional[dict]:
    """None, если запрос допустим; иначе тело ошибки для ответа 404."""
    strict = strict_mode() if strict is None else strict
    if path == "/health" or path.startswith("/health/"):
        return None
    kind = classify_host(hostname, strict)
    if kind is None:
        if not strict:
            return None  # dev/test: прочие хосты (IP, контейнерные имена) не режем
        return {"code": "HOST_NOT_ALLOWED", "message": "Адрес не обслуживается платформой"}
    group = api_group(path)
    if group is None:
        # не-API пути (docs/openapi) только на api-домене и в локальной разработке
        if kind in ("api", "local"):
            return None
        return {"code": "NOT_FOUND", "message": "Not Found"}
    if group not in ALLOWED_GROUPS[kind]:
        return {"code": "ROUTE_NOT_AVAILABLE_ON_HOST", "message": "Этот раздел API недоступен на данном адресе"}
    return None
