# Independent review — b669108, Final Deployment Acceptance

**Repository:** https://github.com/TryHanger/crm  
**Reviewed branch:** `fix/pilot-v1-runtime-and-publication-gate`  
**Reviewed SHA:** `b669108c01c5bbf105482b62de9eb87006cf6e4d`  
**Verified CI:** https://github.com/TryHanger/crm/actions/runs/42628520749 — SUCCESS, 45/45 pytest, 33/33 Playwright, PostgreSQL 17.11 `pg_dump`, frontend builds, DB backup/restore.  
**Decision:** DEV CI PASS; full containerized STAGING acceptance NOT YET PROVEN; first partner with real client data NO-GO.

## Confirmed positive changes

1. Runtime API no longer requires administrative PostgreSQL credentials; `PROCESS_ROLE=api`, lazy admin-engine access and separation into `migration-runner` are present.
2. `is_trusted_peer` now supports actual Docker IP/CIDR and resolves service names; tenant resolver reuses trust check.
3. `GET /business/booking-settings` returns policy, branding, publication and URL; CRM no longer hardcodes Barber House; publication JSON PATCH now persists `is_published=false` and public site rejects it with `SITE_NOT_PUBLISHED`. Existing backend and UI tests exercise portions of this.
4. PostgreSQL 17.11 client is shown in the actual CI log. Restore checks raise errors for RLS failures and missing occupancy constraint. CI backs up and restores an isolated test database successfully.

## Remaining acceptance gaps / findings

### P0 — Real STAGING Docker stack has not been tested end-to-end

`.github/workflows/ci.yml` runs `docker compose ... config`, but does **not** run `docker compose build`, `docker compose up -d`, inspect all service health statuses, test actual nginx proxy endpoints or run browser E2E via HTTPS. Playwright uses locally launched development servers (`uvicorn`, `npm run dev` on ports 8000, 3000, 3001, 3002), demo-seeded DB and DEV quick login. Config validity != runnable deployment. `PILOT_GO_NO_GO.md` must not label STAGING VERIFIED until this evidence exists.

**Acceptance:** With synthetic secrets and no demo seed, perform on a clean isolated CI/host network:
- `docker compose --env-file .env.staging -f docker-compose.staging.yml build`
- `docker compose --env-file .env.staging -f docker-compose.staging.yml up -d`
- Assert `postgres=healthy`, `migration-runner=exited 0`, `api=healthy`, `frontend` asset sync completed, `proxy=running` and Nginx config test PASS. Include sanitized logs and inspect results.
- Use domain-correct HTTPS requests through **Nginx** for console, CRM and two booking tenant hosts, using `--resolve` and a locally trusted test certificate. Do not use a blanket `curl -k` as proof of trusted TLS; self-signed cert is valid ONLY for closed technical tests. Confirm HTTP->HTTPS and unknown host rejection.
- Real browser workflow through these domains: operator logs in without dev shortcut; creates tenant, owner accepts invitation, configures branch/service/staff, publishes, customer books; CRM sees identical booking; suspend/re-publish and support approval work; check `403/404` negative scenarios.
- Keep existing 45 pytest + 33 Playwright tests and add a small deployment smoke suite, not an entire new product redesign.

### P0 — Public site must not be published simply by opening settings

`apps/api/app/api/v1/business/routes.py` `get_booking_settings`: when no `BookingPublication` row exists, GET inserts `is_published=True` and `db.commit()`; this makes read operation modify state and potentially publishes a not-yet-configured new company. The commit can also end the transaction-local RLS tenant context before the later TenantDomain query. Test a *brand-new* tenant with no publication row. Prefer side-effect-free GET returning `publication.is_published=false` unless there is a recorded explicit publish operation. Make the POST/PATCH the only publication mutation path; ensure necessary preconditions are validated.

**Acceptance:** Fresh tenant `GET` does not write rows or enable booking. `GET /public/site` returns `SITE_NOT_PUBLISHED` until owner explicitly publishes. Toggle persists across reload; pause prevents both site resolution and booking creation; re-enable restores functionality. Assert both API and UI through proxy, and verify RLS context is present after any intentional commit.

### P1 — CRM link and QR are not shown to be actionable

Current `docs/screenshots/pilot-03-booking-settings.png` shows `http://pilot16336.book.example.kz:3000`. `tests/e2e/pilot_readiness.spec.ts` accesses `http://pilot16336.localhost:3000`. The assertion merely checks that the string contains the slug. The system may be using a verified-but-not-routable example hostname in DEV. Correct slug alone does not make a functioning link.

