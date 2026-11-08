# Unified Booking Engine Specification

## 1. Core Architecture Principles
The Booking Engine is a centralized, transaction-safe service used uniformly across:
1. Public Online Booking (web subdomains / CNAME domains).
2. Business CRM (manual booking by administrators and masters).
3. Client self-service rescheduling and cancellations via management links.

It guarantees:
- **Zero Double-Booking**: Enforced by database GiST exclusion constraints (`staff_occupancies`).
- **Quote Versioning & Price Drift Protection**: Quotes snapshot total price and duration. Any master or service price modification before booking returns `409 QUOTE_CHANGED`.
- **Individual Master Pricing & Durations**: Supports per-master overrides via `staff_service_offers` that supersede base catalog values.
- **Deterministic Multi-Master Ranking**: Public slot search for "Any Master" sorts candidates deterministically: `Earliest Start -> Lowest Price -> Master UUID`.
- **Dynamic Policy Enforcement**: Real-time evaluation of cancellation cutoff (e.g. 180 minutes), advance booking limits, and self-service reschedule permissions.

---

## 2. Multi-Service Availability Algorithm

### Step 1: Effective Quote Calculation
Given a target branch, candidate master, and ordered list of service IDs:
1. For each service, check `staff_service_offers` for an active override.
2. If override exists, use `price_override_minor` and `duration_override_minutes`.
3. If no override exists, fallback to `services.base_price_minor` and `base_duration_minutes`.
4. Sum durations: $D_{total} = \sum D_i$.
5. Sum prices: $P_{total} = \sum P_i$.

### Step 2: Working Shifts & Occupancy Intersection
For candidate master on target date:
1. Query `staff_shifts` for day of week. If no active shift, master is unavailable.
2. Generate candidate slot boundaries starting every 15 minutes (or branch step): $[T_{start}, T_{start} + D_{total})$.
3. Check slot bounds against shift hours: $T_{start} \ge Shift_{start}$ and $T_{start} + D_{total} \le Shift_{end}$.
4. Query `staff_occupancies` for any overlapping interval where `released_at IS NULL`:
   $$[T_{start}, T_{start} + D_{total}) \cap [Occupancy_{start}, Occupancy_{end}) \ne \emptyset$$
5. If no overlap and advance notice policy is satisfied ($T_{start} - Now \ge MinAdvance$), the slot is valid.

### Step 3: Multi-Master Aggregation
If the user selects "Any Master":
1. The engine computes valid slots for all active masters assigned to the branch who offer all requested services.
2. For each unique start time $T_{start}$, multiple masters may be free.
3. The engine picks the best master according to:
   1. Lowest total price minor.
   2. Tie-breaker: Master ID UUID lexical order.

---

## 3. Atomic Booking Creation Lifecycle

```
[Client / CRM] ---> POST /bookings with {staff_id, service_ids, starts_at_utc, expected_price_minor}
                          |
                          v
        1. Recalculate Quote (Fresh DB state)
        2. Check expected_price_minor == current_price_minor?
              |-- NO  --> Return HTTP 409 QUOTE_CHANGED
              |-- YES
                  v
        3. Insert Customer (or find by normalized phone within tenant)
        4. Insert Booking (status = 'confirmed', snapshots = price & duration)
        5. Insert BookingItems (ordered service snapshots)
        6. Insert StaffOccupancy interval [starts_at_utc, ends_at_utc)
              |
              +---> [PostgreSQL Exclusion Constraint Check]
                         |-- Overlap detected --> Rollback transaction & Return HTTP 409 SLOT_CONFLICT
                         |-- Success
                              v
        7. Insert OutboxEvent ("booking.confirmed")
        8. Generate cryptographic PublicManagementToken (SHA-256 hashed in DB)
        9. Commit Transaction & Return 201 Created with management_token
```

---

## 4. Self-Service Reschedule & Cancellation Flow
When a customer accesses `/api/v1/public/manage/{token}`:
1. Token is securely verified via `lookup_public_management_token` (SECURITY DEFINER).
2. Tenant RLS context is set.
3. Booking and dynamic `booking_policies` are loaded:
   - **Cancellation Allowed**: If status is `confirmed` and $(T_{start} - Now) \ge cancellation\_cutoff\_minutes$ (e.g. 180 min).
   - **Reschedule Allowed**: If status is `confirmed` and `allow_self_reschedule` is `true`.
4. **On Reschedule**:
   - Releases old `staff_occupancy` (`released_at = NOW()`).
   - Inserts new `staff_occupancy` for new time.
   - Updates `booking.starts_at_utc` and records `booking_event`.
5. **On Cancellation**:
   - Updates status to `cancelled`.
   - Sets `cancellation_reason` and records `booking_event`.
   - Releases `staff_occupancy` so the slot immediately becomes bookable by other customers.
