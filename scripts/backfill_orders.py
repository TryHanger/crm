"""M11 migration map: orders + "rendered" ledger entries for visits completed before the ledger existed.

    python scripts/backfill_orders.py            # all companies
    python scripts/backfill_orders.py --dry-run  # count only

Idempotent: a second run creates nothing (one order per visit, one accrual key per visit).
Salon money before M11 did not exist (reports showed paid = 0); PaymentRecord is platform billing
and is not touched.
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select, text  # noqa: E402

from apps.api.app.infrastructure.db import session as db_session  # noqa: E402
from apps.api.app.infrastructure.db.models import Booking, Order, Tenant  # noqa: E402
from apps.api.app.modules.finance import accrual  # noqa: E402


async def main(dry_run: bool) -> int:
    db_session.configure_engines()
    async with db_session.AsyncSessionLocal() as db:
        tenants = (await db.execute(text("SELECT id, slug FROM tenants ORDER BY slug"))).all()
    total = 0
    for tenant_id, slug in tenants:
        async with db_session.AsyncSessionLocal() as db:
            await db_session.set_tenant_context(db, tenant_id)
            missing = (await db.execute(select(func.count(Booking.id)).outerjoin(
                Order, (Order.booking_id == Booking.id) & (Order.tenant_id == Booking.tenant_id)).where(
                Booking.tenant_id == tenant_id, Booking.status == "completed", Order.id.is_(None)))).scalar_one()
            if missing and not dry_run:
                await accrual.backfill_completed_visits(db, tenant_id)
                await db.commit()
            if missing:
                print(f"{slug}: {missing} completed visits {'to backfill' if dry_run else 'backfilled'}")
            total += missing
    print(f"total: {total}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    sys.exit(asyncio.run(main(ap.parse_args().dry_run)))
