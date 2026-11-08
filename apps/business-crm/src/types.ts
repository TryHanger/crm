export interface CrmMembership {
  membership_id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  role: 'owner' | 'admin' | 'master' | string;
}

export interface CalendarStaff {
  id: string;
  name: string;
  role_title?: string;
  color?: string;
}

export interface CalendarBooking {
  id: string;
  public_ref: string;
  staff_id: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  starts_at_utc: string;
  service_ends_at_utc: string;
  amount_minor: number;
  services: string[];
}

export interface CalendarBlockItem {
  id: string;
  staff_id: string;
  starts_at_utc: string;
  ends_at_utc: string;
  block_reason?: string;
}

export type CrmNavigationSection =
  | 'calendar'
  | 'customers'
  | 'staff'
  | 'services'
  | 'online-booking'
  | 'reports'
  | 'settings';
