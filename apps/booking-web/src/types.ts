import {
  PublicSiteResponse,
  BranchResponse,
  ServiceItemResponse,
  StaffPublicResponse,
  SlotResponse,
  BookingCreatedResponse,
  PublicManageBookingResponse,
} from '@crm/api-client';

export type BookingFlow = 'service-first' | 'master-first' | 'time-first';

export type BookingStep = 'services' | 'staff' | 'datetime' | 'confirm' | 'result' | 'manage';

export interface BookingState {
  flow: BookingFlow;
  step: BookingStep;
  site: PublicSiteResponse | null;
  branches: BranchResponse[];
  selectedBranch: BranchResponse | null;
  categories: any[];
  services: ServiceItemResponse[];
  selectedServices: ServiceItemResponse[];
  staffList: StaffPublicResponse[];
  selectedStaff: StaffPublicResponse | 'any' | null;
  selectedDate: string; // YYYY-MM-DD
  preferredTime: string | null; // For time-first flow
  availableSlots: SlotResponse[];
  selectedSlot: SlotResponse | null;
  quoteId: string | null;
  // Customer inputs
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientNote: string;
  // Creation result
  bookingResult: BookingCreatedResponse | null;
  // Management mode
  manageToken: string | null;
  manageBooking: PublicManageBookingResponse | null;
  // Status flags
  isLoading: boolean;
  isSubmitting: boolean;
  error: { title: string; message: string; code?: string } | null;
  banner: { title: string; text: string; bg?: string; border?: string; fg?: string } | null;
}
