# Independent code audit — Business CRM V1

**Source:** `TryHanger/crm`, branch `feat/business-crm-full-v1`, HEAD `c284e921acdc31de340edea470b5a00b036d0f86`. Audited 2026-11-08.

## Verdict

**NOT ACCEPTED / DEV continuation only.** The implementation is substantive: seven CRM modules, app shell, expanded API and PostgreSQL-backed operations exist. However, GitHub Actions for the exact HEAD failed, the 31/31 checklist is not reliable, and actual code review identified access-control, invitation, time-zone, multi-branch and contract flaws. Do not merge to main, describe as production-ready, open public booking or start Platform Console until this gate is closed.

### Independently verified CI

- Latest head workflow: https://github.com/TryHanger/crm/actions/runs/42502805055 — **failure**.
- Previous workflow: https://github.com/TryHanger/crm/actions/runs/42502771151 — **failure**.
- Latest workflow: 29/29 backend pytest passed; TypeScript/Vite workspace builds passed; Playwright **5 passed, 8 failed (13 total)**. The earlier 7 booking E2Es are not all still green. Primary reported failures include CRM login/setup expectation, old cross-app tests, and a CRM Customers test timeout. Obtain screenshots/traces from CI artifact `playwright-test-results`, find the cause(s) without weakening assertions.
- Current repository tree has no generated `docs/screenshots/crm-*.png` images; the full CRM visual coverage is not evidenced by committed screenshots.

## P0 — must fix before accepting CRM stage

### P0-01: CI regression — 8 failing Playwright tests

`tests/e2e/booking.spec.ts`, `tests/e2e/crm_full.spec.ts`; CI log above. Some failures occur at the `beforeEach` assertion of `h1` calendar, others after navigation. API requests `/auth/login` and `/auth/me` were reported HTTP 200 for some tests, so **do not assume** the underlying failure is incorrect credentials. Read browser errors/traces, verify actual rendered DOM and navigation, fix application bugs and stale selectors, and run the *combined* test suite, not each file in isolation. Tests must remain non-vacuous and prove persistence.

### P0-02: Tenant-role privacy bypass in customer card

`apps/api/app/api/v1/business/routes.py`, `GET /customers/{customer_id}` around line 1130. Only `get_crm_tenant_user` is required; any `master` belonging to a tenant can request an arbitrary customer ID from the same company and receive full phone, email, `notes_private`, private notes and history. This contradicts `docs/CRM_ROLE_PERMISSION_MATRIX.md` and the existing list API, which restricts and masks master data. Enforce explicit server-side owner/admin vs master object-level policy: either deny detail access for masters or restrict to their **own bookings** with only minimally authorized fields/notes. Test arbitrary same-tenant unrelated customer IDs; no masking bypass. Audit `POST /customers` and `POST /customers/{id}/notes` — both currently use mere membership and require appropriate role/object authorization. Deny master adding notes to arbitrary customer.

### P0-03: CRM staff invitation cannot be accepted; token stored raw

`apps/api/app/api/v1/business/routes.py`, `POST /invites` around line 1496: `token_hash=raw_token`. `apps/api/app/api/v1/auth/routes.py`, `POST /accept-invite`: compares `Invite.token_hash` with `sha256(req.token)`. Thus ordinary CRM invites are not redeemable and the raw secret sits in a database column meant for a hash. Store SHA-256 digest of cryptographically random token; return raw token only once through explicitly sanctioned manual-link workflow, never log it. Validate invite role and tenant, ensure single-use, TTL and no password takeover. Add real integration test CRM owner -> create invite -> accept via API -> tenant membership created -> authenticate as invitee; reuse should fail; unrelated tenant access must fail.

### P0-04: Wrong time zone for manual CRM booking/reschedule/block

`apps/business-crm/src/modules/calendar/CalendarModule.tsx` around lines 106–209 builds `starts_at_utc: \`${currentDate}T${newTime}:00Z\`` and similar strings for reschedule and blocks. Local wall clock is being falsely marked UTC; for `Asia/Almaty` this shifts a 10:00 local appointment to 15:00 local. Use selected branch's `timezone_iana` with an actual timezone conversion implementation; handle invalid and DST-ambiguous local times. For each of create, reschedule and block, assert that UI 10:00 equals persisted/displayed branch-local 10:00, and that another timezone also works. Never append `Z` to user-entered local time.

## P1 — complete in same remediation gate

### P1-01: Cross-branch schedule data loss

`apps/api/app/api/v1/business/routes.py`, `PUT /staff/{staff_id}/schedule` around lines 1280–1362 selects/deletes **all** `WeeklyShift` rows for a staff member across the tenant, then re-creates rows only for one branch (`branch_id` query arg or arbitrary first branch). Require explicit branch selection, verify staff assigned to that branch and correct tenant, replace only that branch's shifts transactionally; retain other branch shifts. Validate weekday in 1..7, no invalid/overlapping breaks, start/end sequence and policy for existing future bookings. Test two branches with distinct schedules survive change to one.

### P1-02: Personal service prices saved under first branch

`apps/business-crm/src/modules/staff/StaffModule.tsx` `handleSaveOffers` around line 145 uses `branch_id: branches[0]?.id`; selected branch is ignored. Pass the branch explicitly and load/save per branch. Cross-branch price tests: changing B cannot change A.

### P1-03: Branch fields lost due mismatched DTO names

