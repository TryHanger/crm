import re
import json
import logging
from typing import Any, Dict

SENSITIVE_KEYS = {
    "password", "current_password", "token", "activation_token", "jwt",
    "access_token", "secret", "authorization", "cookie", "set-cookie",
    "password_hash", "admin_db_password", "db_password"
}

def sanitize_data(data: Any) -> Any:
    """
    Recursively redacts sensitive values from dictionaries, lists, or strings.
    """
    if isinstance(data, dict):
        sanitized = {}
        for k, v in data.items():
            if str(k).lower() in SENSITIVE_KEYS:
                sanitized[k] = "[REDACTED]"
            else:
                sanitized[k] = sanitize_data(v)
        return sanitized
    elif isinstance(data, list):
        return [sanitize_data(item) for item in data]
    elif isinstance(data, str):
        # Redact bearer tokens in strings
        if data.lower().startswith("bearer "):
            return "Bearer [REDACTED]"
        # Redact query params like ?token=...
        data = re.sub(r'(token=)[^&]+', r'\1[REDACTED]', data, flags=re.IGNORECASE)
        data = re.sub(r'(key=)[^&]+', r'\1[REDACTED]', data, flags=re.IGNORECASE)
        return data
    return data

class SanitizedJsonFormatter(logging.Formatter):
    """Formats log records as JSON with sensitive fields masked."""
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": sanitize_data(record.getMessage()),
        }
        if hasattr(record, "request_id"):
            log_data["request_id"] = record.request_id
        if hasattr(record, "tenant_id"):
            log_data["tenant_id"] = record.tenant_id
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_data, ensure_ascii=False)

def setup_logger(name: str = "saas_crm") -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(SanitizedJsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger

logger = setup_logger()
