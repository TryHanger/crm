"""booking history immutable

Revision ID: 005_booking_history_immutable
Revises: 004_idempotency_per_tenant
Create Date: 2026-11-18 12:00:00

M09-D2. История визита не теряется: события записи (booking_events) только дописываются,
а саму запись (bookings) нельзя удалить — отмена это статус и событие. Защита на уровне БД,
действует и на приложение, и на прямые запросы владельца таблиц.
Ревизия ничего не меняет в данных (additive).
"""
from typing import Sequence, Union

from alembic import op

revision: str = '005_booking_history_immutable'
down_revision: Union[str, None] = '004_idempotency_per_tenant'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION history_forbid_change() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'HISTORY_IMMUTABLE: % on % is not allowed, append an event or change the status instead',
                TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
        END $$;
    """)
    op.execute("""
        CREATE TRIGGER booking_events_append_only BEFORE UPDATE OR DELETE ON booking_events
        FOR EACH ROW EXECUTE FUNCTION history_forbid_change();
    """)
    op.execute("""
        CREATE TRIGGER bookings_no_delete BEFORE DELETE ON bookings
        FOR EACH ROW EXECUTE FUNCTION history_forbid_change();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS bookings_no_delete ON bookings;")
    op.execute("DROP TRIGGER IF EXISTS booking_events_append_only ON booking_events;")
    op.execute("DROP FUNCTION IF EXISTS history_forbid_change();")
