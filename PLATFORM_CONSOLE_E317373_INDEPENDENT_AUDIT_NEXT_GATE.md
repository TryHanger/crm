# Platform Console V1 — independent audit and required next gate

**Repository:** https://github.com/TryHanger/crm
**Reviewed branch:** `feat/platform-console-v1`
**Reviewed SHA:** `e31737302a4e693d95bbb68cbc507808d50bde3d`
**GitHub Actions:** https://github.com/TryHanger/crm/actions/runs/42519672987 — **FAILURE**
**Disposition:** Backend core exists; Platform Console V1 **NOT ACCEPTED** yet. Continue DEV only, no production deployment, no merge to `main`.

## Verified facts

- 32/32 backend pytest PASS in Actions; database and migrations worked in this run.
- `npm ci` stopped with `EUSAGE`: `@crm/platform-console@1.0.0` missing from `package-lock.json`; all frontend builds and Playwright runs SKIPPED. Claimed 24/24 E2E in CI is **not supported** by this run; any local result must be submitted with reproducible logs.
- Separate `apps/platform-console` frontend, eight modules, Platform API and screenshots exist in GitHub.
- `docs/PLATFORM_CONSOLE_DESIGN_API_MATRIX.md` claims 32/32 DONE, but two critical statements are inconsistent with actual code: mobile bottom navigation and tenant-owner approval of support access.

## Mandatory P0 fixes

### P0-01 — Reproducible CI and versioned dependencies
- Update and commit `package-lock.json` for the new npm workspace using the repository's Node/npm versions; validate clean `npm ci`, `npm run build --workspaces`, and Playwright on Linux GitHub Actions.
- Do not change CI to bypass `npm ci` or silently omit platform tests. Inspect and fix actual test failures if they appear after dependency installation.
- Acceptance: green GitHub Actions at new SHA; exact 32+ backend test count and 24+ E2E count from job log, without skip/condition bypass.

### P0-02 — Owner-approved and enforced support session, not self-approval
- Current: `apps/api/app/api/v1/platform/routes.py` `approve_access_request`: allowed to both `platform_owner` and `support`. It writes `approved_by=staff.user.id` and opens 30-minute session directly. `SupportModule.tsx` renders approve button for support.
- Remove self-approval. Requester/support/platform owner **must not impersonate tenant owner approval**. Add a tenant-owner-authenticated approve/deny endpoint (scoped to owner membership for the exact tenant), one-time decision with state validation, expiry validation, and audit; enforce a separate authorization boundary for reading tenant data.
- If real delegated read-only tenant access cannot be implemented now, disable the feature and accurately label it `PARTIAL` / `NOT AVAILABLE`; a banner is not evidence of granted RLS-scoped access. Never let an unapproved/expired/revoked session grant data access.
- Acceptance: support creates request => `pending`; support calls approve endpoint => 403; unrelated tenant owner => 403; exact tenant owner approves => 200 and only scoped limited session; duplicate/expired/denied => 409/403; revoke and TTL automatically block all subsequent tenant access; complete audit trail. Test using 2 tenants and separate real identities, including direct HTTP calls.

### P0-03 — Secure platform staff onboarding and demo credentials
- Current backend `POST /api/v1/platform/staff` creates an IdentityUser with `req.password or "Password123!"`. Frontend new staff modal pre-fills `Password123!` in a **text** input. PlatformLoginPage has public quick-logins using the same password.
- Remove known default password from all ordinary code paths. Use a secure one-time invite/activation with expiry and token hashing; never return a plaintext password, and do not upgrade existing CRM user to platform staff without verified authorized operator action and audit.
- DEV quick-login should be completely excluded from production build/rendering using robust environment gates; no production default demo accounts and no known credential assumptions. Mask password input if a password entry remains at all.
- Acceptance: no platform staff account with known default password; new operator sets secret via one-time activation; expired/reused token rejected; regular CRM identity cannot gain platform privileges; no quick-login in production build.