`SettingsModule.tsx` `handleSaveBranch` sends `phone_number` and `timezone` and reads those names from `BranchResponse`; backend `create_branch` and `update_branch` expect `phone`, `timezone_iana`. Use typed DTOs and one OpenAPI contract; test create/edit/reload, ensuring phone/timezone persist and public Booking Web sees them. Remove `any` request payloads masking the discrepancy.

### P1-04: Financial metric incorrectly labelled "fact revenue"

`apps/api/app/api/v1/business/routes.py` `GET /reports/overview` around lines 1000–1080: `actual_revenue_minor` is sum of completed bookings' **quoted amounts**, not actual recorded customer receipts; `workload_pct = bookings_count*45/(8*60)` is an invented constant, not real shift utilization. For MVP, if there is no collected-payment ledger per visit, call it "стоимость завершённых визитов" (not paid revenue). To call it "факт выручка", first implement actual receipt/payment events and aggregates. Calculate workload from real booked minutes and scheduled working minutes, including breaks and branch-local date boundaries. Tests with 30/75/120 minute services, overtime, cancellation, no-show and incomplete payment.

### P1-05: QR code not implemented

`apps/business-crm/src/modules/online-booking/OnlineBookingModule.tsx` around lines 488–523 displays a dark square with text "QR КОД", not a QR matrix. Generate a real, scannable QR from the published, validated booking URL; test QR payload/scan or explicitly mark feature PARTIAL and remove 31/31 claim.

### P1-06: API security and contract hardening

- Audit all newly added endpoints for role, tenant, branch and object-level permissions, not just RLS across tenants. `update_staff_profile`, offer updates, `update_staff_schedule` and customer notes must verify foreign IDs belong to correct tenant and are allowed for the actor.
- Enforce privilege matrix in backend, not only hide controls. Some existing documentation grants owner-only permissions while routes permit admin, or vice versa; define and test an authoritative matrix.
- `POST /booking-publication/publish` currently takes `publish: bool` as a query param, but frontend client sends JSON `{is_published}`. Unify explicitly and prove publication changes after reload and public site availability.
- Replace generic request DTOs, magic defaults and `any` payloads with generated/openapi-verified types.

### P1-07: Tests and documentation integrity

- `tests/e2e/crm_full.spec.ts` line 48 uses conditional note test: `if (await noteInput.isVisible())`. Make note creation mandatory; no skipped assertions. Test real save/reload effect for each module, not heading presence only.
- The test suite must cover all six new CRM feature areas, both tenant contexts, owner/admin/master (positive and negative tests), multi-branch, and the pre-existing seven Booking Web flows.
- `docs/CRM_DESIGN_API_MATRIX.md` says 31/31 DONE despite CI failures and unimplemented QR. Reclassify each row DONE/PARTIAL/BLOCKED against real proof, include file paths + E2E name + screenshot path. Update security matrix: it cites `app.current_tenant_id` while runtime sets `app.current_tenant`; do not leave contradictory RLS descriptions.
- Capture actual Playwright screenshots for 1440 desktop, 1280 desktop and 390/360 mobile with representative seeded data and compare side-by-side with `design/reference/готовый фронт.html`, documenting notable deviations. Build/visual checks are distinct from functional success.

## Execution order and deliverables

1. Start a new branch `fix/crm-full-v1-audit-gate` from `c284e921acdc31de340edea470b5a00b036d0f86`, unless it has been superseded. Do **not** touch `main` or perform production deployment. No force-push.
2. Diagnose GitHub E2E failures from Playwright traces and screenshot artifacts. Fix genuine defects and stale selectors (without weakening test conditions). Get a green combined GitHub CI, **29+ backend tests + 13/13 E2E**.
3. Fix and regression-test P0 access controls, invitation flow and local-to-UTC conversion.
4. Fix cross-branch schedules, price overrides, branch DTO mismatch, public publication API, financial/usage terminology, actual QR, etc.; add tests with real PostgreSQL.
5. Re-run all tests from clean database and deployment setup (including `docker build` if possible); verify existing Booking Web unaffected.
6. Add CI upload of Playwright traces/screenshots regardless of test result where appropriate; submit exact CI URL and SHA, reproducible commands and logs.
7. Produce **complete audit ZIP** containing code changes (or exact commit + applicable complete source), diff, dependency lock, migrations, test logs, screenshots and matrix, plus explicit DONE/PARTIAL/BLOCKED.
8. Do **not** claim all 31/31 implemented or production-ready while any required behavior/test lacks proof.

## Acceptance examples (must be automatic, not manual assertions)

- Master from same company cannot read unrelated customer full contact / private note by guessing UUID; owner can. Master cannot add note to unrelated customer.
- Owner creates invitation, new user accepts; password on existing user is not reset; invitation cannot be replayed.
- Two-branch staff schedule editing branch A preserves branch B; staff prices remain distinct by branch.
- Manual create, reschedule and block at `10:00 Asia/Almaty` persist/display at 10:00 in branch timezone; same for a second IANA timezone.
- Branch creation/edit preserves `phone`, `timezone_iana` and public booking sees changes.
- Real QR decodes to the exact published company URL.
- One completed but unpaid visit does not increase *paid revenue*; workload uses true minutes not 45-min estimate.
- `npm run build --workspaces`, PostgreSQL pytest and combined Playwright suite green at exact new HEAD, screenshot assets and logs available.

**Next milestone after this audit gate:** independent design audit, then Platform Console frontend. Do not expand to another vertical before CRM gate passes.
