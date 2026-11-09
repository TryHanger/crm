import asyncio
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Dict, Any, Optional
from apps.api.app.core.config import settings

class EmailDeliveryService:
    """
    Transactional email delivery service for SaaS CRM platform.
    Handles owner and operator invitation dispatches with SMTP transport,
    exponential retry backoff, and transparent status reporting.
    When SMTP is not configured, records delivery as manual_channel_required.
    """

    @staticmethod
    def is_smtp_configured() -> bool:
        return bool(settings.SMTP_HOST and settings.SMTP_HOST.strip())

    @classmethod
    async def send_owner_invite(
        cls,
        to_email: str,
        owner_name: str,
        tenant_name: str,
        invite_url: str
    ) -> Dict[str, Any]:
        """
        Sends tenant owner activation email or flags manual channel requirement.
        """
        if not cls.is_smtp_configured():
            return {
                "status": "manual_channel_required",
                "provider": "manual",
                "message": "SMTP-сервер не настроен. Ссылка для ручной передачи владельцу сгенерирована безопасным каналом.",
                "recipient": to_email,
                "sent": False
            }

        subject = f"Приглашение в систему управления {tenant_name}"
        html_content = f"""
        <html>
        <body style="font-family: sans-serif; color: #1E293B; line-height: 1.5;">
            <h2>Здравствуйте, {owner_name}!</h2>
            <p>Для вашей компании <strong>{tenant_name}</strong> развернуто пространство в SaaS CRM.</p>
            <p>Для активации учётной записи владельца и настройки филиала перейдите по защищённой ссылке:</p>
            <p><a href="{invite_url}" style="display: inline-block; padding: 10px 20px; background-color: #2563EB; color: #fff; text-decoration: none; border-radius: 6px;">Активировать аккаунт</a></p>
            <p style="font-size: 12px; color: #64748B;">Ссылка одноразовая и действует 48 часов. Если вы не ожидали это письмо, проигнорируйте его.</p>
        </body>
        </html>
        """
        return await cls._dispatch_smtp_with_retries(to_email, subject, html_content)

    @classmethod
    async def send_operator_invite(
        cls,
        to_email: str,
        operator_name: str,
        activation_url: str
    ) -> Dict[str, Any]:
        """
        Sends platform operator activation email or flags manual channel requirement.
        """
        if not cls.is_smtp_configured():
            return {
                "status": "manual_channel_required",
                "provider": "manual",
                "message": "SMTP-сервер не настроен. Ссылка для ручной передачи оператору сгенерирована.",
                "recipient": to_email,
                "sent": False
            }

        subject = "Приглашение оператора в Platform Console"
        html_content = f"""
        <html>
        <body style="font-family: sans-serif; color: #1E293B; line-height: 1.5;">
            <h2>Здравствуйте, {operator_name}!</h2>
            <p>Вам предоставлен доступ к платформенной консоли управления SaaS CRM.</p>
            <p>Для завершения активации и установки пароля перейдите по ссылке:</p>
            <p><a href="{activation_url}" style="display: inline-block; padding: 10px 20px; background-color: #0F172A; color: #fff; text-decoration: none; border-radius: 6px;">Активировать доступ</a></p>
            <p style="font-size: 12px; color: #64748B;">Ссылка одноразовая и действует 48 часов.</p>
        </body>
        </html>
        """
        return await cls._dispatch_smtp_with_retries(to_email, subject, html_content)

    @classmethod
    async def _dispatch_smtp_with_retries(
        cls,
        to_email: str,
        subject: str,
        html_content: str,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """
        Executes non-blocking SMTP transmission in a worker thread with retry backoff.
        """
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM
        msg["To"] = to_email
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        last_error = ""
        for attempt in range(1, max_retries + 1):
            try:
                await asyncio.to_thread(cls._send_smtp_sync, msg, to_email)
                return {
                    "status": "sent",
                    "provider": "smtp",
                    "message": f"Письмо успешно отправлено на {to_email}",
                    "recipient": to_email,
                    "attempts": attempt,
                    "sent": True
                }
            except Exception as e:
                last_error = str(e)
                if attempt < max_retries:
                    await asyncio.sleep(0.5 * (2 ** (attempt - 1)))

        return {
            "status": "delivery_failed",
            "provider": "smtp",
            "message": f"Не удалось доставить письмо через SMTP: {last_error}",
            "recipient": to_email,
            "attempts": max_retries,
            "sent": False
        }

    @classmethod
    def _send_smtp_sync(cls, msg: MIMEMultipart, to_email: str):
        host = settings.SMTP_HOST
        port = settings.SMTP_PORT
        user = settings.SMTP_USER
        password = settings.SMTP_PASSWORD

        if port == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context, timeout=10) as server:
                if user and password:
                    server.login(user, password)
                server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=10) as server:
                server.ehlo()
                context = ssl.create_default_context()
                server.starttls(context=context)
                server.ehlo()
                if user and password:
                    server.login(user, password)
                server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())
