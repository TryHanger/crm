# Multi-Tenant SaaS Platform Backend (Online Booking & CRM)

Production-grade modular backend powering three independent frontend experiences:
1. **Public Client Booking** (Tenant subdomains and custom CNAME domains).
2. **Business CRM** (Daily workspace for owners, administrators, and masters).
3. **Platform Console** (Internal platform operations, subscriptions, and billing).

---

## 🚀 Key Architectural Highlights
- **Strict Tenant Isolation**: PostgreSQL Row Level Security (RLS) forced across all 22 tenant-scoped tables + composite foreign keys.
- **Role Isolation**: Runtime queries execute strictly as non-superuser `crm_app_user` (`NOSUPERUSER`, `NOBYPASSRLS`). Migrations and DDL use administrative credentials.
- **Double-Booking Prevention**: PostgreSQL `btree_gist` exclusion constraint on `staff_occupancies` guaranteeing mathematical zero-overlap for active bookings and calendar blocks under extreme parallel concurrency.
- **Atomic Booking Engine**: Multi-service quotes with individual master overrides, quote price-drift protection (`409 QUOTE_CHANGED`), and race-condition handling (`409 SLOT_CONFLICT`).
- **Subscription Lifecycle**: 14-day trial, 7-day grace period, `expired_pending_action`, and manual suspension/reactivation with CRM read-only safeguards.
- **Manual Billing Ledger**: Evidence-backed payments with bank transaction references and idempotency replay protection.
- **Support Assistance Consent**: Platform support access strictly gated by company owner approval with a 30-minute maximum TTL and audit logging.

---

## 📁 Repository Structure
```
├── alembic/                          # Alembic schema migrations
├── apps/
│   └── api/                          # FastAPI Backend Application
│       ├── app/
│       │   ├── api/v1/               # Public, Business CRM, and Platform route handlers
│       │   ├── core/                 # Settings and configuration
│       │   ├── infrastructure/       # DB session, models, security, and domain resolver
│       │   └── modules/              # Unified BookingEngine and Pydantic v2 schemas
│       └── tests/                    # Comprehensive automated pytest suite
├── docs/                             # Architecture, ERD, Decisions, and Runbooks
│   ├── architecture.md               # Topology, multi-tenancy, and threat model
│   ├── db_schema.md                  # Complete 42-table ERD and RLS policies
│   ├── booking_engine.md             # Availability algorithm and concurrency engine
│   ├── auth_roles.md                 # RBAC matrix and support consent protocol
│   ├── subscriptions.md              # Subscription state machine and ledger
│   ├── deployment.md                 # Docker runbook and environment variables
│   ├── design_inventory.md           # Prototype UI mapping matrix
│   ├── DECISIONS.md                  # Prototype contradiction resolutions
│   ├── KNOWN_LIMITATIONS.md          # Honest boundaries and Phase 2 roadmap
│   └── TEST_REPORT.md                # Automated test execution evidence
├── packages/
│   └── api-contracts/                # Exported OpenAPI 3.1 specification
├── docker-compose.yml                # Container orchestration
├── Dockerfile                        # Multi-stage production container
├── Makefile                          # Development and testing shortcut tasks
└── pyproject.toml                    # Python project dependencies
```

---

## 🛠 Quick Start (Docker Compose)
```bash
# 1. Start PostgreSQL and API service
docker compose up -d

# 2. Check service health
curl http://localhost:8000/health/ready
```
API Documentation will be accessible at: `http://localhost:8000/docs`

---

## 🧪 Running Automated Tests
```bash
# Execute complete test suite (11 critical tests)
pytest apps/api/tests/ -v
```

### Verified Test Suites:
1. `test_tenant_isolation.py`: Cross-tenant RLS isolation & composite FK boundary checks.
2. `test_booking_concurrency.py`: Parallel booking race conditions, exclusion constraints, quote versioning.
3. `test_crm_api.py`: Calendar view, master role isolation, manual CRM booking, customer duplicate detection.
4. `test_platform_api.py`: Platform overview, dynamic tenant onboarding, suspension/reactivation, manual billing ledger.
5. `test_public_api.py`: Host resolution, dynamic policies, public booking flow, and cryptographic management links.
6. `test_roles_permissions.py`: CRM vs Platform permission barriers and unauthorized role rejections.
