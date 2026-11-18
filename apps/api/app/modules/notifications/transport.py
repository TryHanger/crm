"""Доставка писем (M15): SMTP для стендов и прода, память для тестов.

Ошибки транспорта делятся на временные (сеть, 4xx, таймаут: повторим позже) и постоянные (адрес
отвергнут, 5xx: повторять бессмысленно). Пароль SMTP никогда не попадает в текст ошибки.
"""
from __future__ import annotations

import asyncio
import smtplib
import ssl
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr, formatdate
from typing import Dict, List, Optional

from apps.api.app.core.config import settings


@dataclass
class OutgoingEmail:
    to: str
    subject: str
    text: str
    html: str
    message_id: str
    headers: Dict[str, str] = field(default_factory=dict)


class TransportError(Exception):
    def __init__(self, message: str, permanent: bool = False):
        super().__init__(message)
        self.permanent = permanent


class Transport:
    name = "base"

    async def send(self, msg: OutgoingEmail) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class MemoryTransport(Transport):
    """Для тестов: письма складываются в список; можно заставить падать первые N отправок."""
    name = "memory"

    def __init__(self, fail_times: int = 0, permanent: bool = False):
        self.sent: List[OutgoingEmail] = []
        self.fail_times = fail_times
        self.permanent = permanent
        self.calls = 0

    async def send(self, msg: OutgoingEmail) -> None:
        self.calls += 1
        if self.fail_times > 0:
            self.fail_times -= 1
            raise TransportError(f"simulated failure for {msg.to}", permanent=self.permanent)
        self.sent.append(msg)


class SmtpTransport(Transport):
    name = "smtp"

    def __init__(self, host: str, port: int, user: Optional[str], password: Optional[str], security: str, sender: str):
        self.host, self.port, self.user, self._password = host, port, user, password
        self.security = security or ("ssl" if port == 465 else "starttls")
        self.sender = sender

    def _build(self, msg: OutgoingEmail) -> EmailMessage:
        m = EmailMessage()
        m["Subject"] = msg.subject
        m["From"] = formataddr(("Онлайн-запись", self.sender))
        m["To"] = msg.to
        m["Date"] = formatdate(localtime=False)
        m["Message-ID"] = msg.message_id
        for k, v in msg.headers.items():
            m[k] = v
        m.set_content(msg.text)
        m.add_alternative(msg.html, subtype="html")
        return m

    def _send_sync(self, msg: OutgoingEmail) -> None:
        mime = self._build(msg)
        try:
            if self.security == "ssl":
                server = smtplib.SMTP_SSL(self.host, self.port, context=ssl.create_default_context(), timeout=15)
            else:
                server = smtplib.SMTP(self.host, self.port, timeout=15)
            with server:
                server.ehlo()
                if self.security == "starttls":
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                if self.user and self._password:
                    server.login(self.user, self._password)
                server.send_message(mime, from_addr=self.sender, to_addrs=[msg.to])
        except smtplib.SMTPRecipientsRefused as e:
            raise TransportError("recipient refused", permanent=True) from None
        except smtplib.SMTPAuthenticationError as e:
            raise TransportError(f"smtp authentication failed ({e.smtp_code})") from None
        except smtplib.SMTPResponseException as e:
            raise TransportError(f"smtp {e.smtp_code}", permanent=500 <= e.smtp_code < 600) from None
        except (smtplib.SMTPException, OSError) as e:
            raise TransportError(f"{type(e).__name__}") from None

    async def send(self, msg: OutgoingEmail) -> None:
        await asyncio.to_thread(self._send_sync, msg)


_memory: Optional[MemoryTransport] = None


def get_transport() -> Optional[Transport]:
    """None — транспорт не настроен: события остаются в очереди, ничего не теряется."""
    global _memory
    kind = settings.EMAIL_TRANSPORT or ("smtp" if (settings.SMTP_HOST or "").strip() else "disabled")
    if kind == "memory":
        _memory = _memory or MemoryTransport()
        return _memory
    if kind == "smtp" and (settings.SMTP_HOST or "").strip():
        return SmtpTransport(settings.SMTP_HOST.strip(), settings.SMTP_PORT, settings.SMTP_USER, settings.SMTP_PASSWORD,
                             settings.SMTP_SECURITY, settings.SMTP_FROM)
    return None
