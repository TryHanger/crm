"""tenant scoped catalog foreign keys

Revision ID: 002_catalog_tenant_fks
Revises: 001_initial
Create Date: 2026-11-18 00:49:09.935457

M04-D2. Составные FK (tenant_id, X_id) -> (tenant_id, id): цена мастера, назначение мастера в филиал, категория услуги
и позиция брони могут ссылаться только на объекты своей компании. Одиночные FK проверяют
лишь существование строки и делают это без RLS, поэтому межтенантная ссылка была возможна.

Ревизия только добавляет ограничения (additive). Если в базе уже есть межтенантные ссылки,
upgrade останавливается до изменений и называет таблицу и число строк: их нужно разобрать
вручную, автоматически ничего не удаляется.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '002_catalog_tenant_fks'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# name, child table, child cols, parent table, ondelete
FKS = [
    ('fk_bitem_service_same_tenant', 'booking_items', 'service_id', 'services', None),
    ('fk_service_category_same_tenant', 'services', 'category_id', 'service_categories', None),
    ('fk_offer_branch_same_tenant', 'staff_service_offers', 'branch_id', 'branches', 'CASCADE'),
    ('fk_offer_staff_same_tenant', 'staff_service_offers', 'staff_id', 'staff_profiles', 'CASCADE'),
    ('fk_offer_service_same_tenant', 'staff_service_offers', 'service_id', 'services', 'CASCADE'),
    ('fk_staff_branch_staff_same_tenant', 'staff_branches', 'staff_id', 'staff_profiles', 'CASCADE'),
    ('fk_staff_branch_branch_same_tenant', 'staff_branches', 'branch_id', 'branches', 'CASCADE'),
]


def upgrade() -> None:
    conn = op.get_bind()
    problems = []
    for name, child, col, parent, _ in FKS:
        bad = conn.execute(sa.text(
            f"SELECT count(*) FROM {child} c JOIN {parent} p ON p.id = c.{col} "
            f"WHERE c.{col} IS NOT NULL AND p.tenant_id <> c.tenant_id"
        )).scalar()
        if bad:
            problems.append(f"{child}.{col} -> {parent}: {bad} cross-tenant rows")
    if problems:
        raise RuntimeError("002_catalog_tenant_fks: fix cross-tenant references first: " + "; ".join(problems))

    for name, child, col, parent, ondelete in FKS:
        op.create_foreign_key(name, child, parent, ['tenant_id', col], ['tenant_id', 'id'], ondelete=ondelete)


def downgrade() -> None:
    for name, child, _, _, _ in reversed(FKS):
        op.drop_constraint(name, child, type_='foreignkey')
