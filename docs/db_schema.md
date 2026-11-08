# Database Schema & Data Dictionary

## 1. Schema Overview
The relational architecture is divided strictly into two tiers:
1. **Control Plane (System & Platform Tables)**:
   - Contains platform identities, catalog, plans, billing ledgers, platform staff, and audit trails.
   - Does not have `tenant_id` column or RLS; accessed by Platform staff and authentication systems.
2. **Data Plane (Tenant Isolated Tables)**:
   - Contains 22 business tables representing all CRM, master, branch, customer, booking, and operational state.
   - Every single table possesses a mandatory `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.
   - Protected by Row Level Security forced on all roles.

---

## 2. Table Catalog

### 2.1 Control Plane Tables (17 Tables)
1. **`identity_users`**: Global authentication records, OIDC subject/email, password hashes, multi-factor status.
2. **`tenant_memberships`**: Association between identity users and tenants, specifying tenant role (`owner`, `admin`, `master`).
3. **`tenants`**: Core tenant entity, slug, display name, vertical, timezone, subscription lifecycle status.
4. **`tenant_domains`**: Subdomains and custom CNAME domains with verification status.
5. **`plans`**: Commercial subscription plan catalog (`start`, `pro`).
6. **`plan_versions`**: Immutable plan version records with pricing minor and currency.
7. **`features_catalog`**: Granular platform capabilities (`online_booking`, `basic_reports`, `custom_domain`, etc.).
8. **`plan_entitlements`**: Limits and flags for each plan version (e.g. `max_branches: 1`, `max_active_staff: 5`).
9. **`tenant_subscriptions`**: Active subscription state machine per tenant (`trial`, `active`, `past_due`, `grace`, `expired_pending_action`, `suspended`).
10. **`tenant_feature_overrides`**: Custom entitlements granted to specific tenants by platform owners.
11. **`billing_charges`**: Invoiced platform charges for subscription renewals and add-ons.
12. **`billing_payments`**: Evidence-backed manual payment records with idempotency tracking.
13. **`platform_staff`**: Internal operator identities and assigned platform roles (`platform_owner`, `support`, `finance`).
14. **`platform_audit_logs`**: Tamper-evident ledger of administrative operations.
15. **`support_access_grants`**: Owner-approved temporary access requests with 30-minute maximum TTL.
16. **`outbox_events`**: Guaranteed delivery outbox for transactional asynchronous events.
17. **`notification_deliveries`**: Log of outbound communications (email, SMS).

---

### 2.2 Data Plane Tables (22 RLS Tables)
1. **`branches`**: Physical locations with address and branch timezone.
2. **`staff_profiles`**: Masters, stylists, and administrative personnel profiles.
3. **`staff_branches`**: Master-to-branch multi-assignment matrix.
4. **`staff_shifts`**: Weekly and recurring working hours for masters.
5. **`service_categories`**: Service taxonomies with sort ordering.
6. **`services`**: Base service catalog (name, description, base duration, base price).
7. **`staff_service_offers`**: Individual master overrides for duration and pricing minor.
8. **`customers`**: Client profiles with E.164 phone numbers and private CRM notes.
9. **`customer_notes`**: Internal team notes regarding client preferences and history.
10. **`customer_consents`**: GDPR / personal data processing consent records.
11. **`bookings`**: Booking header (public reference, starts_at_utc, ends_at_utc, status, price snapshot).
12. **`booking_items`**: Line items within a booking (ordered multi-service sequence with duration and price snapshots).
13. **`booking_events`**: Audit log of status transitions and reschedule history.
14. **`staff_occupancies`**: Master time reservations protected by GiST exclusion constraint against double-booking.
15. **`calendar_blocks`**: Breaks, sick leaves, and manual CRM blocks.
16. **`booking_policies`**: Dynamic scheduling policies (cancellation cutoff, advance booking limits).
17. **`booking_themes`**: Brand colors (primary, accent) and logo URL.
18. **`booking_publications`**: Domain publication toggles and active branch references.
19. **`booking_quotes`**: Short-lived signed/hashed availability quotes with duration and price guarantees.
20. **`public_management_tokens`**: SHA-256 hashed cryptographic bearer tokens for self-service client actions.
21. **`pos_transactions`**: Cash and terminal register transactions.
22. **`pos_transaction_items`**: Line items associated with POS sales.

---

## 3. RLS Policies & Security Definers

### 3.1 Blanket RLS Policy
On all 22 data plane tables:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

CREATE POLICY <table>_tenant_isolation ON <table>
FOR ALL
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
);
```

### 3.2 Public Management Token Resolution Helper
For anonymous clients accessing `/manage/{token}` without prior tenant context:
```sql
CREATE OR REPLACE FUNCTION lookup_public_management_token(p_token_hash text)
RETURNS TABLE (tenant_id uuid, booking_id uuid)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT tenant_id, booking_id FROM public_management_tokens
    WHERE token_hash = p_token_hash 
      AND revoked_at IS NULL 
      AND (expires_at IS NULL OR expires_at > clock_timestamp());
$$;
GRANT EXECUTE ON FUNCTION lookup_public_management_token(text) TO crm_app_user;
```
This enables the backend to safely look up the tenant context using the SHA-256 bearer token, immediately set `app.current_tenant`, and then conduct all subsequent operations under strict RLS isolation.
