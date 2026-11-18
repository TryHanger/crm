"""Кто этот клиент (M10-D2): нормализация номера и подтверждённые правила привязки визита.

Номер:
- казахстанские и любые +7: «+7 701 111-22-33», «8 701 1112233», «7011112233», «77011112233» -> «+77011112233»;
- другие страны: только в международном формате «+<код>…» (8–15 цифр), сохраняется как E.164;
- всё остальное — ошибка PHONE_INVALID (буквы, короткие, «8» без 10 цифр и т. п.).

Привязка визита к клиенту (никогда не сливаем разных людей по одному телефону):
- тот же номер И то же имя (без учёта регистра, лишних пробелов, ё/е) -> тот же клиент;
- тот же номер, другое имя -> НОВЫЙ клиент; администратор видит «тот же номер у: …» и решает сам;
- поиск идёт только внутри компании (tenant + RLS);
- одновременные записи с одного нового номера и имени не создают двух клиентов:
  разрешение клиента сериализуется транзакционной advisory-блокировкой на (компания, номер).
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import Customer


class PhoneError(ValueError):
    code = "PHONE_INVALID"


def normalize_phone(raw: Optional[str]) -> str:
    value = (raw or "").strip()
    if not value:
        raise PhoneError("Укажите номер телефона")
    if re.search(r"[^\d\s()+\-.]", value) or value.count("+") > 1 or ("+" in value and not value.startswith("+")):
        raise PhoneError("Номер телефона может содержать только цифры, пробелы, скобки, дефисы и «+» в начале")
    digits = re.sub(r"\D", "", value)
    if value.startswith("+"):
        if digits.startswith("7"):
            if len(digits) != 11:
                raise PhoneError("Номер +7 должен содержать 10 цифр после кода страны")
            return _plus7(digits[1:])
        if not 8 <= len(digits) <= 15:
            raise PhoneError("Международный номер должен содержать от 8 до 15 цифр")
        return "+" + digits
    if len(digits) == 11 and digits[0] in "78":
        return _plus7(digits[1:])
    if len(digits) == 10 and digits[0] != "8":   # «8» в начале 10 цифр = префикс, цифра потеряна
        return _plus7(digits)
    raise PhoneError("Неполный номер: нужен формат +7 XXX XXX XX XX")


def _plus7(nsn: str) -> str:
    # зона +7: коды начинаются с 3, 4, 6, 7, 8 или 9 (Казахстан — 6xx/7xx)
    if nsn[0] not in "346789":
        raise PhoneError("Такого кода в зоне +7 нет: проверьте номер")
    return "+7" + nsn


def phone_digits(e164: str) -> str:
    return re.sub(r"\D", "", e164)


def name_key(name: Optional[str]) -> str:
    return " ".join((name or "").replace("ё", "е").replace("Ё", "Е").split()).casefold()


def search_digits(term: str) -> Optional[str]:
    """Цифры для поиска по номеру: «8 701 11» -> «770111» (8 в начале = +7). None, если это не номер."""
    digits = re.sub(r"\D", "", term or "")
    if len(digits) < 3 or re.search(r"[A-Za-zА-Яа-яЁё]", term or ""):
        return None
    if digits.startswith("8") and len(digits) >= 4:
        digits = "7" + digits[1:]
    return digits


def like_escape(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@dataclass
class Resolved:
    customer: Customer
    created: bool
    same_phone_others: List[Customer]


async def same_phone_customers(db: AsyncSession, tenant_id: uuid.UUID, e164: str,
                               exclude_id: Optional[uuid.UUID] = None) -> List[Customer]:
    stmt = select(Customer).where(Customer.tenant_id == tenant_id, Customer.phone_e164 == e164,
                                  Customer.archived_at.is_(None)).order_by(Customer.created_at)
    if exclude_id is not None:
        stmt = stmt.where(Customer.id != exclude_id)
    return list((await db.execute(stmt)).scalars().all())


async def resolve_customer(
    db: AsyncSession, *, tenant_id: uuid.UUID, full_name: str, phone: str, email: Optional[str] = None,
    source: str = "public", notes_private: Optional[str] = None,
) -> Resolved:
    """Находит клиента по подтверждённым правилам или создаёт нового. Не коммитит."""
    e164 = normalize_phone(phone)
    clean_name = " ".join((full_name or "").split())
    if not clean_name:
        raise PhoneError("Укажите имя клиента")
    # serialize concurrent resolution of the same number inside the company until commit
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"customer:{tenant_id}:{e164}"})
    candidates = await same_phone_customers(db, tenant_id, e164)
    key = name_key(clean_name)
    for c in candidates:
        if name_key(c.full_name) == key:
            if email and not c.email:
                c.email = email
            return Resolved(c, False, [o for o in candidates if o.id != c.id])
    customer = Customer(
        tenant_id=tenant_id, full_name=clean_name, phone_e164=e164, phone_digits_index=phone_digits(e164),
        email=email, notes_private=notes_private, data_source=source, marketing_consent=False,
    )
    db.add(customer)
    await db.flush()
    return Resolved(customer, True, candidates)
