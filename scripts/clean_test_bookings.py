import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from apps.api.app.infrastructure.db.session import admin_sync_engine
from sqlalchemy import text

def clean_bookings():
    with admin_sync_engine.connect() as conn:
        conn.execute(text("""
            DELETE FROM calendar_blocks;
            DELETE FROM staff_occupancies;
            DELETE FROM booking_items;
            DELETE FROM booking_events;
            DELETE FROM public_management_tokens;
            DELETE FROM bookings;
        """))
        conn.commit()
    print("Test bookings cleanly reset.")

if __name__ == "__main__":
    clean_bookings()
