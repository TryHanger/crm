import uuid
import hashlib
import secrets
import datetime
import zoneinfo
from typing import List, Optional, Tuple, Dict, Any
from sqlalchemy import select, and_, or_, func, text, delete, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError, DBAPIError
from fastapi import HTTPException, status

from apps.api.app.modules.finance import money
from apps.api.app.infrastructure.db.session import set_tenant_context
from apps.api.app.infrastructure.db.models import (
    Tenant, Subscription, Booking, BookingItem, StaffOccupancy, CalendarBlock, BookingEvent,
    BookingQuote, PublicManagementToken, OutboxEvent, Customer,
    StaffProfile, StaffBranch, StaffServiceOffer, Service, Branch,
    BookingPolicy, WeeklyShift, ShiftBreak, StaffTimeOff, IdempotencyRecord
)

class BookingEngineError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details

class BookingEngine:
    @staticmethod
    async def get_booking_policy(db: AsyncSession, tenant_id: uuid.UUID, branch_id: uuid.UUID) -> BookingPolicy:
        await set_tenant_context(db, tenant_id)
        # Branch specific policy or tenant fallback
        stmt = select(BookingPolicy).where(
            BookingPolicy.tenant_id == tenant_id,
            or_(BookingPolicy.branch_id == branch_id, BookingPolicy.branch_id.is_(None))
        ).order_by(BookingPolicy.branch_id.desc())
        res = await db.execute(stmt)
        policy = res.scalars().first()
        if not policy:
            # Fallback default
            policy = BookingPolicy(
                tenant_id=tenant_id,
                branch_id=branch_id,
                book_ahead_days=30,
                min_advance_minutes=120,
                cancellation_cutoff_minutes=180,
                allow_self_reschedule=True,
                slot_step_minutes=15,
                max_services_per_booking=5,
                allow_online_booking=True,
                price_change_requires_acceptance=True
            )
        return policy

    @staticmethod
    async def calculate_quote_for_staff(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        branch_id: uuid.UUID,
        staff_id: uuid.UUID,
        service_ids: List[uuid.UUID]
    ) -> Tuple[int, int, List[Dict[str, Any]]]:
        """
        Calculates total duration (mins), total price (minor), and service item snapshots
        for a specific master, respecting staff_service_offers overrides.
        """
        items = []
        total_duration = 0
        total_price = 0

        for seq, s_id in enumerate(service_ids, start=1):
            # Fetch base service
            stmt_s = select(Service).where(
                Service.id == s_id,
                Service.tenant_id == tenant_id,
                Service.active == True,
                Service.archived_at.is_(None)
            )
            res_s = await db.execute(stmt_s)
            service = res_s.scalar_one_or_none()
            if not service:
                raise BookingEngineError("SERVICE_NOT_FOUND", f"Service {s_id} is inactive or not found", 422)

            # Fetch staff offer override
            stmt_offer = select(StaffServiceOffer).where(
                StaffServiceOffer.tenant_id == tenant_id,
                StaffServiceOffer.staff_id == staff_id,
                StaffServiceOffer.branch_id == branch_id,
                StaffServiceOffer.service_id == s_id,
                StaffServiceOffer.active == True
            )
            res_offer = await db.execute(stmt_offer)
            offer = res_offer.scalar_one_or_none()
            if not offer:
                raise BookingEngineError("STAFF_SERVICE_UNAVAILABLE", f"Staff cannot perform service {service.name}", 422)

            duration = offer.duration_override_minutes if offer.duration_override_minutes is not None else service.base_duration_minutes
            price = offer.price_override_minor if offer.price_override_minor is not None else service.base_price_minor

            total_duration += duration
            total_price += price

            items.append({
                "service_id": service.id,
                "sequence": seq,
                "service_name": service.name,
                "duration_minutes": duration,
                "price_minor": price,
                "currency": service.currency
            })

        # M04 money contract: one currency per booking/order, never a silent mixed sum
        try:
            money.sum_same_currency([(it["price_minor"], it["currency"]) for it in items])
        except money.MoneyError as e:
            raise BookingEngineError(e.code, e.message, 422)

        return total_duration, total_price, items

    @classmethod
    async def validate_slot_and_policies(
        cls,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        branch_id: uuid.UUID,
        staff_id: uuid.UUID,
        service_ids: List[uuid.UUID],
        starts_at_utc: datetime.datetime,
        duration_minutes: int,
        is_client: bool = True,
        ignore_booking_id: Optional[uuid.UUID] = None
    ) -> Tuple[Branch, StaffProfile, BookingPolicy]:
        """
        Unified Authoritative Gatekeeper:
        Validates tenant status, subscription, branch, staff, policies, shifts,
        breaks, time-offs, blocks, and occupancy constraints.
        """
        # 1. Tenant Lifecycle Check
        stmt_t = select(Tenant).where(Tenant.id == tenant_id)
        res_t = await db.execute(stmt_t)
        tenant = res_t.scalar_one_or_none()
        if not tenant:
            raise BookingEngineError("TENANT_NOT_FOUND", "Company not found", 404)
        if tenant.lifecycle_status == "suspended":
            raise BookingEngineError("TENANT_SUSPENDED", "Company workspace is suspended", 403)
        if tenant.lifecycle_status == "archived":
            raise BookingEngineError("TENANT_ARCHIVED", "Company workspace is archived", 404)

        # 2. Check Subscription
        stmt_sub_susp = select(Subscription).where(
            Subscription.tenant_id == tenant_id,
            Subscription.lifecycle_status == "suspended"
        )
        res_sub_susp = await db.execute(stmt_sub_susp)
        if res_sub_susp.scalars().first():
            raise BookingEngineError("TENANT_SUSPENDED", "Company subscription is suspended", 403)

        # 3. Branch Validation
        stmt_b = select(Branch).where(Branch.id == branch_id, Branch.tenant_id == tenant_id)
        res_b = await db.execute(stmt_b)
        branch = res_b.scalar_one_or_none()
        if not branch or branch.status != "active":
            raise BookingEngineError("BRANCH_NOT_FOUND", "Branch not found or inactive", 404)

        # 4. Policy
        policy = await cls.get_booking_policy(db, tenant_id, branch_id)

        # 5. Service Count Validation
        if not service_ids or len(service_ids) == 0:
            raise BookingEngineError("EMPTY_SERVICES", "At least one service must be selected", 422)
        if len(service_ids) > policy.max_services_per_booking:
            raise BookingEngineError("MAX_SERVICES_EXCEEDED", f"Maximum {policy.max_services_per_booking} services allowed", 422)

        # 6. Staff Validation
        stmt_sp = select(StaffProfile).where(StaffProfile.id == staff_id, StaffProfile.tenant_id == tenant_id)
        res_sp = await db.execute(stmt_sp)
        staff = res_sp.scalar_one_or_none()
        if not staff or not staff.active:
            raise BookingEngineError("STAFF_NOT_FOUND", "Master not found or inactive", 404)
        if is_client and not staff.online_bookable:
            raise BookingEngineError("STAFF_NOT_VISIBLE", "Master is not available for online booking", 404)

        stmt_sb = select(StaffBranch).where(
            StaffBranch.tenant_id == tenant_id,
            StaffBranch.staff_id == staff_id,
            StaffBranch.branch_id == branch_id
        )
        res_sb = await db.execute(stmt_sb)
        if not res_sb.scalar_one_or_none():
            raise BookingEngineError("STAFF_BRANCH_MISMATCH", "Master does not work in this branch", 422)

        # 7. Time & Advance Notice Validation
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        ends_at_utc = starts_at_utc + datetime.timedelta(minutes=duration_minutes)

        if starts_at_utc < now_utc:
            raise BookingEngineError("SLOT_IN_PAST", "Cannot book appointment in the past", 400)

        if is_client:
            min_advance = datetime.timedelta(minutes=policy.min_advance_minutes)
            if (starts_at_utc - now_utc) < min_advance:
                raise BookingEngineError("SLOT_TOO_SOON", f"Minimum advance notice is {policy.min_advance_minutes} minutes", 400)

            max_horizon = datetime.timedelta(days=policy.book_ahead_days)
            if (starts_at_utc - now_utc) > max_horizon:
                raise BookingEngineError("SLOT_TOO_FAR", f"Booking horizon cannot exceed {policy.book_ahead_days} days", 400)

        # 8. Timezone and Working Shift Validation
        try:
            tz = zoneinfo.ZoneInfo(branch.timezone_iana or "Asia/Almaty")
        except Exception:
            tz = zoneinfo.ZoneInfo("UTC")

        local_start_dt = starts_at_utc.astimezone(tz)
        local_end_dt = ends_at_utc.astimezone(tz)
        weekday_iso = local_start_dt.isoweekday()

        stmt_shift = select(WeeklyShift).where(
            WeeklyShift.tenant_id == tenant_id,
            WeeklyShift.staff_id == staff_id,
            WeeklyShift.branch_id == branch_id,
            WeeklyShift.weekday_iso == weekday_iso
        )
        res_shift = await db.execute(stmt_shift)
        shifts = res_shift.scalars().all()
        if not shifts:
            raise BookingEngineError("STAFF_NOT_WORKING", "Master has no working shift scheduled on this day", 400)

        shift_covering = None
        for shift in shifts:
            shift_start_dt = datetime.datetime.combine(local_start_dt.date(), shift.local_start, tzinfo=tz).astimezone(datetime.timezone.utc)
            shift_end_dt = datetime.datetime.combine(local_start_dt.date(), shift.local_end, tzinfo=tz).astimezone(datetime.timezone.utc)
            if starts_at_utc >= shift_start_dt and ends_at_utc <= shift_end_dt:
                shift_covering = shift
                # Check breaks
                stmt_brk = select(ShiftBreak).where(ShiftBreak.shift_id == shift.id)
                res_brk = await db.execute(stmt_brk)
                breaks = res_brk.scalars().all()
                for brk in breaks:
                    brk_start_utc = datetime.datetime.combine(local_start_dt.date(), brk.local_start, tzinfo=tz).astimezone(datetime.timezone.utc)
                    brk_end_utc = datetime.datetime.combine(local_start_dt.date(), brk.local_end, tzinfo=tz).astimezone(datetime.timezone.utc)
                    if max(starts_at_utc, brk_start_utc) < min(ends_at_utc, brk_end_utc):
                        raise BookingEngineError("STAFF_ON_BREAK", "Selected time overlaps with master's scheduled break", 400)
                break

        if not shift_covering:
            raise BookingEngineError("STAFF_OUTSIDE_SHIFT", "Requested time is outside master's working hours", 400)

        # 9. Time Off Validation
        stmt_to = select(StaffTimeOff).where(
            StaffTimeOff.tenant_id == tenant_id,
            StaffTimeOff.staff_id == staff_id,
            StaffTimeOff.from_at_utc < ends_at_utc,
            StaffTimeOff.to_at_utc > starts_at_utc
        )
        res_to = await db.execute(stmt_to)
        if res_to.scalars().first():
            raise BookingEngineError("STAFF_TIME_OFF", "Master is on approved leave/vacation at this time", 400)

        # 10. Calendar Block Validation
        stmt_cb = select(CalendarBlock).where(
            CalendarBlock.tenant_id == tenant_id,
            CalendarBlock.staff_id == staff_id,
            CalendarBlock.starts_at_utc < ends_at_utc,
            CalendarBlock.ends_at_utc > starts_at_utc
        )
        res_cb = await db.execute(stmt_cb)
        if res_cb.scalars().first():
            raise BookingEngineError("CALENDAR_BLOCKED", "Master schedule is blocked at this time", 400)

        # 11. Occupancies Validation
        stmt_occ = select(StaffOccupancy).where(
            StaffOccupancy.tenant_id == tenant_id,
            StaffOccupancy.staff_id == staff_id,
            StaffOccupancy.released_at.is_(None),
            StaffOccupancy.starts_at_utc < ends_at_utc,
            StaffOccupancy.ends_at_utc > starts_at_utc
        )
        if ignore_booking_id:
            stmt_occ = stmt_occ.where(StaffOccupancy.booking_id != ignore_booking_id)
        res_occ = await db.execute(stmt_occ)
        if res_occ.scalars().first():
            raise BookingEngineError("SLOT_CONFLICT", "The selected time slot is already booked", 409)

        return branch, staff, policy

    @classmethod
    async def search_availability(
        cls,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        branch_id: uuid.UUID,
        service_ids: List[uuid.UUID],
        from_utc: datetime.datetime,
        to_utc: datetime.datetime,
        staff_id: Optional[uuid.UUID] = None,
        staff_mode: str = "specific",  # specific or any
        is_public: bool = True,
        persist_quotes: bool = True,
    ) -> Dict[str, Any]:
        """
        Determines available slots considering:
        - booking horizon & min advance
        - candidate staff abilities for ALL services
        - working shifts and breaks
        - holidays and staff time off
        - existing staff occupancies (bookings and calendar blocks)
        - deterministic ordering for 'any master'
        """
        policy = await cls.get_booking_policy(db, tenant_id, branch_id)
        if is_public and not policy.allow_online_booking:
            raise BookingEngineError("BOOKING_DISABLED", "Online booking is currently disabled for this location", 403)

        if not service_ids or len(service_ids) == 0:
            raise BookingEngineError("EMPTY_SERVICES", "At least one service must be selected to search availability", 422)

        if len(service_ids) > policy.max_services_per_booking:
            raise BookingEngineError("TOO_MANY_SERVICES", f"Maximum {policy.max_services_per_booking} services allowed", 422)

        # Horizon and advance check
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        min_start_utc = now_utc + datetime.timedelta(minutes=policy.min_advance_minutes)
        max_start_utc = now_utc + datetime.timedelta(days=policy.book_ahead_days)

        if (to_utc - from_utc).days > 14:
            raise BookingEngineError("SEARCH_RANGE_EXCEEDED", "Availability search range cannot exceed 14 days", 422)

        search_from = max(from_utc, min_start_utc)
        search_to = min(to_utc, max_start_utc)

        if search_from >= search_to:
            return {"slots": [], "total_count": 0}

        if persist_quotes:  # preview writes nothing and commits nothing
            try:
                stmt_cleanup = delete(BookingQuote).where(
                    BookingQuote.tenant_id == tenant_id,
                    BookingQuote.expires_at < now_utc - datetime.timedelta(hours=1)
                )
                await db.execute(stmt_cleanup)
            except Exception:
                pass

        # 1. Candidate staff
        if staff_id:
            candidate_staff_ids = [staff_id]
        else:
            # Find all staff assigned to this branch who can do ALL service_ids
            stmt_staff = (
                select(StaffProfile.id)
                .join(StaffBranch, StaffBranch.staff_id == StaffProfile.id)
                .where(
                    StaffProfile.tenant_id == tenant_id,
                    StaffBranch.branch_id == branch_id,
                    StaffProfile.active == True,
                    StaffBranch.active == True,
                    StaffProfile.online_bookable == True if is_public else True
                )
            )
            res_staff = await db.execute(stmt_staff)
            all_branch_staff = res_staff.scalars().all()

            candidate_staff_ids = []
            for s_id in all_branch_staff:
                try:
                    await cls.calculate_quote_for_staff(db, tenant_id, branch_id, s_id, service_ids)
                    candidate_staff_ids.append(s_id)
                except BookingEngineError:
                    continue  # staff cannot perform all services

        if not candidate_staff_ids:
            return {"slots": [], "total_count": 0}

        # 2. Iterate each day in range and generate candidate slots
        slots = []
        step_minutes = policy.slot_step_minutes

        # Fetch branch timezone
        stmt_br = select(Branch).where(Branch.id == branch_id)
        res_br = await db.execute(stmt_br)
        branch_obj = res_br.scalar_one_or_none()
        try:
            tz = zoneinfo.ZoneInfo(branch_obj.timezone_iana or "Asia/Almaty") if branch_obj else zoneinfo.ZoneInfo("Asia/Almaty")
        except Exception:
            tz = zoneinfo.ZoneInfo("UTC")

        for c_staff_id in candidate_staff_ids:
            duration_mins, price_minor, items_snapshot = await cls.calculate_quote_for_staff(
                db, tenant_id, branch_id, c_staff_id, service_ids
            )
            svc_delta = datetime.timedelta(minutes=duration_mins)
            slot_currency = items_snapshot[0]["currency"] if items_snapshot else "KZT"

            # Get staff profile for details
            stmt_sp = select(StaffProfile).where(StaffProfile.id == c_staff_id)
            res_sp = await db.execute(stmt_sp)
            staff_prof = res_sp.scalar_one()

            # Iterate LOCAL branch days: shifts are defined in local time (M05 UTC/IANA contract).
            # UTC dates were used before, which skipped a late local shift in negative-offset zones.
            current_day = search_from.astimezone(tz).date()
            end_day = search_to.astimezone(tz).date()

            while current_day <= end_day:
                weekday_iso = current_day.isoweekday()

                # Find shift for this staff on this weekday
                stmt_shift = select(WeeklyShift).where(
                    WeeklyShift.tenant_id == tenant_id,
                    WeeklyShift.staff_id == c_staff_id,
                    WeeklyShift.branch_id == branch_id,
                    WeeklyShift.weekday_iso == weekday_iso
                )
                res_shift = await db.execute(stmt_shift)
                shifts = res_shift.scalars().all()

                for shift in shifts:
                    # Shifts in branch local time converted to UTC dynamically
                    shift_start_dt = datetime.datetime.combine(current_day, shift.local_start, tzinfo=tz).astimezone(datetime.timezone.utc)
                    shift_end_dt = datetime.datetime.combine(current_day, shift.local_end, tzinfo=tz).astimezone(datetime.timezone.utc)

                    # Fetch breaks for this shift
                    stmt_breaks = select(ShiftBreak).where(ShiftBreak.shift_id == shift.id)
                    res_breaks = await db.execute(stmt_breaks)
                    breaks = res_breaks.scalars().all()
                    break_intervals = [
                        (
                            datetime.datetime.combine(current_day, b.local_start, tzinfo=tz).astimezone(datetime.timezone.utc),
                            datetime.datetime.combine(current_day, b.local_end, tzinfo=tz).astimezone(datetime.timezone.utc)
                        )
                        for b in breaks
                    ]

                    # Fetch staff occupancies / time off overlapping THIS shift across ANY branch.
                    # (A UTC calendar day missed bookings of shifts crossing UTC midnight.)
                    day_start_utc = shift_start_dt
                    day_end_utc = shift_end_dt

                    stmt_occ = select(StaffOccupancy).where(
                        StaffOccupancy.tenant_id == tenant_id,
                        StaffOccupancy.staff_id == c_staff_id,
                        StaffOccupancy.released_at.is_(None),
                        StaffOccupancy.starts_at_utc < day_end_utc,
                        StaffOccupancy.ends_at_utc > day_start_utc
                    )
                    res_occ = await db.execute(stmt_occ)
                    occupancies = res_occ.scalars().all()
                    occ_intervals = [(o.starts_at_utc, o.ends_at_utc) for o in occupancies]

                    # Fetch staff time off
                    stmt_to = select(StaffTimeOff).where(
                        StaffTimeOff.tenant_id == tenant_id,
                        StaffTimeOff.staff_id == c_staff_id,
                        StaffTimeOff.from_at_utc < day_end_utc,
                        StaffTimeOff.to_at_utc > day_start_utc
                    )
                    res_to = await db.execute(stmt_to)
                    time_offs = res_to.scalars().all()
                    time_off_intervals = [(t.from_at_utc, t.to_at_utc) for t in time_offs]

                    # Step through shift from shift_start_dt to shift_end_dt
                    slot_start = shift_start_dt
                    while slot_start + svc_delta <= shift_end_dt:
                        slot_end = slot_start + svc_delta

                        # Check within search bounds
                        if slot_start >= search_from and slot_end <= search_to:
                            # 1. Check break overlap
                            has_break_conflict = any(
                                max(slot_start, b_start) < min(slot_end, b_end)
                                for b_start, b_end in break_intervals
                            )
                            # 2. Check occupancy overlap
                            has_occ_conflict = any(
                                max(slot_start, o_start) < min(slot_end, o_end)
                                for o_start, o_end in occ_intervals
                            )
                            # 3. Check time off overlap
                            has_to_conflict = any(
                                max(slot_start, t_start) < min(slot_end, t_end)
                                for t_start, t_end in time_off_intervals
                            )

                            if not (has_break_conflict or has_occ_conflict or has_to_conflict) and not persist_quotes:
                                # Preview (time-first): availability only, no quote rows
                                slots.append({
                                    "staff_id": str(c_staff_id),
                                    "staff_name": staff_prof.display_name,
                                    "staff_role": staff_prof.role_title,
                                    "starts_at_utc": slot_start.isoformat(),
                                    "ends_at_utc": slot_end.isoformat(),
                                    "duration_minutes": duration_mins,
                                    "price_minor": price_minor,
                                    "currency": slot_currency,
                                    "quote_id": None,
                                    "quote_expires_at": None
                                })
                            elif not (has_break_conflict or has_occ_conflict or has_to_conflict):
                                # Valid slot! Create and persist authoritative quote
                                quote_id = uuid.uuid4()
                                quote = BookingQuote(
                                    id=quote_id,
                                    tenant_id=tenant_id,
                                    branch_id=branch_id,
                                    staff_id=c_staff_id,
                                    selected_service_ids_ordered=[str(s) for s in service_ids],
                                    starts_at_utc=slot_start,
                                    ends_at_utc=slot_end,
                                    amount_minor=price_minor,
                                    duration_minutes=duration_mins,
                                    pricing_version_hash=hashlib.sha256(f"{price_minor}:{duration_mins}".encode()).hexdigest(),
                                    expires_at=now_utc + datetime.timedelta(minutes=15)
                                )
                                db.add(quote)
                                slots.append({
                                    "staff_id": str(c_staff_id),
                                    "staff_name": staff_prof.display_name,
                                    "staff_role": staff_prof.role_title,
                                    "starts_at_utc": slot_start.isoformat(),
                                    "ends_at_utc": slot_end.isoformat(),
                                    "duration_minutes": duration_mins,
                                    "price_minor": price_minor,
                                    "currency": slot_currency,
                                    "quote_id": str(quote_id),
                                    "quote_expires_at": quote.expires_at.isoformat()
                                })

                        slot_start += datetime.timedelta(minutes=step_minutes)

                current_day += datetime.timedelta(days=1)

        if persist_quotes:
            await db.commit()

        # Ordering:
        # If staff_mode == 'any': 1) earliest start time, 2) lowest price, 3) stable staff UUID
        if staff_mode == "any":
            slots.sort(key=lambda s: (s["starts_at_utc"], s["price_minor"], s["staff_id"]))
        else:
            slots.sort(key=lambda s: s["starts_at_utc"])

        return {
            "slots": slots,
            "total_count": len(slots)
        }

    @classmethod
    async def time_first_preview(
        cls,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        branch_id: uuid.UUID,
        from_utc: datetime.datetime,
        to_utc: datetime.datetime,
    ) -> Dict[str, Any]:
        """Time-first step 1 (M06): start times at which at least one online master is free.

        No service is chosen yet, so each master is checked with his shortest online service in
        this branch: a time is shown only if that master can really start something then.
        Uses the same search as service/master flows, without writing quotes. The exact fit of the
        services chosen afterwards is confirmed by search_availability(at=...) and the booking itself.
        """
        policy = await cls.get_booking_policy(db, tenant_id, branch_id)
        if not policy.allow_online_booking:
            raise BookingEngineError("BOOKING_DISABLED", "Online booking is currently disabled for this location", 403)
        staff_rows = (await db.execute(
            select(StaffProfile.id)
            .join(StaffBranch, and_(StaffBranch.staff_id == StaffProfile.id, StaffBranch.tenant_id == StaffProfile.tenant_id))
            .where(StaffProfile.tenant_id == tenant_id, StaffBranch.branch_id == branch_id,
                   StaffProfile.active == True, StaffProfile.online_bookable == True, StaffBranch.active == True)
        )).scalars().all()

        by_start: Dict[str, set] = {}
        for staff_id in sorted(staff_rows, key=str):
            offers = (await db.execute(
                select(StaffServiceOffer, Service).join(Service, Service.id == StaffServiceOffer.service_id).where(
                    StaffServiceOffer.tenant_id == tenant_id, StaffServiceOffer.staff_id == staff_id,
                    StaffServiceOffer.branch_id == branch_id, StaffServiceOffer.active == True,
                    StaffServiceOffer.online_visible == True, Service.active == True,
                    Service.online_visible == True, Service.archived_at.is_(None))
            )).all()
            if not offers:
                continue

            def effective(pair):
                off, svc = pair
                dur = off.duration_override_minutes if off.duration_override_minutes is not None else svc.base_duration_minutes
                price = off.price_override_minor if off.price_override_minor is not None else svc.base_price_minor
                return (dur, price, str(svc.id))

            shortest = min(offers, key=effective)[1]
            res = await cls.search_availability(
                db, tenant_id, branch_id, [shortest.id], from_utc, to_utc,
                staff_id=staff_id, staff_mode="specific", is_public=True, persist_quotes=False)
            for slot in res["slots"]:
                by_start.setdefault(slot["starts_at_utc"], set()).add(slot["staff_id"])

        slots = [{"starts_at_utc": t, "available_staff_count": len(ids)} for t, ids in sorted(by_start.items())]
        return {"slots": slots, "total_count": len(slots)}

    @classmethod
    async def _claim_idempotency_key(
        cls, db: AsyncSession, tenant_id: uuid.UUID, scope: str, key: str, payload_hash: str, actor: str,
    ):
        """Returns (replay_result, None) for a repeated request, or (None, claimed_record_id)."""
        now = datetime.datetime.now(datetime.timezone.utc)
        new_id = (await db.execute(
            pg_insert(IdempotencyRecord).values(
                id=uuid.uuid4(), scope=scope, tenant_id=tenant_id, actor_or_context_hash=actor,
                idempotency_key=key, request_hash=payload_hash, response_body_redacted="pending",
                response_code=0, created_at=now, expires_at=now + datetime.timedelta(hours=24),
            ).on_conflict_do_nothing().returning(IdempotencyRecord.id)
        )).scalar_one_or_none()
        if new_id is not None:
            return None, new_id

        rec = (await db.execute(select(IdempotencyRecord).where(
            IdempotencyRecord.tenant_id == tenant_id, IdempotencyRecord.scope == scope,
            IdempotencyRecord.idempotency_key == key))).scalar_one()
        if rec.request_hash != payload_hash:
            raise BookingEngineError(
                "IDEMPOTENCY_KEY_REUSED",
                "Idempotency key has already been used with different booking parameters",
                status_code=409
            )
        b = (await db.execute(select(Booking).where(
            Booking.idempotency_key == key, Booking.tenant_id == tenant_id))).scalar_one_or_none()
        if b is None:
            raise BookingEngineError("IDEMPOTENCY_IN_PROGRESS", "The same booking request is still being processed", 409)
        # same request again: the same booking, with a fresh management link (raw tokens are never stored)
        raw_token = secrets.token_urlsafe(32)
        tok = PublicManagementToken(
            tenant_id=tenant_id, booking_id=b.id, token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
            scope="manage_booking", expires_at=b.busy_ends_at_utc + datetime.timedelta(days=7))
        db.add(tok)
        await db.commit()
        return (b, tok, raw_token), None

    @classmethod
    async def _alternatives_near(
        cls, db: AsyncSession, tenant_id: uuid.UUID, branch_id: uuid.UUID, service_ids: List[uuid.UUID],
        around_utc: datetime.datetime, is_public: bool = True, limit: int = 6,
    ) -> List[Dict[str, Any]]:
        """Nearest free starts (any master) on the same local day, for a 409 response. Never raises."""
        try:
            await set_tenant_context(db, tenant_id)
            branch = (await db.execute(select(Branch).where(Branch.id == branch_id))).scalar_one()
            tz = zoneinfo.ZoneInfo(branch.timezone_iana or "Asia/Almaty")
            day = around_utc.astimezone(tz).date()
            day_from = datetime.datetime.combine(day, datetime.time.min, tzinfo=tz).astimezone(datetime.timezone.utc)
            day_to = datetime.datetime.combine(day, datetime.time.max, tzinfo=tz).astimezone(datetime.timezone.utc)
            res = await cls.search_availability(db, tenant_id, branch_id, service_ids, day_from, day_to,
                                                staff_mode="any", is_public=is_public, persist_quotes=False)
            best: Dict[str, Dict[str, Any]] = {}
            for slot in res["slots"]:  # already ordered: time, then price
                best.setdefault(slot["starts_at_utc"], slot)
            nearest = sorted(best.values(), key=lambda x: (
                abs((datetime.datetime.fromisoformat(x["starts_at_utc"]) - around_utc).total_seconds()), x["starts_at_utc"]))
            picked = sorted(nearest[:limit], key=lambda x: x["starts_at_utc"])
            return [{"starts_at_utc": x["starts_at_utc"], "staff_id": x["staff_id"], "staff_name": x["staff_name"],
                     "price_minor": x["price_minor"], "duration_minutes": x["duration_minutes"]} for x in picked]
        except Exception:
            return []

    @classmethod
    async def create_booking(
        cls,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        branch_id: uuid.UUID,
        staff_id: uuid.UUID,
        service_ids: List[uuid.UUID],
        starts_at_utc: datetime.datetime,
        customer_name: str,
        customer_phone_e164: str,
        customer_email: Optional[str] = None,
        notes: Optional[str] = None,
        source: str = "public",  # public or crm_manual
        idempotency_key: Optional[str] = None,
        created_by_user_id: Optional[uuid.UUID] = None,
        quote_id: Optional[uuid.UUID] = None,
        expected_price_minor: Optional[int] = None
    ) -> Tuple[Booking, PublicManagementToken, str]:
        """
        Creates a booking atomically.
        Guarantees:
        - Exclusion constraint on staff_occupancies prevents double booking.
        - Idempotency checks prevent duplicate bookings on network retries and reject reused keys with mismatching payloads.
        - Verification that current price/duration match expected quote.
        - Immediately confirmed status.
        - Outbox event and audit logging.
        """
        await set_tenant_context(db, tenant_id)

        payload_hash = hashlib.sha256(
            f"{tenant_id}:{branch_id}:{staff_id}:{sorted(str(s) for s in service_ids)}:{starts_at_utc.isoformat()}:{customer_phone_e164}".encode()
        ).hexdigest()

        # 1. Idempotency: claim the key in THIS transaction before doing anything else.
        #    A concurrent request with the same key blocks on the unique index until we commit
        #    (then it replays our booking) or roll back (then it books itself). No check-then-insert race.
        claimed_idem_id = None
        if idempotency_key:
            replay, claimed_idem_id = await cls._claim_idempotency_key(
                db, tenant_id, f"{source}_booking", idempotency_key, payload_hash, customer_phone_e164)
            if replay is not None:
                return replay

        # 2. Re-calculate actual duration and price from DB
        duration_mins, actual_price_minor, items_data = await cls.calculate_quote_for_staff(
            db, tenant_id, branch_id, staff_id, service_ids
        )

        # 3. Comprehensive Authoritative Validation (past slot, min advance, shifts, breaks)
        try:
            branch, staff, policy = await cls.validate_slot_and_policies(
                db=db,
                tenant_id=tenant_id,
                branch_id=branch_id,
                staff_id=staff_id,
                service_ids=service_ids,
                starts_at_utc=starts_at_utc,
                duration_minutes=duration_mins,
                is_client=(source == "public")
            )
        except BookingEngineError as e:
            if e.code == "SLOT_CONFLICT":  # taken before we got here: same answer as a lost race
                e.details = {**(e.details or {}), "alternatives": await cls._alternatives_near(
                    db, tenant_id, branch_id, service_ids, starts_at_utc, is_public=(source == "public"))}
            raise

        ends_at_utc = starts_at_utc + datetime.timedelta(minutes=duration_mins)

        # 4. Authoritative Quote Binding (mandatory for public booking)
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        if source == "public" and not quote_id and expected_price_minor is None:
            raise BookingEngineError(
                "QUOTE_REQUIRED",
                "Authoritative booking quote (quote_id) or price confirmation (expected_price_minor) is required for public bookings",
                status_code=400
            )

        if quote_id:
            stmt_q = select(BookingQuote).where(
                BookingQuote.id == quote_id,
                BookingQuote.tenant_id == tenant_id
            )
            res_q = await db.execute(stmt_q)
            quote = res_q.scalar_one_or_none()
            if not quote or quote.expires_at < now_utc or quote.used_at is not None:
                raise BookingEngineError(
                    "QUOTE_EXPIRED",
                    "Selected booking quote has expired or was already used. Please select slot again.",
                    status_code=409,
                    details={"alternatives": await cls._alternatives_near(
                        db, tenant_id, branch_id, service_ids, starts_at_utc, is_public=(source == "public"))}
                )

            # Strict Quote Binding: verify branch, staff, slot start time, and services
            req_service_ids = [str(s) for s in service_ids]
            quote_service_ids = quote.selected_service_ids_ordered or []
            q_start = quote.starts_at_utc.replace(microsecond=0)
            r_start = starts_at_utc.replace(microsecond=0)

            if (
                quote.branch_id != branch_id
                or quote.staff_id != staff_id
                or q_start != r_start
                or quote_service_ids != req_service_ids
            ):
                raise BookingEngineError(
                    "QUOTE_MISMATCH",
                    "Booking parameters (branch, staff, time, or services) do not match the selected quote",
                    status_code=409
                )

            if quote.amount_minor != actual_price_minor or quote.duration_minutes != duration_mins:
                raise BookingEngineError(
                    "QUOTE_CHANGED",
                    f"Service price has updated to {actual_price_minor / 100} KZT. Please re-confirm terms.",
                    status_code=409,
                    details={"new_price_minor": actual_price_minor, "duration_minutes": duration_mins}
                )
            quote.used_at = now_utc

            # Clean up old expired quotes (> 1h)
            one_hour_ago = now_utc - datetime.timedelta(hours=1)
            await db.execute(
                delete(BookingQuote).where(
                    BookingQuote.tenant_id == tenant_id,
                    BookingQuote.expires_at < one_hour_ago
                )
            )

        if expected_price_minor is not None and expected_price_minor != actual_price_minor:
            raise BookingEngineError(
                "QUOTE_CHANGED",
                f"Service price has updated to {actual_price_minor / 100} KZT. Please re-confirm terms.",
                status_code=409,
                details={"new_price_minor": actual_price_minor, "duration_minutes": duration_mins}
            )

        # 4. Customer resolution or creation (tenant scoped)
        phone_digits = "".join(filter(str.isdigit, customer_phone_e164))
        stmt_cust = select(Customer).where(
            Customer.tenant_id == tenant_id,
            Customer.phone_e164 == customer_phone_e164
        )
        res_cust = await db.execute(stmt_cust)
        customer = res_cust.scalar_one_or_none()

        if not customer:
            customer = Customer(
                tenant_id=tenant_id,
                full_name=customer_name,
                phone_e164=customer_phone_e164,
                phone_digits_index=phone_digits,
                email=customer_email,
                notes_private=notes if source == "crm_manual" else None,
                data_source=source,
                marketing_consent=False
            )
            db.add(customer)
            await db.flush()

        # 5. Generate public reference
        # 5. Generate public reference with tenant-specific prefix
        stmt_t = select(Tenant.slug).where(Tenant.id == tenant_id)
        res_t = await db.execute(stmt_t)
        t_slug = res_t.scalar_one_or_none() or "BK"
        if "modern" in t_slug.lower():
            prefix = "MC"
        elif "barber" in t_slug.lower():
            prefix = "BH"
        else:
            clean_slug = "".join(filter(str.isalnum, t_slug)).upper()
            prefix = clean_slug[:2] if len(clean_slug) >= 2 else "BK"
        ref_code = f"{prefix}-{secrets.randbelow(900000) + 100000}"

        # 6. Insert Booking
        booking = Booking(
            tenant_id=tenant_id,
            branch_id=branch_id,
            staff_id=staff_id,
            customer_id=customer.id,
            source=source,
            status="confirmed",
            starts_at_utc=starts_at_utc,
            service_ends_at_utc=ends_at_utc,
            busy_ends_at_utc=ends_at_utc,
            timezone_snapshot=branch.timezone_iana or "Asia/Almaty",
            currency="KZT",
            amount_minor_snapshot=actual_price_minor,
            public_ref=ref_code,
            idempotency_key=idempotency_key,
            created_by_user_id=created_by_user_id
        )
        db.add(booking)
        await db.flush()

        # 6. Insert Booking Items
        for item in items_data:
            b_item = BookingItem(
                tenant_id=tenant_id,
                booking_id=booking.id,
                service_id=item["service_id"],
                sequence=item["sequence"],
                service_name_snapshot=item["service_name"],
                duration_minutes_snapshot=item["duration_minutes"],
                price_minor_snapshot=item["price_minor"],
                currency_snapshot=item["currency"]
            )
            db.add(b_item)

        # 7. Insert Staff Occupancy (Protected by PostgreSQL EXCLUDE constraint)
        occupancy = StaffOccupancy(
            tenant_id=tenant_id,
            staff_id=staff_id,
            branch_id=branch_id,
            booking_id=booking.id,
            starts_at_utc=starts_at_utc,
            ends_at_utc=ends_at_utc,
            occupancy_type="booking"
        )
        db.add(occupancy)

        try:
            # Flush will trigger the exclusion constraint immediately if another transaction committed this interval!
            await db.flush()
        except (IntegrityError, DBAPIError) as exc:
            await db.rollback()
            if "staff_occupancy_no_overlap" not in str(exc):
                raise  # a different DB error must not be reported as "slot taken"
            raise BookingEngineError(
                "SLOT_CONFLICT",
                "The selected time slot was just booked by another customer. Please select another time.",
                status_code=409,
                details={"alternatives": await cls._alternatives_near(
                    db, tenant_id, branch_id, service_ids, starts_at_utc, is_public=(source == "public"))}
            )

        # 8. Insert Booking Event
        event = BookingEvent(
            tenant_id=tenant_id,
            booking_id=booking.id,
            event_type="created",
            actor_type="customer" if source == "public" else "staff",
            actor_id=created_by_user_id,
            new_json_sanitized={
                "status": "confirmed",
                "starts_at_utc": starts_at_utc.isoformat(),
                "amount_minor": actual_price_minor
            }
        )
        db.add(event)

        # 9. Management Token for Customer Self-Service
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        mgmt_token = PublicManagementToken(
            tenant_id=tenant_id,
            booking_id=booking.id,
            token_hash=token_hash,
            scope="manage_booking",
            expires_at=ends_at_utc + datetime.timedelta(days=7)
        )
        db.add(mgmt_token)

        # 10. Outbox Event for Notifications
        outbox = OutboxEvent(
            tenant_id=tenant_id,
            event_type="booking.created",
            aggregate_id=str(booking.id),
            payload_sanitized={
                "booking_id": str(booking.id),
                "public_ref": ref_code,
                "customer_phone": customer_phone_e164,
                "starts_at_utc": starts_at_utc.isoformat(),
                "amount_minor": actual_price_minor
            }
        )
        db.add(outbox)

        # 11. Idempotency Record: the key claimed in step 1 now points at the created booking
        if claimed_idem_id is not None:
            await db.execute(
                update(IdempotencyRecord).where(IdempotencyRecord.id == claimed_idem_id)
                .values(response_body_redacted=f"booking_ref:{ref_code}", response_code=201)
            )

        await db.commit()
        return booking, mgmt_token, raw_token

    @classmethod
    async def cancel_booking(
        cls,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        booking_id: uuid.UUID,
        reason: str = "Client cancellation",
        is_client: bool = True
    ) -> Booking:
        """
        Cancels a booking and releases the staff occupancy atomically.
        """
        await set_tenant_context(db, tenant_id)
        stmt = select(Booking).where(Booking.id == booking_id, Booking.tenant_id == tenant_id)
        res = await db.execute(stmt)
        booking = res.scalar_one_or_none()
        if not booking:
            raise BookingEngineError("BOOKING_NOT_FOUND", "Booking not found", 404)

        if booking.status != "confirmed":
            raise BookingEngineError("INVALID_BOOKING_STATUS", f"Cannot cancel booking in '{booking.status}' status", 409)

        # Policy cutoff check for client cancellation
        if is_client:
            policy = await cls.get_booking_policy(db, tenant_id, booking.branch_id)
            cutoff = datetime.timedelta(minutes=policy.cancellation_cutoff_minutes)
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            if booking.starts_at_utc - now_utc < cutoff:
                raise BookingEngineError(
                    "CANCEL_CUTOFF_EXCEEDED",
                    f"Self-cancellation is allowed only up to {policy.cancellation_cutoff_minutes // 60} hours before appointment.",
                    status_code=409
                )

        now_utc = datetime.datetime.now(datetime.timezone.utc)
        booking.status = "cancelled"
        booking.cancelled_at = now_utc
        booking.cancellation_reason = reason

        # Release occupancy
        stmt_occ = select(StaffOccupancy).where(
            StaffOccupancy.booking_id == booking.id,
            StaffOccupancy.released_at.is_(None)
        )
        res_occ = await db.execute(stmt_occ)
        occupancies = res_occ.scalars().all()
        for occ in occupancies:
            occ.released_at = now_utc

        # Record event
        event = BookingEvent(
            tenant_id=tenant_id,
            booking_id=booking.id,
            event_type="cancelled",
            actor_type="customer" if is_client else "staff",
            new_json_sanitized={"status": "cancelled", "reason": reason}
        )
        db.add(event)

        # Outbox event
        outbox = OutboxEvent(
            tenant_id=tenant_id,
            event_type="booking.cancelled",
            aggregate_id=str(booking.id),
            payload_sanitized={"booking_id": str(booking.id), "reason": reason}
        )
        db.add(outbox)

        await db.commit()
        return booking

    @classmethod
    async def reschedule_booking(
        cls,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        booking_id: uuid.UUID,
        new_starts_at_utc: datetime.datetime,
        new_staff_id: Optional[uuid.UUID] = None,
        is_client: bool = True
    ) -> Booking:
        """
        Reschedules an appointment atomically:
        - Releases old occupancy
        - Takes new occupancy
        - If conflict occurs on target interval, transaction rolls back and retains old booking intact!
        """
        await set_tenant_context(db, tenant_id)
        stmt = select(Booking).where(Booking.id == booking_id, Booking.tenant_id == tenant_id)
        res = await db.execute(stmt)
        booking = res.scalar_one_or_none()
        if not booking:
            raise BookingEngineError("BOOKING_NOT_FOUND", "Booking not found", 404)

        if booking.status != "confirmed":
            raise BookingEngineError("INVALID_BOOKING_STATUS", f"Cannot reschedule booking in status '{booking.status}'", 409)

        now_utc = datetime.datetime.now(datetime.timezone.utc)
        policy = await cls.get_booking_policy(db, tenant_id, booking.branch_id)

        # Policy checks for client self-service
        if is_client:
            if not policy.allow_self_reschedule:
                raise BookingEngineError("SELF_RESCHEDULE_NOT_ALLOWED", "Self-service reschedule is disabled", 403)
            cutoff = datetime.timedelta(minutes=policy.cancellation_cutoff_minutes)
            if (booking.starts_at_utc - now_utc) < cutoff:
                raise BookingEngineError("CANCEL_CUTOFF_EXCEEDED", f"Reschedule cutoff of {policy.cancellation_cutoff_minutes} minutes has passed", 409)

        target_staff_id = new_staff_id or booking.staff_id

        # Recalculate quote and services for target staff
        stmt_it = select(BookingItem).where(BookingItem.booking_id == booking.id).order_by(BookingItem.sequence)
        res_it = await db.execute(stmt_it)
        items = res_it.scalars().all()
        service_ids = [it.service_id for it in items]

        duration_mins, new_price_minor, _ = await cls.calculate_quote_for_staff(
            db, tenant_id, booking.branch_id, target_staff_id, service_ids
        )
        new_ends_at_utc = new_starts_at_utc + datetime.timedelta(minutes=duration_mins)

        # Validate slot, shifts, breaks, and horizon
        await cls.validate_slot_and_policies(
            db=db,
            tenant_id=tenant_id,
            branch_id=booking.branch_id,
            staff_id=target_staff_id,
            service_ids=service_ids,
            starts_at_utc=new_starts_at_utc,
            duration_minutes=duration_mins,
            is_client=is_client,
            ignore_booking_id=booking.id
        )

        # Release old occupancy
        stmt_occ = select(StaffOccupancy).where(
            StaffOccupancy.booking_id == booking.id,
            StaffOccupancy.released_at.is_(None)
        )
        res_occ = await db.execute(stmt_occ)
        old_occupancies = res_occ.scalars().all()
        for o in old_occupancies:
            o.released_at = now_utc

        # Insert new occupancy
        new_occupancy = StaffOccupancy(
            tenant_id=tenant_id,
            staff_id=target_staff_id,
            branch_id=booking.branch_id,
            booking_id=booking.id,
            starts_at_utc=new_starts_at_utc,
            ends_at_utc=new_ends_at_utc,
            occupancy_type="booking"
        )
        db.add(new_occupancy)

        try:
            await db.flush()
        except (IntegrityError, DBAPIError):
            await db.rollback()
            raise BookingEngineError(
                "SLOT_CONFLICT",
                "The requested reschedule interval is already occupied. Original booking remains active.",
                status_code=409
            )

        # Update booking
        old_start = booking.starts_at_utc
        booking.starts_at_utc = new_starts_at_utc
        booking.service_ends_at_utc = new_ends_at_utc
        booking.busy_ends_at_utc = new_ends_at_utc
        booking.staff_id = target_staff_id
        booking.amount_minor_snapshot = new_price_minor
        booking.version += 1

        # Event
        event = BookingEvent(
            tenant_id=tenant_id,
            booking_id=booking.id,
            event_type="rescheduled",
            actor_type="customer" if is_client else "staff",
            old_json_sanitized={"starts_at_utc": old_start.isoformat()},
            new_json_sanitized={"starts_at_utc": new_starts_at_utc.isoformat(), "version": booking.version}
        )
        db.add(event)

        # Outbox
        outbox = OutboxEvent(
            tenant_id=tenant_id,
            event_type="booking.rescheduled",
            aggregate_id=str(booking.id),
            payload_sanitized={
                "booking_id": str(booking.id),
                "starts_at_utc": new_starts_at_utc.isoformat()
            }
        )
        db.add(outbox)

        await db.commit()
        return booking
