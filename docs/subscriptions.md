# Subscription Lifecycle, Plans & Billing Specification

## 1. Subscription State Machine
Each tenant possesses a record in `tenant_subscriptions` tracking their commercial relationship with the platform.

```
       +-----------------------+
       |   trial (14 days)     |
       +-----------+-----------+
                   |
     +-------------+-------------+
     |                           | Payment made
     | Trial expires             v
     |                     +-----------+
     |                     |  active   | <-------------+
     |                     +-----+-----+               |
     v                           | Bill unpaid         |
+-----------+                    v                     |
| past_due  | ----------> +-------------+              |
+-----------+             | grace (7 d) |              |
                          +------+------+              |
                                 | Grace period ends   |
                                 v                     |
                   +---------------------------+       |
                   |   expired_pending_action  |       |
                   +-------------+-------------+       |
                                 | Manual or cron      | Payment recorded
                                 v                     |
                         +---------------+             |
                         |   suspended   | ------------+
                         +---------------+
```

### 1.1 State Definitions & Access Rules
- **`trial`**: 14-day evaluation period granted automatically upon tenant creation. Full CRM and public booking capabilities enabled.
- **`active`**: Paid active billing cycle. Full capabilities.
- **`past_due`**: Automated billing failed or invoice issued but unpaid within billing terms. System warning displayed; all operations remain functional.
- **`grace`**: 7-day grace period post invoice due date. Banner displayed in CRM header. Public booking and CRM write operations continue without interruption.
- **`expired_pending_action`**: Grace period elapsed without payment. Company is flagged for review by platform operations.
- **`suspended`**: Manual suspension enacted by Platform Owner (or automatic after prolonged non-payment).
  - **Public Booking**: Immediately disabled. Clients attempting to book receive HTTP 403 `TENANT_SUSPENDED`.
  - **CRM Operations**: Switched to strict read-only. Masters and administrators can view existing appointments and client records, but cannot create or modify bookings, services, or staff.
  - **Reactivation**: Restores the tenant to `active` upon settlement of overdue charges.

---

## 2. Plans, Versions & Feature Entitlements
Commercial packages are versioned to preserve grandfathered pricing for existing customers:
- **`plans`**: High-level plan definition (`start`, `pro`).
- **`plan_versions`**: Immutable pricing records (e.g. `version: 1`, `price_minor: 900000`, `currency: KZT`).
- **`plan_entitlements`**: Feature limits tied to the plan version:
  - `max_branches`: Limit on active branches (e.g. 1 on Start, 3 on Pro).
  - `max_active_staff`: Limit on active masters (e.g. 5 on Start, 15 on Pro).
  - Feature flags: `online_booking`, `basic_reports`, `custom_domain`, `advanced_analytics`.
- **`tenant_feature_overrides`**: Allows platform owners to selectively raise limits or grant preview features to individual companies without altering global plans.

---

## 3. Manual Billing Ledger & Idempotency
For the Kazakhstan and CIS market, manual B2B invoicing (bank transfer, Kaspi Pay, invoice-to-account) is the primary billing mode:
1. **Issuing Charges**:
   - Platform Finance operator issues charge: `POST /api/v1/platform/subscriptions/{id}/charges`.
   - Charge record is created in `billing_charges` with status `issued`.
2. **Recording Payment**:
   - Operator receives bank statement or receipt and records payment: `POST /api/v1/platform/charges/{charge_id}/record-payment`.
   - Payload includes `paid_amount_minor`, `payment_method`, and mandatory `evidence_reference` (e.g. bank payment order number `PP-2026-9912`).
   - Requires `Idempotency-Key` header: Prevents double-crediting if an operator clicks twice or retransmits requests.
   - Automatically settles the charge (`charge_status = 'settled'`) and advances subscription period.
