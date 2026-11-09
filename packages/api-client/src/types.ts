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
  timezone?: string;
  phone?: string | any;
  phone_number?: string;
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
  branch_id: string;
  staff_id: string;
  service_ids: string[];
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

export interface CustomerResponse {
  id: string;
  tenant_id: string;
  full_name: string;
  phone_e164: string;
  email?: string;
  notes_private?: string;
  total_bookings?: number;
  last_booking_at?: string;
  created_at: string;
}

export interface CustomerUpdateRequest {
  full_name?: string;
  phone_e164?: string;
  email?: string;
  notes_private?: string;
}

export interface CustomerNoteResponse {
  id: string;
  customer_id: string;
  note_text: string;
  created_at: string;
  created_by_name?: string;
}

export interface StaffDetailResponse {
  id: string;
  user_id?: string;
  display_name: string;
  role_title: string;
  active: boolean;
  online_bookable: boolean;
  color: string;
  branch_ids: string[];
  offers?: StaffServiceOfferResponse[];
  today_bookings_count?: number;
  today_is_working?: boolean;
}

export interface StaffServiceOfferResponse {
  id: string;
  service_id: string;
  service_name: string;
  branch_id: string;
  price_override_minor?: number;
  duration_override_minutes?: number;
  active: boolean;
  online_visible: boolean;
}

export interface WeeklyShiftResponse {
  weekday_iso: number;
  local_start: string;
  local_end: string;
  is_working: boolean;
  breaks: { local_start: string; local_end: string }[];
}

export interface ServiceDetailResponse {
  id: string;
  tenant_id: string;
  category_id?: string;
  category_name?: string;
  name: string;
  description?: string;
  base_price_minor: number;
  base_duration_minutes: number;
  active: boolean;
  online_visible: boolean;
  assigned_staff_count?: number;
}

export interface ServiceUpdateRequest {
  name?: string;
  category_id?: string;
  description?: string;
  base_price_minor?: number;
  base_duration_minutes?: number;
  active?: boolean;
  online_visible?: boolean;
}

export interface ServiceCategoryResponse {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
  services_count?: number;
}

export interface ServiceCategoryUpdateRequest {
  name?: string;
  sort_order?: number;
}

export interface BookingSettingsResponse {
  policy: {
    book_ahead_days: number;
    min_advance_minutes: number;
    cancellation_cutoff_minutes: number;
    allow_self_reschedule: boolean;
    slot_step_minutes: number;
    max_services_per_booking: number;
    allow_online_booking: boolean;
  };
  theme: {
    primary_color: string;
    accent_color: string;
  };
  publication: {
    is_published: boolean;
    slug: string;
    public_url?: string;
  };
}

export interface ReportsOverviewResponse {
  period_start: string;
  period_end: string;
  total_bookings: number;
  completed_bookings: number;
  cancelled_bookings: number;
  arrived_bookings: number;
  planned_revenue_minor: number;
  actual_revenue_minor: number;
  completed_revenue_minor?: number;
  paid_revenue_minor?: number;
  payment_collection_enabled?: boolean;
  revenue_semantics_note?: string;
  new_customers_count: number;
  occupied_minutes?: number;
  staff_stats: {
    staff_id: string;
    staff_name: string;
    bookings_count: number;
    revenue_minor: number;
    workload_pct: number;
    booked_minutes?: number;
  }[];
}

export interface MembershipResponse {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  created_at: string;
}

export interface InviteCreateRequest {
  email: string;
  role: string;
  branch_ids?: string[];
}

// =========================================================================
// PLATFORM CONSOLE TYPES
// =========================================================================

export interface PlatformOverviewResponse {
  total_tenants: number;
  active_subscriptions: number;
  suspended_tenants: number;
  total_revenue_minor: number;
  total_revenue_formatted: string;
  non_mrr_disclaimer: string;
  alerts_count: number;
  recent_alerts: {
    type: string;
    severity: string;
    message: string;
    created_at: string;
  }[];
  attention_items: {
    urgent_today: {
      tenant_id: string;
      tenant_name: string;
      tenant_slug: string;
      subscription_id: string;
      plan_name: string;
      status: string;
      period_end: string;
      grace_ends_at?: string;
      issue: string;
    }[];
    upcoming_days: {
      tenant_id: string;
      tenant_name: string;
      tenant_slug: string;
      subscription_id: string;
      plan_name: string;
      status: string;
      period_end: string;
      grace_ends_at?: string;
      issue: string;
    }[];
  };
  recent_tenants: {
    id: string;
    slug: string;
    display_name: string;
    vertical: string;
    lifecycle_status: string;
    created_at: string;
    plan_name: string;
    subscription_status: string;
  }[];
}

export interface PlatformTenantListItem {
  id: string;
  slug: string;
  display_name: string;
  lifecycle_status: string;
  vertical: string;
  created_at: string;
  subscription: {
    id: string;
    status: string;
    plan_code: string;
    plan_name: string;
    price_minor: number;
    period_end: string;
    trial_ends_at?: string;
    grace_ends_at?: string;
  } | null;
  payment_status: 'paid' | 'pending';
}

