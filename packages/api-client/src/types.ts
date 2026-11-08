/**
 * Auto-generated TypeScript contracts and API client from OpenAPI 3.1.0
 * SaaS Multi-Tenant Booking & CRM Engine
 */

export interface AcceptInviteRequest {
  token: string;
  password: string;
  display_name?: string | any;
}

export interface AvailabilitySearchRequest {
  branch_id: string;
  service_ids: string[];
  from_date: string;
  to_date: string;
  staff_id?: string | any;
  staff_mode?: string;
}

export interface AvailabilitySearchResponse {
  slots: SlotResponse[];
  total_count: number;
}

export interface BookingCreatedResponse {
  booking_id: string;
  public_ref: string;
  status: string;
  starts_at_utc: string;
  service_ends_at_utc: string;
  total_amount_minor: number;
  currency: string;
  management_token: string;
  management_url: string;
}

export interface BookingPolicyUpdateRequest {
  book_ahead_days?: number | any;
  min_advance_minutes?: number | any;
  cancellation_cutoff_minutes?: number | any;
  allow_self_reschedule?: boolean | any;
  slot_step_minutes?: number | any;
  max_services_per_booking?: number | any;
  allow_online_booking?: boolean | any;
}

export interface BranchResponse {
  id: string;
  name: string;
  city: string;
  address: string;
  timezone_iana: string;
  phone?: string | any;
  weekly_hours?: any | any;
}

export interface CRMCreateBookingRequest {
  branch_id: string;
  staff_id: string;
  service_ids: string[];
  starts_at_utc: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | any;
  notes?: string | any;
}

export interface CalendarBlockCreateRequest {
  branch_id: string;
  staff_id: string;
  starts_at_utc: string;
  ends_at_utc: string;
  block_reason?: string;
}

export interface CancelRequest {
  reason?: string | any;
}

export interface CreatePlanRequest {
  code: string;
  name: string;
  description?: string | any;
  price_minor: number;
  currency?: string;
  max_branches?: number;
  max_active_staff?: number;
}

export interface CreatePublicBookingRequest {
  branch_id: string;
  staff_id: string;
  service_ids: string[];
  starts_at_utc: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | any;
  notes?: string | any;
  quote_id?: string | any;
  expected_price_minor?: number | any;
}

export interface CustomerCreateRequest {
  full_name: string;
  phone_e164: string;
  email?: string | any;
  notes_private?: string | any;
}

export interface CustomerNoteCreateRequest {
  note: string;
}

export interface HTTPValidationError {
  detail?: ValidationError[];
}

export interface IssueChargeRequest {
  amount_minor: number;
  currency?: string;
  period_start: string;
  period_end: string;
  evidence_reference?: string | any;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface PlatformTenantCreateRequest {
  slug: string;
  display_name: string;
  owner_email: string;
  owner_name: string;
  vertical?: string;
  plan_code?: string;
}

export interface PublicManageBookingResponse {
  booking_id: string;
  public_ref: string;
  status: string;
  starts_at_utc: string;
  service_ends_at_utc: string;
  total_amount_minor: number;
  currency: string;
  customer_name: string;
  customer_phone_masked: string;
  cancellation_cutoff_minutes: number;
  can_cancel: boolean;
  can_reschedule: boolean;
  items: Record<string, any>[];
}

export interface PublicSiteResponse {
  tenant_id: string;
  slug: string;
  display_name: string;
  business_name: string;
  timezone: string;
  primary_color: string;
  accent_color: string;
  logo_url?: string | any;
  cancellation_cutoff_minutes: number;
  book_ahead_days: number;
  min_advance_minutes: number;
  max_services_per_booking: number;
  is_published: boolean;
}

export interface ReactivateTenantRequest {
  reason: string;
}

export interface RecordPaymentRequest {
  amount_minor: number;
  evidence_reference: string;
  payment_method?: string;
  note?: string | any;
}

export interface RescheduleRequest {
  new_starts_at_utc: string;
  new_staff_id?: string | any;
}

export interface ServiceCategoryCreateRequest {
  name: string;
  sort_order?: number;
}

export interface ServiceCreateRequest {
  category_id?: string | any;
  name: string;
  description?: string | any;
  base_price_minor: number;
  base_duration_minutes: number;
  active?: boolean;
  online_visible?: boolean;
}

export interface ServiceItemResponse {
  id: string;
  category_id?: string | any;
  category_name?: string | any;
  name: string;
  description?: string | any;
  base_price_minor: number;
  price_formatted: string;
  currency: string;
  base_duration_minutes: number;
}

export interface SlotResponse {
  staff_id: string;
  staff_name: string;
  staff_role: string;
  starts_at_utc: string;
  ends_at_utc: string;
  duration_minutes: number;
  price_minor: number;
  currency: string;
  quote_id: string;
  quote_expires_at: string;
}

export interface StaffCreateRequest {
  display_name: string;
  role_title?: string;
  color?: string;
  online_bookable?: boolean;
  branch_ids: string[];
}

export interface StaffPublicResponse {
  id: string;
  display_name: string;
  role_title: string;
  color: string;
}

export interface StaffServiceOfferUpdateRequest {
  branch_id: string;
  service_id: string;
  price_override_minor?: number | any;
  duration_override_minutes?: number | any;
  active?: boolean;
  online_visible?: boolean;
}

export interface StatusUpdateRequest {
  status: string;
  reason?: string | any;
}

export interface SupportAccessRequestCreate {
  tenant_id: string;
  reason: string;
  requested_scope?: string;
}

export interface SuspendTenantRequest {
  reason: string;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  user_id: string;
  display_name: string;
  email: string;
  role?: string | any;
  platform_role?: string | any;
}

export interface ValidationError {
  loc: string | number[];
  msg: string;
  type: string;
}
