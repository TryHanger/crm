"""Что можно писать в логи и в last_error (M15): без адресов целиком, ссылок, токенов и паролей."""
from __future__ import annotations

import re

_EMAIL = re.compile(r"([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)")
_URL = re.compile(r"https?://\S+")
_TOKENISH = re.compile(r"[A-Za-z0-9_\-]{24,}")


def mask_email(email: str) -> str:
    email = (email or "").strip()
    if "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    return f"{local[:1]}***@{domain}"


def redact(text: str, limit: int = 300) -> str:
    text = _URL.sub("[url]", text or "")
    text = _EMAIL.sub(lambda m: f"{m.group(1)}***@{m.group(2)}", text)
    text = _TOKENISH.sub("[secret]", text)
    return text[:limit]
