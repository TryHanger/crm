# Authentication, Roles & Permissions Specification

## 1. Authentication Architecture
The platform utilizes stateless JWT bearer authentication:
- Tokens are signed with HMAC-SHA256 (`HS256`).
- Payload contains user identity (`sub`), normalized email, and standard expiration (`exp`).
- User identities reside in `identity_users`.
- Role assignments reside in:
  - `tenant_memberships` (for Business CRM).
  - `platform_staff` (for Platform Console).

---

## 2. Business CRM Roles & Visibility Matrix
CRM users operate strictly inside their company workspace (`tenant_id`). The user selects or supplies `X-Tenant-ID` if they belong to multiple organizations.

| Capability / Resource | Owner (`owner`) | Admin (`admin`) | Master (`master`) |
| :--- | :---: | :---: | :---: |
| **Manage Subscription & Billing** | Full | Forbidden (403) | Forbidden (403) |
| **Approve Platform Support Access** | Full | Forbidden (403) | Forbidden (403) |
| **Manage Branches & Staff Profiles** | Full | Full | Read-Only |
| **Manage Services & Master Pricing** | Full | Full | Forbidden (403) |
| **Full Calendar View (All Masters)** | Full | Full | **Personal Schedule Only** |
| **Customer Database & Phone Numbers** | Full | Full | **Masked / Own Bookings Only** |
| **Financial Reports & Dashboard** | Full | Full | Forbidden (403) |
| **Create Manual Booking & Blocks** | Full | Full | Only for Own Schedule |
| **Online Booking Settings & Theme** | Full | Full | Forbidden (403) |

> **Calendar Filtering Rule**:
> When a user with role `master` requests `/api/v1/business/calendar`, the endpoint automatically resolves their linked `staff_id` via `staff_profiles.user_id == current_user.id` and filters the response to return **only their column and appointments**.

---

## 3. Platform Console Roles & Responsibilities
Platform staff possess no implicit access to customer CRM data. Access is governed by operational roles in `platform_staff`:

| Platform Capability | Platform Owner (`platform_owner`) | Support (`support`) | Finance (`finance`) |
| :--- | :---: | :---: | :---: |
| **System Overview & Tenant Directory** | Full | Full | Full |
| **Onboard New Tenant Workspace** | Full | Forbidden (403) | Forbidden (403) |
| **Suspend / Reactivate Tenant** | Full | Forbidden (403) | Forbidden (403) |
| **Issue Subscription Charges** | Full | Forbidden (403) | Full |
| **Record Manual Payments & Evidence** | Full | Forbidden (403) | Full |
| **Request Assisted Support Access** | Full | Can Request | Forbidden (403) |
| **View Platform Audit Logs** | Full | Read-Only | Read-Only |

---

## 4. Support-Assisted Access Protocol
Platform operators are strictly barred from entering a company's CRM without explicit customer consent:
1. Support operator submits an access request: `POST /api/v1/platform/access-requests` specifying `tenant_id`, `reason`, and requested duration (maximum 30 minutes).
2. The Company Owner receives a notification and reviews the pending request in CRM: `GET /api/v1/business/access-requests`.
3. The Company Owner explicitly approves: `POST /api/v1/business/access-requests/{id}/approve`.
4. The system creates a `support_access_grants` record with `expires_at = NOW() + INTERVAL '30 minutes'`.
5. Every query performed by support during this temporary grant is stamped in `platform_audit_logs`.
6. Once the grant expires or is revoked, support session immediately terminates.