**Acceptance:** The URL returned to Business CRM must be **reachable in its actual current environment**, match registered canonical domain / permitted custom domain, use HTTPS for staging, and be derived from backend configuration. Browser test clicks the exact CRM link (not constructed URL); verify public site identity; decode QR using a QR reader and assert it matches the displayed URL and navigates to that tenant. No `.book.example.kz:3000` or `.localhost` URLs in a staging-delivered QR. For dev, ensure local URL is intentionally local and reachable.

### P1 — Narrow trusted proxy boundary

`docker-compose.staging.yml` configures trusted proxies as `127.0.0.1,::1,proxy,nginx,172.28.0.10,172.28.0.0/16`. This trusts other containers on the whole Docker bridge to supply forged real-client headers, not just the Nginx endpoint. Use exact Nginx IP (`172.28.0.10/32`) or equivalent verified mTLS/network policy; avoid broad bridge CIDR. Consider separate frontend/API/DB networks if appropriate. Verify a request from an arbitrary other container with spoofed `X-Real-IP` is rejected, while one through Nginx uses the actual client IP.

### P1 — Hostname fallback must be restricted to registered tenant domains in STAGING

`apps/api/app/infrastructure/domain_resolution/resolver.py` tries an exact `TenantDomain.hostname_normalized` match, but if it fails, it uses the first DNS label to find a tenant by slug for **any host**. In STAGING, `pilot-slug.unregistered.example` could resolve to that tenant if it reaches the backend, even though the actual incoming hostname has not been verified. Nginx currently blocks unknown hosts at the edge, but defense in depth requires the API resolver to reject them too. Keep the slug fallback only for explicit DEV/TEST `.localhost` flows. Require exact domain registration and verified status for STAGING/PRODUCTION. Test valid system hostname, unregistered hostname with a valid slug, random hostname and spoofed forwarded host.

### P1 — Strengthen A/B restore test rather than labeling a weaker check as A/B proof

`restore_db.py` sets tenant A, counts own rows, then sets tenant B, counts rows, then resets context and checks zero; it does **not** query the IDs of B while current tenant context is A. The published `tenant_isolation_ab_verified=true` therefore overstates the test. Insert (in CI test source) guaranteed records for each tenant; while context A, query B's known branch/customer/booking IDs and require zero; while B, query A's IDs and require zero; verify at least one own record is visible for each context. If either side has no records, fail the proof instead of vacuously passing.

### P1 — DR/external dependencies remain outside the proven gate

The measured 0.575 s is SQL restore execution, not end-to-end recovery. `operational_recovery_estimate_seconds` is an estimate, not measured RTO. Offsite storage, scheduled backups, backup alerting and real DNS/trusted certificates are not provided. Don't label RPO as guaranteed without automated and verified periodic backup. Pilot of real data is BLOCKED until these are implemented, or a documented alternative safeguard is independently approved.

## Scope and Git instructions for implementing agent

- Branch from **exact** commit `b669108c01c5bbf105482b62de9eb87006cf6e4d`: `fix/pilot-v1-deployment-acceptance`.
- **Do not** rewrite Booking Web, Business CRM or Platform Console. No new modules, payments, SMS or stylistic redesign. Fix the focused defects, add containerized HTTPS smoke tests, keep all existing tests.
- Existing architecture and API contracts should be preserved unless necessary to fix incorrect publication behavior. For behavior changes, add migrations only if unavoidable and document backward compatibility.
- No production deploy, forced push or merge to main. Commit and push feature branch only. Do not use actual customer data, paid services, or any real secrets.
- Include negative tests, startup failure evidence, both expected status and actual HTTP response, unmodified logs and sanitized screenshot/trace proving URLs and lifecycle. Do not replace missing evidence with text claims.
- Deliver: SHA + CI run URL; Docker images/versions; sanitized `docker compose ps`, Nginx `-t`, health/readiness logs, HTTPS/Host proxy tests; screenshot/link/QR checks; DB new-tenant publication checks; cross-tenant negative evidence; revised `PILOT_GO_NO_GO.md`; concise ZIP without env files, credentials, actual database dumps or personal data.

**Exit criteria:** Everything works through the *same real Docker/Nginx STAGING path that would serve a client*, with full new-tenant booking flow, no auto-publication and strict host/proxy trust. Only then mark **INTERNAL SYNTHETIC STAGING GO**. Real customers remain a separate **NO-GO** until DNS/trusted TLS, operational backups and appropriate data/privacy safeguards are complete.