### P0-04 — Payment integrity and safe renewal lifecycle
- Current `SubscriptionsModule.tsx` defaults `record_payment=true` and fabricates `Платёжное поручение № XXXX` in renewal/payment modals. These are not valid payment evidence. Backend `renew_subscription` may mark a charge `paid` and unsuspend a company without separate suspension review; `record_payment` accepts overpayments, optional/weak idempotency, and replay with unrelated payload.
- Default renewal to **extend access only**, unless authenticated finance user explicitly records a verified payment with an actual evidence reference from an external statement; never invent evidence. Separate lifecycle, invoice/charge, and payment operations in both UI and API.
- Stop automatic reactivation for a company suspended manually for policy/security. Restoration must require explicit authorized action and reason.
- Payment recording: require stable idempotency key bound to `(charge_id, amount, currency, evidence, method)` and reject payload mismatch; use row locking/transaction to prevent concurrent double payments; reject unsupported overpayment (or implement explicit credit/refund semantics); audit charge issuance and payment corrections.
- Acceptance: renewal-without-payment does not increment confirmed revenue, does not forge payment evidence, and does not reactivate manually suspended company; genuine partial payment remains partially paid; duplicate key/same payload replays; duplicate key/different payload 409; racing two payments cannot exceed invoice total.

### P0-05 — Functional mobile console or an explicit desktop-only policy
- Screenshot `docs/screenshots/platform-11-mobile-overview.png` at 390px shows a permanent 240px sidebar and clipped page. `PlatformLayout.tsx` has fixed-width sidebar and no implemented responsive navigation despite `mobileMenuOpen` state.
- Recreate original design's mobile header/bottom navigation or drawer, preserving all critical actions; no page-wide horizontal overflow at 320, 360, 390px. Tables may use localized scroll with labels and keyboard access.
- Acceptance: Playwright viewport screenshots and assertions for all eight modules; navigation and logout work at 390px; no clipped KPI buttons/cards; body scroll width <= viewport width.

## P1 data, correctness and test quality

1. `tests/e2e/platform.spec.ts` P7 wraps approval/session checks in `if (await approveBtns.count() > 0)`, making required behavior optional. Replace with unconditional assertions; write an E2E using a real tenant owner approval and enforce direct API denials.
2. Billing E2E P5 only clicks renewal and visits ledger; it does not confirm actual payment event, partial/full accounting, database state, or idempotency. Add assertions using API+PostgreSQL and page.reload.
3. Role E2E P9 asserts buttons are hidden but does not make forbidden direct API calls. Test HTTP 403 for role `viewer`, `support`, `finance`, CRM owner on all sensitive endpoint families.
4. New plan version E2E only checks a toast. Assert created version persists, older tenant subscription retains old `plan_version_id`, newly chosen plan changes only with explicit policy; show clear effective-date policy (current code has no effective_at).
5. Screenshots `platform-05-subscriptions-ledger.png` and `platform-08-support-diagnosis-session.png` show **loading**. Capture loaded non-empty state or a genuine no-data state, with verifiable record IDs; include modal states and full role-specific UI.
6. `GET /support/diagnosis/{tenant_id}` returns `db_status="healthy"` as a constant. Mark as `not_checked` or execute an actual health check; do not claim verified RLS/DB health without a probe.
7. Validate lifecycle invariants for trial/grace/expired/suspension and tenant access via Public Booking + CRM. Do not equate payment status, entitlement status and subscription lifecycle.
8. Fix stale route/role claims and design matrix: mobile bottom tabs not present, support owner approval not present, `24/24 CI` not yet run. Mark DONE/PARTIAL/BLOCKED accurately with exact code/test links.

## Required deliverables

- Feature branch `fix/platform-console-v1-audit-gate` off verified SHA above; commits and push permitted **only to new feature branch**, no force-push, no main merge, no production deploy.
- Updated code, lockfile, migrations if necessary, API client/contract, backend tests and robust Playwright E2E.
- Full green CI URL with exact test counts, commit SHA, screenshots after data loaded (desktop/mobile), test logs, role × endpoint negative test matrix.
- Updated design/API matrix with honestly marked DONE/PARTIAL/BLOCKED, documented limitations and reversible migration/rollback instructions.
- Complete audit ZIP containing modified source, lockfiles, dependencies, tests, git diff/status, logs, screenshots, SHA and instructions to reproduce on clean environment.

**Do not declare platform ready for public pilot or live billing until all P0 items are independently verified.**
