import pytest
import asyncio
import uuid
import datetime
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from apps.api.app.core.config import settings
from apps.api.app.infrastructure.db.models import Tenant, Branch, StaffProfile, Service, StaffOccupancy
from apps.api.app.infrastructure.db.session import set_tenant_context
from apps.api.app.modules.bookings.service import BookingEngine, BookingEngineError

@pytest.mark.asyncio
async def test_multi_service_duration_and_pricing_snapshot(db_session: AsyncSession):
    # Retrieve Barber House (Tenant 1)
    res = await db_session.execute(select(Tenant).where(Tenant.slug == "barberhouse"))
    tenant = res.scalar_one()
    await set_tenant_context(db_session, tenant.id)

    # Branch
    res_b = await db_session.execute(select(Branch).where(Branch.tenant_id == tenant.id))
    branch = res_b.scalar_one()

    # Staff Damir (Top Barber)
    res_s = await db_session.execute(select(StaffProfile).where(StaffProfile.tenant_id == tenant.id, StaffProfile.display_name.like("%Дамир%")))
    damir = res_s.scalar_one()

    # Staff Erzhan (Regular Barber)
    res_e = await db_session.execute(select(StaffProfile).where(StaffProfile.tenant_id == tenant.id, StaffProfile.display_name.like("%Ержан%")))
    erzhan = res_e.scalar_one()

    # Haircut service & Beard service
    res_srv = await db_session.execute(select(Service).where(Service.tenant_id == tenant.id))
    services = res_srv.scalars().all()
    haircut = next(s for s in services if "стрижка" in s.name.lower())
    beard = next(s for s in services if "бород" in s.name.lower())

    service_ids = [haircut.id, beard.id]

    # Calculate for Damir (Top barber has override 8000 + 5000 = 13000 KZT, duration 45 + 30 = 75 min)
    d_dur, d_price, d_items = await BookingEngine.calculate_quote_for_staff(
        db_session, tenant.id, branch.id, damir.id, service_ids
    )
    assert d_dur == 75
    assert d_price == 1300000  # 13 000.00 KZT
    assert len(d_items) == 2

    # Calculate for Erzhan (Override 7000 + 4500 = 11500 KZT, duration 50 + 30 = 80 min)
    e_dur, e_price, e_items = await BookingEngine.calculate_quote_for_staff(
        db_session, tenant.id, branch.id, erzhan.id, service_ids
    )
    assert e_dur == 80
    assert e_price == 1150000  # 11 500.00 KZT
    assert len(e_items) == 2


@pytest.mark.asyncio
async def test_parallel_booking_concurrency_race():
    """
    CRITICAL GATE REQUIREMENT:
    Two concurrent booking requests attempting to book the EXACT SAME master and slot.
    PostgreSQL Exclusion constraint MUST guarantee:
    - Exactly ONE succeeds (201 / returns booking)
    - Exactly ONE fails with 409 SLOT_CONFLICT
    - Exactly ONE staff_occupancy row in database!
    """
    # Create two separate async engines and sessions to simulate 2 independent HTTP requests
    engine1 = create_async_engine(settings.ASYNC_DATABASE_URL, echo=False)
    engine2 = create_async_engine(settings.ASYNC_DATABASE_URL, echo=False)

    session_factory1 = async_sessionmaker(bind=engine1, class_=AsyncSession, expire_on_commit=False)
    session_factory2 = async_sessionmaker(bind=engine2, class_=AsyncSession, expire_on_commit=False)

    async with session_factory1() as session:
        res = await session.execute(select(Tenant).where(Tenant.slug == "barberhouse"))
        tenant = res.scalar_one()
        await set_tenant_context(session, tenant.id)
        res_b = await session.execute(select(Branch).where(Branch.tenant_id == tenant.id))
        branch = res_b.scalar_one()
        res_s = await session.execute(select(StaffProfile).where(StaffProfile.tenant_id == tenant.id))
        staff = res_s.scalars().first()
        res_srv = await session.execute(select(Service).where(Service.tenant_id == tenant.id))
        service = res_srv.scalars().first()

    tenant_id = tenant.id
    branch_id = branch.id
    staff_id = staff.id
    service_ids = [service.id]

    # Valid slot on a working weekday (11:00 UTC = 16:00 Almaty, during Damir's 10:00-20:00 shift, outside lunch break)
    today = datetime.datetime.now(datetime.timezone.utc).date()
    target_day = today + datetime.timedelta(days=12)
    while target_day.isoweekday() not in (1, 2, 3, 4, 5):
        target_day += datetime.timedelta(days=1)
    target_start = datetime.datetime.combine(target_day, datetime.time(11, 0), tzinfo=datetime.timezone.utc)

    async def client_booking_attempt(factory, client_name, client_phone):
        async with factory() as db:
            await set_tenant_context(db, tenant_id)
            try:
                _, prc, _ = await BookingEngine.calculate_quote_for_staff(db, tenant_id, branch_id, staff_id, service_ids)
                booking, token, raw_tok = await BookingEngine.create_booking(
                    db=db,
                    tenant_id=tenant_id,
                    branch_id=branch_id,
                    staff_id=staff_id,
                    service_ids=service_ids,
                    starts_at_utc=target_start,
                    customer_name=client_name,
                    customer_phone_e164=client_phone,
                    source="public",
                    expected_price_minor=prc
                )
                return "SUCCESS", booking.id
            except BookingEngineError as e:
                return "CONFLICT", e.code

    # Launch concurrently!
    results = await asyncio.gather(
        client_booking_attempt(session_factory1, "Клиент 1", "+77011110001"),
        client_booking_attempt(session_factory2, "Клиент 2", "+77011110002")
    )

    statuses = [r[0] for r in results]
    assert "SUCCESS" in statuses, f"Expected 1 SUCCESS, got {statuses}"
    assert "CONFLICT" in statuses, f"Expected 1 CONFLICT, got {statuses}"

    # Verify that exactly ONE active occupancy exists for this slot in DB
    async with session_factory1() as verify_session:
        await set_tenant_context(verify_session, tenant_id)
        stmt = select(StaffOccupancy).where(
            StaffOccupancy.tenant_id == tenant_id,
            StaffOccupancy.staff_id == staff_id,
            StaffOccupancy.starts_at_utc == target_start,
            StaffOccupancy.released_at.is_(None)
        )
        res = await verify_session.execute(stmt)
        occupancies = res.scalars().all()
        assert len(occupancies) == 1, f"Expected exactly 1 active occupancy, found {len(occupancies)}"

    await engine1.dispose()
    await engine2.dispose()