export interface PlatformTenantDetailResponse {
  id: string;
  slug: string;
  display_name: string;
  lifecycle_status: string;
  vertical: string;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  created_at: string;
  domains: {
    hostname: string;
    domain_type: string;
    status: string;
    canonical: boolean;
  }[];
  subscription: {
    id: string;
    status: string;
    plan_code: string;
    plan_name: string;
    price_minor: number;
    currency: string;
    period_start: string;
    period_end: string;
    trial_ends_at?: string | null;
    grace_ends_at?: string | null;
    renewal_mode: string;
  } | null;
  usage_aggregates: {
    branches_count: number;
    staff_count: number;
    total_bookings_count: number;
  };
}

export interface PlatformTenantUsersResponse {
  members: {
    membership_id: string;
    user_id: string;
    email: string;
    display_name: string;
    role: string;
    status: string;
    joined_at?: string;
    created_at?: string;
  }[];
  invites: {
    id: string;
    email: string;
    role: string;
    invite_type: string;
    status?: string;
    sent_at: string;
    expires_at?: string;
  }[];
}

export interface PlatformTenantEntitlement {
  feature_key: string;
  plan_value: number | null;
  plan_enabled: boolean;
  is_overridden: boolean;
  override_value?: number | null;
  override_reason?: string | null;
  override_expires_at?: string | null;
  effective_value: number | null;
}

export interface PlatformSubscriptionItem {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  plan_code: string;
  plan_name: string;
  price_minor: number;
  currency: string;
  lifecycle_status: string;
  period_start: string;
  period_end: string;
  trial_ends_at?: string;
  grace_ends_at?: string;
  renewal_mode: string;
}

export interface PlatformChargeItem {
  id: string;
  tenant_id: string;
  tenant_name: string;
  period_start: string;
  period_end: string;
  amount_minor: number;
  currency: string;
  charge_status: string;
  evidence_reference?: string;
  created_at: string;
  payments: {
    id: string;
    amount_minor: number;
    evidence_reference: string;
    payment_method: string;
    recorded_at: string;
    note?: string;
  }[];
}

export interface PlatformPlanItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  active_version: {
    id: string;
    version: number;
    price_minor: number;
    currency: string;
    entitlements: Record<string, { enabled: boolean; limit?: number | null }>;
  } | null;
}

export interface PlatformFeatureItem {
  key: string;
  name: string;
  release_stage: string;
  configurable: boolean;
  description?: string;
}

export interface PlatformSupportTicketItem {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  subject: string;
  status: string;
  priority: string;
  messages_count: number;
  created_at: string;
  updated_at?: string;
}

export interface PlatformSupportTicketDetail {
  id: string;
  tenant_id: string;
  tenant_name: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  messages: {
    id: string;
    sender_id: string;
    sender_name: string;
    sender_role: string;
    message: string;
    is_internal: boolean;
    created_at: string;
  }[];
}

export interface PlatformDiagnosisResponse {
  tenant: {
    id: string;
    slug: string;
    display_name: string;
    lifecycle_status: string;
    vertical: string;
    timezone: string;
  };
  domains: { hostname: string; status: string; type: string }[];
  subscription: {
    status: string;
    plan_code: string;
    plan_name: string;
    period_end: string;
  } | null;
  metrics: {
    branches: number;
    staff: number;
    services: number;
    bookings_total: number;
  };
  active_overrides: { key: string; value?: number | null; expires_at: string }[];
  infrastructure: {
    db_status: string;
    rls_enforcement: string;
    read_only: boolean;
  };
}

export interface PlatformAccessRequestItem {
  id: string;
  tenant_id: string;
  tenant_name: string;
  requester_name: string;
  requester_email: string;
  reason: string;
  requested_scope: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export interface PlatformActiveSessionResponse {
  has_active_session: boolean;
  session_id?: string;
  request_id?: string;
  tenant_id?: string;
  tenant_name?: string;
  minutes_left?: number;
  expires_at?: string;
}

export interface PlatformAuditEventItem {
  id: string;
  actor_id?: string;
  actor_email?: string;
  action: string;
  target_tenant_id?: string;
  object_type: string;
  object_id?: string;
  reason?: string;
  before?: any;
  after?: any;
  occurred_at: string;
}

export interface PlatformStaffItem {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  platform_role: string;
  status: string;
  created_at: string;
}

export interface PlatformSettingsResponse {
  settings_map: Record<string, any>;
  items: {
    key: string;
    value: any;
    description?: string;
    updated_at: string;
  }[];
}

export interface BusinessPendingSupportRequest {
  id: string;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  reason: string;
  requested_scope: string;
  expires_at: string;
  created_at: string;
}

export interface BusinessActiveSupportSession {
  id: string;
  staff_id: string;
  staff_name: string;
  staff_email: string;
  starts_at: string;
  expires_at: string;
  minutes_left: number;
  status: string;
}
