import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from apps.api.app.infrastructure.db.session import admin_sync_engine
from sqlalchemy import text

def clean_bookings():
    with admin_sync_engine.connect() as conn:
        conn.execute(text("""
            ALTER TABLE ledger_entries DISABLE TRIGGER USER;
            ALTER TABLE order_items DISABLE TRIGGER USER;
            ALTER TABLE orders DISABLE TRIGGER USER;
            ALTER TABLE booking_events DISABLE TRIGGER USER;
            ALTER TABLE bookings DISABLE TRIGGER USER;

            DELETE FROM ledger_entries;
            DELETE FROM order_items;
            DELETE FROM orders;
            DELETE FROM calendar_blocks;
            DELETE FROM staff_occupancies;
            DELETE FROM booking_items;
            DELETE FROM booking_events;
            DELETE FROM public_management_tokens;
            DELETE FROM bookings;

            ALTER TABLE ledger_entries ENABLE TRIGGER USER;
            ALTER TABLE order_items ENABLE TRIGGER USER;
            ALTER TABLE orders ENABLE TRIGGER USER;
            ALTER TABLE booking_events ENABLE TRIGGER USER;
            ALTER TABLE bookings ENABLE TRIGGER USER;
        """))
        conn.commit()
    print("Test bookings cleanly reset.")

if __name__ == "__main__":
    clean_bookings()