@pytest.mark.asyncio
async def test_price_change_returns_quote_changed(db_session: AsyncSession):
    """
    If expected price changed between quote and create, system must return QUOTE_CHANGED (409)
    and never silently charge unexpected money.
    """
    res = await db_session.execute(select(Tenant).where(Tenant.slug == "barberhouse"))
    tenant = res.scalar_one()
    await set_tenant_context(db_session, tenant.id)

    res_b = await db_session.execute(select(Branch).where(Branch.tenant_id == tenant.id))
    branch = res_b.scalar_one()

    res_s = await db_session.execute(select(StaffProfile).where(StaffProfile.tenant_id == tenant.id))
    staff = res_s.scalars().first()

    res_srv = await db_session.execute(select(Service).where(Service.tenant_id == tenant.id))
    service = res_srv.scalars().first()

    target_start = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=8)
    target_start = target_start.replace(hour=7, minute=0, second=0, microsecond=0)

    # Pass an outdated price expectation (e.g. 5000 KZT instead of 8000 KZT)
    with pytest.raises(BookingEngineError) as exc_info:
        await BookingEngine.create_booking(
            db=db_session,
            tenant_id=tenant.id,
            branch_id=branch.id,
            staff_id=staff.id,
            service_ids=[service.id],
            starts_at_utc=target_start,
            customer_name="Тест Цена",
            customer_phone_e164="+77019998877",
            source="public",
            expected_price_minor=500000  # Wrong outdated price
        )

    assert exc_info.value.code == "QUOTE_CHANGED"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_reschedule_and_cancel_lifecycle(db_session: AsyncSession):
    """
    Tests appointment booking -> rescheduling -> cancellation:
    - Reschedule changes start time and increments version without changing booking_id
    - Cancel releases occupancy and preserves booking in history
    """
    res = await db_session.execute(select(Tenant).where(Tenant.slug == "barberhouse"))
    tenant = res.scalar_one()
    await set_tenant_context(db_session, tenant.id)

    res_b = await db_session.execute(select(Branch).where(Branch.tenant_id == tenant.id))
    branch = res_b.scalar_one()

    res_s = await db_session.execute(select(StaffProfile).where(StaffProfile.tenant_id == tenant.id))
    staff = res_s.scalars().first()

    res_srv = await db_session.execute(select(Service).where(Service.tenant_id == tenant.id))
    service = res_srv.scalars().first()

    today = datetime.datetime.now(datetime.timezone.utc).date()
    target_day = today + datetime.timedelta(days=14)
    while target_day.isoweekday() not in (1, 2, 3, 4, 5):
        target_day += datetime.timedelta(days=1)
    # 11:00 UTC = 16:00 Almaty
    slot1 = datetime.datetime.combine(target_day, datetime.time(11, 0), tzinfo=datetime.timezone.utc)

    # 1. Create Booking
    _, prc, _ = await BookingEngine.calculate_quote_for_staff(db_session, tenant.id, branch.id, staff.id, [service.id])
    booking, token, raw_tok = await BookingEngine.create_booking(
        db=db_session,
        tenant_id=tenant.id,
        branch_id=branch.id,
        staff_id=staff.id,
        service_ids=[service.id],
        starts_at_utc=slot1,
        customer_name="Жизненный Цикл",
        customer_phone_e164="+77028889900",
        source="public",
        expected_price_minor=prc
    )
    assert booking.status == "confirmed"
    assert booking.version == 1
    booking_id = booking.id

    # 2. Reschedule to slot2 (12:00 UTC = 17:00 Almaty)
    slot2 = datetime.datetime.combine(target_day, datetime.time(12, 0), tzinfo=datetime.timezone.utc)
    rescheduled = await BookingEngine.reschedule_booking(
        db=db_session,
        tenant_id=tenant.id,
        booking_id=booking_id,
        new_starts_at_utc=slot2,
        is_client=False
    )
    assert rescheduled.id == booking_id  # Stable UUID
    assert rescheduled.version == 2
    assert rescheduled.starts_at_utc == slot2

    # 3. Cancel Booking
    cancelled = await BookingEngine.cancel_booking(
        db=db_session,
        tenant_id=tenant.id,
        booking_id=booking_id,
        reason="Клиент заболел",
        is_client=False
    )
    assert cancelled.status == "cancelled"
    assert cancelled.cancellation_reason == "Клиент заболел"

    # Verify occupancy is released in DB
    stmt_occ = select(StaffOccupancy).where(
        StaffOccupancy.booking_id == booking_id,
        StaffOccupancy.released_at.is_(None)
    )
    res_occ = await db_session.execute(stmt_occ)
    active_occupancies = res_occ.scalars().all()
    assert len(active_occupancies) == 0, "All occupancies must be released upon cancellation!"
