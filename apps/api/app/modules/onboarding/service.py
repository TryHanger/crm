"""Онбординг компании: создание tenant + владелец + приглашение + подписка (M02-D2).

Правила:
- Всё, что делает компанию рабочей, пишется в одной транзакции. Функции здесь не коммитят:
  коммит делает вызывающий код. Письмо отправляется только после успешного коммита,
  поэтому ссылка никогда не уходит на компанию, которой нет в базе.
- У приглашения одновременно живёт ровно одна ссылка. Повторная отправка ротирует токен,
  старая ссылка перестаёт работать.
- Приглашение гасится под блокировкой строки: два одновременных принятия не активируют дважды.
- Ошибка ввода при активации (короткий пароль, неверный текущий пароль) приглашение не тратит.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re
import secrets
import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.core.config import settings
from apps.api.app.infrastructure.db.models import (
    BookingPolicy, BookingPublication, BookingTheme, IdentityUser, Invite, Plan, PlanVersion,
    Subscription, Tenant, TenantDomain, TenantMembership,
)

INVITE_TTL = dt.timedelta(hours=48)
TRIAL_DAYS = 14
GRACE_DAYS = 7

# Метка DNS: 3–48 символов, латиница/цифры/дефис, без дефиса по краям.
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,46})[a-z0-9]$")
# Имена, которые заняты системными адресами или вводят в заблуждение.
RESERVED_SLUGS = frozenset({
    "admin", "api", "app", "assets", "auth", "billing", "book", "booking", "cdn", "console", "crm",
    "dashboard", "dev", "docs", "help", "localhost", "login", "mail", "platform", "root", "smtp",
    "staging", "static", "status", "support", "test", "testserver", "www",
})


class OnboardingError(Exception):
    def __init__(self, http_status: int, code: str, message: str):
        super().__init__(message)
        self.http_status = http_status
        self.code = code
        self.message = message

    def detail(self) -> dict:
        return {"code": self.code, "message": self.message}


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def normalize_slug(raw: str) -> str:
    slug = (raw or "").strip().lower()
    if not SLUG_RE.match(slug) or "--" in slug:
        raise OnboardingError(422, "SLUG_INVALID",
                              "Адрес компании: 3–48 символов, латиница, цифры и дефис, без дефиса в начале и в конце")
    if slug in RESERVED_SLUGS:
        raise OnboardingError(422, "SLUG_RESERVED", f"Адрес «{slug}» зарезервирован системой, выберите другой")
    return slug


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.strip().encode()).hexdigest()


def new_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def invite_url(raw_token: str) -> str:
    return f"https://{settings.CRM_DOMAIN}/accept-invite?token={raw_token}"


def reveal_link_in_response(delivery_status: str, manual_requested: bool = False) -> bool:
    """Ссылку отдаём в ответе API только там, где её нельзя доставить письмом, или в dev/test."""
    return settings.ENVIRONMENT in ("test", "development") or delivery_status != "sent" or manual_requested


def reveal_raw_token() -> bool:
    return settings.ENVIRONMENT in ("test", "development")


@dataclass
class CompanyCreated:
    tenant: Tenant
    owner: IdentityUser
    membership: TenantMembership
    invite: Invite
    subscription: Subscription
    raw_token: str


async def resolve_plan_version(db: AsyncSession, plan_code: str) -> PlanVersion:
    pv = (await db.execute(
        select(PlanVersion).join(Plan, Plan.id == PlanVersion.plan_id)
        .where(Plan.code == (plan_code or "").strip().lower(), PlanVersion.is_active.is_(True))
        .order_by(PlanVersion.version.desc())
    )).scalars().first()
    if not pv:
        raise OnboardingError(422, "PLAN_NOT_FOUND", f"Тариф «{plan_code}» не найден или выключен")
    return pv


async def create_company(
    db: AsyncSession, *, slug: str, display_name: str, vertical: str,
    owner_email: str, owner_name: str, plan_code: str,
) -> CompanyCreated:
    """Создаёт компанию целиком в текущей транзакции. Не коммитит."""
    slug = normalize_slug(slug)
    display_name = (display_name or "").strip()
    if not display_name:
        raise OnboardingError(422, "NAME_REQUIRED", "Укажите название компании")
    email = owner_email.strip().lower()

    pv = await resolve_plan_version(db, plan_code)
    if (await db.execute(select(Tenant.id).where(Tenant.slug == slug))).first():
        raise OnboardingError(409, "SLUG_TAKEN", f"Адрес «{slug}» уже занят другой компанией")

    now = utcnow()
    tenant = Tenant(slug=slug, display_name=display_name, vertical=vertical,
                    lifecycle_status="active", timezone_default="Asia/Almaty")
    db.add(tenant)
    await db.flush()

    suffix = settings.BOOKING_DOMAIN_SUFFIX
    suffix = suffix if suffix.startswith(".") else f".{suffix}"
    db.add(TenantDomain(tenant_id=tenant.id, hostname_normalized=f"{slug}{suffix}",
                        domain_type="system_subdomain", verification_status="verified",
                        canonical=True, verified_at=now))

    # tenant-таблицы под RLS: контекст только на эту транзакцию
    await db.execute(text("SELECT set_config('app.current_tenant', :t, true)"), {"t": str(tenant.id)})
    db.add(BookingPolicy(tenant_id=tenant.id, allow_online_booking=False))
    db.add(BookingTheme(tenant_id=tenant.id))
    db.add(BookingPublication(tenant_id=tenant.id, slug=slug, is_published=False, published_at=None))

    owner = (await db.execute(select(IdentityUser).where(IdentityUser.email_normalized == email))).scalar_one_or_none()
    if not owner:
        owner = IdentityUser(oidc_subject=f"oidc_{uuid.uuid4()}", email_normalized=email,
                             display_name=(owner_name or "").strip() or email.split("@")[0], password_hash=None)
        db.add(owner)
        await db.flush()

    membership = TenantMembership(tenant_id=tenant.id, user_id=owner.id, role="owner", status="invited")
    db.add(membership)
    await db.flush()
    tenant.owner_membership_id = membership.id

    raw, token_hash = new_token()
    invite = Invite(tenant_id=tenant.id, email=email, invite_type="owner_invite", role="owner",
                    token_hash=token_hash, expires_at=now + INVITE_TTL, sent_at=now)
    db.add(invite)

    subscription = Subscription(
        tenant_id=tenant.id, plan_version_id=pv.id, lifecycle_status="trial",
        period_start=now, period_end=now + dt.timedelta(days=TRIAL_DAYS),
        trial_ends_at=now + dt.timedelta(days=TRIAL_DAYS),
        grace_ends_at=now + dt.timedelta(days=TRIAL_DAYS + GRACE_DAYS),
        renewal_mode="manual",
    )
    db.add(subscription)
    await db.flush()
    return CompanyCreated(tenant, owner, membership, invite, subscription, raw)


async def rotate_invite(db: AsyncSession, tenant_id: uuid.UUID, email: str) -> tuple[Invite, str]:
    """Новая ссылка для действующего (непогашенного) приглашения. Не коммитит.

    Старые ссылки этого адреса перестают работать. Просроченное приглашение тоже можно
    перевыпустить. Новое приглашение здесь не создаётся: выдать доступ новому человеку можно
    только через создание компании или приглашение сотрудника.
    """
    email = email.strip().lower()
    if not (await db.execute(select(Tenant.id).where(Tenant.id == tenant_id))).first():
        raise OnboardingError(404, "TENANT_NOT_FOUND", "Компания не найдена")

    pending = (await db.execute(
        select(Invite).where(Invite.tenant_id == tenant_id, Invite.email == email, Invite.consumed_at.is_(None))
        .order_by(Invite.sent_at.desc()).with_for_update()
    )).scalars().all()
    if not pending:
        active = (await db.execute(
            select(TenantMembership.id).join(IdentityUser, IdentityUser.id == TenantMembership.user_id)
            .where(TenantMembership.tenant_id == tenant_id, IdentityUser.email_normalized == email,
                   TenantMembership.status == "active")
        )).first()
        if active:
            raise OnboardingError(409, "INVITE_ALREADY_ACCEPTED",
                                  f"{email} уже активировал доступ, повторное приглашение не нужно")
        raise OnboardingError(404, "INVITE_NOT_FOUND", f"Для {email} нет приглашения в эту компанию")

    now = utcnow()
    invite, older = pending[0], pending[1:]
    for stale in older:  # одна живая ссылка на адрес
        stale.expires_at = now
    raw, token_hash = new_token()
    invite.token_hash = token_hash
    invite.expires_at = now + INVITE_TTL
    invite.sent_at = now
    invite.attempts = 0
    await db.flush()
    return invite, raw


async def lock_invite_for_acceptance(db: AsyncSession, raw_token: str) -> Invite:
    """Находит и блокирует приглашение до конца транзакции. Не гасит его."""
    invite = (await db.execute(
        select(Invite).where(Invite.token_hash == hash_token(raw_token)).with_for_update()
    )).scalar_one_or_none()
    if not invite:
        raise OnboardingError(400, "INVITE_INVALID", "Приглашение недействительно или срок его действия истёк")
    if invite.consumed_at is not None:
        raise OnboardingError(400, "INVITE_ALREADY_USED",
                              "Приглашение уже использовано. Войдите со своим паролем")
    if invite.expires_at <= utcnow():
        raise OnboardingError(400, "INVITE_EXPIRED",
                              "Срок действия приглашения истёк. Попросите отправить новое")
    return invite


def invite_status(invite: Invite, now: Optional[dt.datetime] = None) -> str:
    now = now or utcnow()
    if invite.consumed_at is not None:
        return "accepted"
    return "expired" if invite.expires_at <= now else "pending"
