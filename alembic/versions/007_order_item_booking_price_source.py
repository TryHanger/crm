"""order item price source 'booking'

Revision ID: 007_order_item_booking_source
Revises: 006_normalize_customer_phones
Create Date: 2026-11-19 09:00:00

M11-D2. Позиция заказа визита хранит цену из снимка брони: источник цены 'booking'.
Вычислять 'base'/'staff_override' сравнением с текущим прайсом нельзя — прайс мог измениться
после записи. Ограничение только расширяется.
"""
from typing import Sequence, Union

from alembic import op

revision: str = '007_order_item_booking_source'
down_revision: Union[str, None] = '006_normalize_customer_phones'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('ck_order_item_price_source', 'order_items', type_='check')
    op.create_check_constraint('ck_order_item_price_source', 'order_items',
                               "price_source IN ('base', 'staff_override', 'manual', 'booking')")


def downgrade() -> None:
    op.drop_constraint('ck_order_item_price_source', 'order_items', type_='check')
    op.create_check_constraint('ck_order_item_price_source', 'order_items',
                               "price_source IN ('base', 'staff_override', 'manual')")
