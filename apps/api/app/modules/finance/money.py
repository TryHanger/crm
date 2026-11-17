"""Денежный контракт (M04-D2). Подробно: docs/finance/MONEY_AND_ORDER_CONTRACT.md

- Все суммы — целые числа в минимальных единицах валюты (KZT: 1 ₸ = 100 тиын).
  float для денег не используется нигде: ни в API, ни в БД, ни в расчётах.
- Валюта задаётся компанией (tenant_settings.currency); услуги, цены мастеров,
  позиции брони и будущего заказа — в той же валюте. Смешивать валюты в одной сумме нельзя.
- Цена за позицию: 0 … MAX_PRICE_MINOR. Ноль допустим (бесплатная консультация).
- Округление вычисляемых сумм (процент скидки, доля): половина вверх к ближайшей
  минимальной единице (ROUND_HALF_UP), выполняется один раз на позицию.
- Распределение суммы на части (частичная оплата, разделение) — методом наибольшего
  остатка: сумма частей всегда равна исходной сумме.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import List, Sequence

# ISO 4217: число знаков после запятой. Новые валюты добавляются только сюда.
CURRENCY_EXPONENTS = {"KZT": 2}
CURRENCY_SIGNS = {"KZT": "₸"}
DEFAULT_CURRENCY = "KZT"

# Колонки цен — PostgreSQL integer (до 2 147 483 647). 10 млн ₸ за одну позицию — с запасом
# для услуг и далеко от переполнения при сложении нескольких позиций.
MAX_PRICE_MINOR = 10_000_000_00


class MoneyError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def normalize_currency(code: str) -> str:
    cur = (code or "").strip().upper()
    if cur not in CURRENCY_EXPONENTS:
        raise MoneyError("CURRENCY_UNSUPPORTED", f"Валюта «{code}» не поддерживается")
    return cur


def exponent(currency: str) -> int:
    return CURRENCY_EXPONENTS[normalize_currency(currency)]


def validate_price_minor(value: int, field: str = "price") -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise MoneyError("PRICE_INVALID", f"{field}: цена должна быть целым числом в минимальных единицах")
    if value < 0:
        raise MoneyError("PRICE_NEGATIVE", f"{field}: цена не может быть отрицательной")
    if value > MAX_PRICE_MINOR:
        raise MoneyError("PRICE_TOO_LARGE", f"{field}: цена больше допустимой ({format_minor(MAX_PRICE_MINOR)})")
    return value


def to_minor(major: Decimal | int | str, currency: str = DEFAULT_CURRENCY) -> int:
    """Сумма в основных единицах (например, «8000» ₸) → минимальные единицы. Без потери точности."""
    q = Decimal(str(major)) * (Decimal(10) ** exponent(currency))
    if q != q.to_integral_value():
        raise MoneyError("PRICE_PRECISION", f"Сумма {major} точнее минимальной единицы валюты")
    return int(q)


def round_half_up(numerator: int, denominator: int) -> int:
    """Целое деление с округлением половины вверх (для неотрицательных и отрицательных)."""
    if denominator == 0:
        raise ZeroDivisionError("denominator")
    return int((Decimal(numerator) / Decimal(denominator)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def percent_of(amount_minor: int, percent: Decimal | int | str) -> int:
    """Доля от суммы в процентах, округлённая один раз до минимальной единицы."""
    return int((Decimal(amount_minor) * Decimal(str(percent)) / Decimal(100)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def allocate(total_minor: int, weights: Sequence[int]) -> List[int]:
    """Делит сумму пропорционально весам; части целые, их сумма == total_minor."""
    if not weights or any(w < 0 for w in weights) or sum(weights) == 0:
        raise MoneyError("ALLOCATION_INVALID", "Веса распределения должны быть неотрицательными и не все нулевые")
    wsum = sum(weights)
    raw = [total_minor * w for w in weights]
    parts = [r // wsum for r in raw]
    remainder = total_minor - sum(parts)
    order = sorted(range(len(weights)), key=lambda i: (-(raw[i] % wsum), i))
    for i in order[:remainder]:
        parts[i] += 1
    return parts


def sum_same_currency(items: Sequence[tuple[int, str]]) -> tuple[int, str]:
    """Сумма позиций (amount_minor, currency); разные валюты — ошибка, а не тихое сложение."""
    currencies = {normalize_currency(c) for _, c in items}
    if len(currencies) > 1:
        raise MoneyError("CURRENCY_MISMATCH", f"Нельзя сложить суммы в разных валютах: {sorted(currencies)}")
    currency = currencies.pop() if currencies else DEFAULT_CURRENCY
    return sum(a for a, _ in items), currency


def format_minor(amount_minor: int, currency: str = DEFAULT_CURRENCY) -> str:
    """8000_00 -> «8 000 ₸», 8000_50 -> «8 000,50 ₸». Неразрывные пробелы не используем (API/CSV)."""
    exp = exponent(currency)
    sign = "-" if amount_minor < 0 else ""
    major, minor = divmod(abs(amount_minor), 10 ** exp)
    major_s = f"{major:,}".replace(",", " ")
    tail = f",{minor:0{exp}d}" if minor else ""
    return f"{sign}{major_s}{tail} {CURRENCY_SIGNS.get(currency, currency)}"
