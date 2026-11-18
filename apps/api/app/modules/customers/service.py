import uuid
import datetime
from typing import Optional, Tuple, List, Dict, Any
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import Customer, Booking, StaffProfile, Branch


def normalize_kz_phone(phone: str) -> Tuple[str, str]:
    """
    Normalizes a Kazakhstan (KZ) or international phone number into standard E.164
    format (+7XXXXXXXXXX for KZ) and an 11-digit search index (7XXXXXXXXXX).

    Supported KZ input patterns:
    - +7 (701) 123-45-67
    - 87011234567
    - 77011234567
    - +77011234567
    - 8 701 123 45 67
    - 7011234567 (10 digits)
    - 8-777-999-88-77

    Returns:
        Tuple[str, str]: (phone_e164, phone_digits_index)
    """
    if not phone or not isinstance(phone, str):
        raise ValueError("Номер телефона обязателен")

    digits = "".join(filter(str.isdigit, phone))
    if not digits:
        raise ValueError("Номер телефона не содержит цифр")

    # Local 11-digit numbers starting with 8 -> convert 8 to 7
    if len(digits) == 11 and digits.startswith("8"):
        digits = "7" + digits[1:]
    # 10-digit numbers (without country code) -> prepend 7
    elif len(digits) == 10:
        digits = "7" + digits
    # 11-digit numbers starting with 7
    elif len(digits) == 11 and digits.startswith("7"):
        pass
    # Other international numbers (10 to 15 digits)
    elif 10 <= len(digits) <= 15:
        return f"+{digits}", digits
    else:
        raise ValueError(f"Некорректная длина номера телефона: {len(digits)} цифр")

    if len(digits) != 11 or not digits.startswith("7"):
        raise ValueError("Некорректный формат номера телефона Казахстана (+7...)")

    return f"+{digits}", digits


async def resolve_or_create_customer(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    customer_name: str,
    customer_phone: str,
    customer_email: Optional[str] = None,
    notes: Optional[str] = None,
    source: str = "public",
    explicit_customer_id: Optional[uuid.UUID] = None
) -> Tuple[Customer, bool]:
    """
    Resolves customer identity according to strict M10 contracts:
    - Same phone + matching name -> returning customer (is_new=False).
    - Same phone + DIFFERENT name -> creates a separate customer profile
      (T10 identity invariant: shared phone does NOT merge distinct people!).
    - Explicit customer_id -> verifies tenant ownership and uses that customer.

    Returns:
        Tuple[Customer, bool]: (customer_instance, is_new_record)
    """
    # 1. Explicit Customer ID check (e.g., selected manually in CRM)
    if explicit_customer_id:
        stmt_explicit = select(Customer).where(
            Customer.id == explicit_customer_id,
            Customer.tenant_id == tenant_id
        )
        res_explicit = await db.execute(stmt_explicit)
        existing_explicit = res_explicit.scalar_one_or_none()
        if existing_explicit:
            return existing_explicit, False

    # 2. Normalize phone and name
    phone_e164, phone_digits = normalize_kz_phone(customer_phone)
    clean_name = " ".join(customer_name.strip().split())
    if not clean_name:
        clean_name = "Клиент"

    # 3. Query existing customers in this tenant with this phone or digit index
    stmt = select(Customer).where(
        Customer.tenant_id == tenant_id,
        or_(
            Customer.phone_e164 == phone_e164,
            Customer.phone_digits_index == phone_digits
        )
    )
    res = await db.execute(stmt)
    existing_customers = res.scalars().all()

    # 4. Identity Resolution: Check for match by full name (case-insensitive)
    matched_customer = None
    target_name_lower = clean_name.lower()
    for c in existing_customers:
        if c.full_name.strip().lower() == target_name_lower:
            matched_customer = c
            break

    if matched_customer:
        # Returning visit of the SAME customer
        if customer_email and not matched_customer.email:
            matched_customer.email = customer_email
        return matched_customer, False

    # 5. Distinct person with shared phone OR brand new phone
    # CRITICAL T10 INVARIANT: DO NOT automatically merge people with different names sharing one phone!
    new_customer = Customer(
        tenant_id=tenant_id,
        full_name=clean_name,
        phone_e164=phone_e164,
        phone_digits_index=phone_digits,
        email=customer_email,
        notes_private=notes if source == "crm_manual" else None,
        data_source=source,
        marketing_consent=False
    )
    db.add(new_customer)
    await db.flush()
    return new_customer, True
