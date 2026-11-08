# Multi-Tenant SaaS Architecture Specification

## 1. Executive Summary & Topology
The platform is a multi-tenant B2B SaaS system serving three independent user surfaces on a single modular backend and PostgreSQL database:
1. **Public Client Booking**: High-traffic customer-facing web application hosted on custom domains and subdomains (e.g. `barberhouse.book.example.kz`).
2. **Business CRM**: Daily operational workspace for company staff (owners, administrators, masters/barbers) on a shared business application domain (`crm.platform.example.kz`).
3. **Platform Console**: Internal administrative workspace for platform operators, support engineers, and billing controllers (`admin.platform.example.kz`).

```
+-----------------------------------+  +-----------------------------------+  +-----------------------------------+
|     Public Client Booking Web     |  |       Business CRM Web (SPA)      |  |      Platform Console (Admin)     |
|   (Custom Domain / Subdomain)     |  |   (crm.platform.example.kz)       |  |   (admin.platform.example.kz)     |
+-----------------+-----------------+  +-----------------+-----------------+  +-----------------+-----------------+
                  |                                      |                                      |
                  | Host header / Slug                   | JWT + X-Tenant-ID                    | JWT (PlatformStaff)
                  v                                      v                                      v
          +---------------------------------------------------------------------------------------------+
          |                             FastAPI Modular Unified Backend                                 |
          |  - RequestId & Security Headers Middleware                                                  |
          |  - Public Domain Resolver (tenant_domains / booking_publications)                           |
          |  - CRM & Platform RBAC Dependency Guards                                                    |
          |  - Unified BookingEngine (Quotes, Slots, Concurrency Control)                               |
          +----------------------------------------------+----------------------------------------------+
                                                         |
                                       Pool: NullPool (asyncpg)
                                       Role: crm_app_user (NOSUPERUSER, NOBYPASSRLS)
                                                         v
          +---------------------------------------------------------------------------------------------+
          |                               PostgreSQL 17 Data Store                                      |
          |  +------------------------------------+      +-------------------------------------------+  |
          |  |       Control Plane Schema         |      |           Data Plane Schema               |  |
          |  |  - tenants                         |      |  - customers, customer_notes              |  |
          |  |  - tenant_domains                  |      |  - branches, staff_profiles, staff_shifts |  |
          |  |  - plans & plan_versions           |      |  - services, staff_service_offers         |  |
          |  |  - plan_entitlements               |      |  - bookings, booking_items, events        |  |
          |  |  - subscriptions & billing_charges |      |  - staff_occupancies (GiST EXCLUSION)     |  |
          |  |  - platform_staff & audit_logs     |      |  - booking_policies, public_mgmt_tokens   |  |
          |  +------------------------------------+      +-------------------------------------------+  |
          |                                                                                             |
          |  PostgreSQL Row-Level Security (RLS) FORCED on all 22 tenant-isolated tables                |
          |  `tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid`                 |
          +---------------------------------------------------------------------------------------------+
```

---

## 2. Multi-Tenant Isolation Model

### 2.1 Shared Database, Shared Schema with Defense-in-Depth
Tenant isolation operates simultaneously at three distinct security layers:
1. **Application Layer (FastAPI Dependencies & Services)**:
   - Every CRM request validates the user's active membership in `tenant_memberships` for the target `tenant_id`.
   - Every public booking request resolves the incoming `Host` header against `tenant_domains`.
   - All queries explicitly inject `tenant_id == active_tenant_id` in ORM statements.
2. **Database Session Layer (PostgreSQL Session Variable)**:
   - Upon authentication or domain resolution, the backend executes:
     `SELECT set_config('app.current_tenant', :tenant_id, false);`
   - Connections run as `crm_app_user`, which has `NOSUPERUSER` and `NOBYPASSRLS`.
3. **Database Engine Layer (Row Level Security & Composite FKs)**:
   - RLS is enabled and **FORCED** (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`) across all 22 tenant-scoped tables.
   - Composite foreign keys enforce that parent-child relationships cannot cross tenant boundaries (e.g., `FOREIGN KEY (tenant_id, staff_id) REFERENCES staff_profiles(tenant_id, id)`).

### 2.2 Threat Model & Prevention Matrix
| Threat Scenario | Attack Vector | Prevention Mechanism | Status |
| :--- | :--- | :--- | :--- |
| **IDOR Cross-Tenant Read** | Attacker passes another company's UUID in URL path | PostgreSQL RLS filters out rows; query returns empty/404 | **PASS** (Verified by automated tests) |
| **Cross-Tenant Entity Hijack** | Attacker links Master from Company A to Booking in Company B | Composite FK `(tenant_id, staff_id)` violates constraint | **PASS** (Verified by automated tests) |
| **Host Header Spoofing** | Attacker sends arbitrary Host header to public endpoint | Strict lookup in `tenant_domains`; returns 404 SITE_NOT_FOUND | **PASS** (Verified by automated tests) |
| **Token Brute-Force** | Guessing client management links | 256-bit entropy token; SHA-256 hashed in DB; rate limited | **PASS** (Verified by automated tests) |
| **Superuser Bypass** | Database user bypasses RLS policies | App connects strictly as `crm_app_user` with NOBYPASSRLS | **PASS** (Verified by automated tests) |

---

## 3. High-Concurrency Double-Booking Prevention

### 3.1 PostgreSQL Exclusion Constraints (GiST)
To guarantee zero double-booking under extreme parallel booking races without relying on fragile application-level locks, the engine utilizes PostgreSQL's `btree_gist` extension:
```sql
ALTER TABLE staff_occupancies
ADD CONSTRAINT staff_occupancy_no_overlap
EXCLUDE USING gist (
    tenant_id WITH =,
    staff_id WITH =,
    tstzrange(starts_at_utc, ends_at_utc, '[)') WITH &&
) WHERE (released_at IS NULL);
```
- Every confirmed booking and calendar block inserts an occupancy interval `[starts_at_utc, ends_at_utc)` into `staff_occupancies`.
- If two transactions commit overlapping intervals for the same master at the exact same millisecond, PostgreSQL rejects the second transaction with an `ExclusionViolationError` (or deadlock error).
- The `BookingEngine` translates this error to HTTP `409 Conflict` with error code `SLOT_CONFLICT`.

---

## 4. Asynchronous Outbox Pattern
Transactional mutations (new bookings, reschedules, cancellations) write an event record to `outbox_events` within the same database transaction:
- **`outbox_events`**: Stores sanitized payload, event type, aggregate ID, and retry status.
- Prevents split-brain state where a database booking is committed but SMS/email notifications fail or vice-versa.
- Background worker processes outbox events asynchronously with exponential backoff.
