import { VisitFinancialSummary, BookingCardResponse } from '@crm/api-client';

export type { VisitFinancialSummary, BookingCardResponse };

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
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  starts_at_utc: string;
  service_ends_at_utc: string;
  amount_minor: number;
  cost_minor?: number;
  rendered_minor?: number;
  paid_minor?: number;
  debt_minor?: number;
  payment_status?: 'unpaid' | 'partially_paid' | 'paid';
  finance?: VisitFinancialSummary;
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
  | 'overview'
  | 'calendar'
  | 'customers'
  | 'staff'
  | 'services'
  | 'online-booking'
  | 'cash'
  | 'reports'
  | 'settings'
  | 'onboarding';
