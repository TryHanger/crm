"""normalize customer phones

Revision ID: 006_normalize_customer_phones
Revises: 005_booking_history_immutable
Create Date: 2026-11-18 14:00:00

M10-D2. Номера клиентов приводятся к одному виду (+7XXXXXXXXXX / E.164), чтобы «8 701…»,
«+7 701…» и «7701…» находились и сопоставлялись как один номер. Клиенты НЕ объединяются:
меняется только запись номера и индекс цифр. Номера, которые не удаётся разобрать, остаются
как были (их видно в выводе миграции). Правила заморожены здесь копией, без импорта приложения.
Откат: номера в исходном написании не восстанавливаются (информация о формате не нужна),
downgrade ничего не делает.
"""
import re
from typing import Optional, Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '006_normalize_customer_phones'
down_revision: Union[str, None] = '005_booking_history_immutable'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _normalize(raw: str) -> Optional[str]:
    value = (raw or "").strip()
    if not value or re.search(r"[^\d\s()+\-.]", value) or value.count("+") > 1 or ("+" in value and not value.startswith("+")):
        return None
    digits = re.sub(r"\D", "", value)
    if value.startswith("+"):
        if digits.startswith("7"):
            nsn = digits[1:] if len(digits) == 11 else None
        else:
            return "+" + digits if 8 <= len(digits) <= 15 else None
    elif len(digits) == 11 and digits[0] in "78":
        nsn = digits[1:]
    elif len(digits) == 10 and digits[0] != "8":
        nsn = digits
    else:
        return None
    if not nsn or nsn[0] not in "346789":
        return None
    return "+7" + nsn


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, phone_e164 FROM customers")).fetchall()
    changed, unparsed = 0, 0
    for cid, phone in rows:
        norm = _normalize(phone)
        if norm is None:
            unparsed += 1
            continue
        digits = re.sub(r"\D", "", norm)
        if norm != phone:
            conn.execute(sa.text("UPDATE customers SET phone_e164 = :p, phone_digits_index = :d WHERE id = :i"),
                         {"p": norm, "d": digits, "i": cid})
            changed += 1
        else:
            conn.execute(sa.text("UPDATE customers SET phone_digits_index = :d WHERE id = :i AND phone_digits_index <> :d"),
                         {"d": digits, "i": cid})
    print(f"006_normalize_customer_phones: {changed} normalized, {unparsed} left as is (unparseable)")


def downgrade() -> None:
    pass
