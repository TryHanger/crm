import {
  TimeFirstRequest,
  TimeFirstResponse,
  PublicSiteResponse,
  BranchResponse,
  ServiceItemResponse,
  StaffPublicResponse,
  AvailabilitySearchRequest,
  AvailabilitySearchResponse,
  CreatePublicBookingRequest,
  BookingCreatedResponse,
  BookingCardResponse,
  VisitFinancialSummary,
  PublicManageBookingResponse,
  RescheduleRequest,
  CancelRequest,
  LoginRequest,
  TokenResponse,
  CRMCreateBookingRequest,
  StatusUpdateRequest,
  CalendarBlockCreateRequest,
  CustomerResponse,
  CustomerUpdateRequest,
  CustomerNoteResponse,
  StaffDetailResponse,
  StaffCreateRequest,
  StaffServiceOfferUpdateRequest,
  StaffTimeOffResponse,
  StaffTimeOffCreateRequest,
  WeeklyShiftResponse,
  ServiceDetailResponse,
  ServiceCreateRequest,
  ServiceUpdateRequest,
  ServiceCategoryResponse,
  ServiceCategoryCreateRequest,
  ServiceCategoryUpdateRequest,
  BookingSettingsResponse,
  BookingPolicyUpdateRequest,
  ReportsOverviewResponse,
  MembershipResponse,
  InviteCreateRequest,
  PlatformOverviewResponse,
  PlatformTenantListItem,
  PlatformTenantDetailResponse,
  PlatformTenantUsersResponse,
  PlatformTenantEntitlement,
  PlatformSubscriptionItem,
  PlatformChargeItem,
  PlatformPlanItem,
  PlatformFeatureItem,
  PlatformSupportTicketItem,
  PlatformSupportTicketDetail,
  PlatformDiagnosisResponse,
  PlatformAccessRequestItem,
  PlatformActiveSessionResponse,
  PlatformAuditEventItem,
  PlatformStaffItem,
  PlatformSettingsResponse,
  BusinessPendingSupportRequest,
  BusinessActiveSupportSession,
  PaymentRecord,
  PaymentCreateRequest,
  PaymentRefundRequest,
  CashShift,
  CashShiftSummary,
  ShiftOpenRequest,
  ShiftCloseRequest,
  ExpenseRecord,
  ExpenseCreateRequest,
  VisitsReportData,
  ServicesReportData,
  FinanceReportData,
  DebtsReportData,
  DebtItem,
  AlternativeSlot
} from './types';

export * from './types';

export interface ApiClientConfig {
  baseUrl?: string; // e.g. "" for same-origin or "/api/v1"
  defaultHeaders?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  let data: any = null;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const code = data?.detail?.code || data?.code || `HTTP_${res.status}`;
    const msg = data?.detail?.message || data?.message || (typeof data?.detail === 'string' ? data.detail : res.statusText);
    throw new ApiError(res.status, code, msg, data);
  }
  return data as T;
}

export class PublicApiClient {
  private baseUrl: string;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? '';
  }

  async getSite(): Promise<PublicSiteResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/public/site`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    return handleResponse<PublicSiteResponse>(res);
  }

  async getBranches(): Promise<BranchResponse[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/public/branches`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    return handleResponse<BranchResponse[]>(res);
  }

  async getServices(branchId?: string): Promise<ServiceItemResponse[]> {
    const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
    const res = await fetch(`${this.baseUrl}/api/v1/public/services${qs}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    return handleResponse<ServiceItemResponse[]>(res);
  }

  async getStaff(branchId?: string, serviceIds?: string[]): Promise<StaffPublicResponse[]> {
    let url = `${this.baseUrl}/api/v1/public/staff`;
    const params: string[] = [];
    if (branchId) params.push(`branch_id=${encodeURIComponent(branchId)}`);
    if (serviceIds && serviceIds.length > 0) params.push(`service_ids=${encodeURIComponent(serviceIds.join(','))}`);
    if (params.length > 0) url += `?${params.join('&')}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    return handleResponse<StaffPublicResponse[]>(res);
  }

  async getStaffServices(staffId: string, branchId?: string): Promise<ServiceItemResponse[]> {
    const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
    const res = await fetch(`${this.baseUrl}/api/v1/public/staff/${staffId}/services${qs}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    return handleResponse<ServiceItemResponse[]>(res);
  }

  async searchAvailability(payload: AvailabilitySearchRequest): Promise<AvailabilitySearchResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/public/availability/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<AvailabilitySearchResponse>(res);
  }

  /** Time-first step 1: free start times of the branch; then searchAvailability({ ..., at_utc }) for quotes. */
  async searchTimeFirst(payload: TimeFirstRequest): Promise<TimeFirstResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/public/availability/time-first`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<TimeFirstResponse>(res);
  }

  async createBooking(
    payload: CreatePublicBookingRequest,
    idempotencyKey?: string
  ): Promise<BookingCreatedResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const res = await fetch(`${this.baseUrl}/api/v1/public/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    return handleResponse<BookingCreatedResponse>(res);
  }

  async getManageBooking(token: string): Promise<PublicManageBookingResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/public/manage/${token}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    return handleResponse<PublicManageBookingResponse>(res);
  }

  async getBookingManage(token: string): Promise<PublicManageBookingResponse> {
    return this.getManageBooking(token);
  }

  async rescheduleBooking(token: string, payload: RescheduleRequest): Promise<PublicManageBookingResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/public/manage/${token}/reschedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<PublicManageBookingResponse>(res);
  }

  async cancelBooking(token: string, payload: CancelRequest = {}): Promise<PublicManageBookingResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/public/manage/${token}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<PublicManageBookingResponse>(res);
  }
}

export class BusinessCrmApiClient {
  private baseUrl: string;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? '';
  }

  private headers(token: string, tenantId?: string): Record<string, string> {
    const h: Record<string, string> = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
    if (tenantId) {
      h['X-Tenant-ID'] = tenantId;
    }
    return h;
  }


  async acceptInvite(payload: {
    token: string;
    password?: string;
    display_name?: string;
    full_name?: string;
    current_password?: string;
  }): Promise<TokenResponse> {
    const body: Record<string, any> = {
      token: payload.token,
    };
    if (payload.password) body.password = payload.password;
    if (payload.current_password) body.current_password = payload.current_password;
    if (payload.display_name || payload.full_name) {
      body.display_name = payload.display_name || payload.full_name;
    }
    const res = await fetch(`${this.baseUrl}/api/v1/auth/accept-invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return handleResponse<TokenResponse>(res);
  }
  async login(payload: LoginRequest): Promise<TokenResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<TokenResponse>(res);
  }

  async getMe(token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/me`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<any>(res);
  }

  async getCrmMe(token: string, tenantId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/me`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<any>(res);
  }

  async getDashboard(branchId: string | undefined, token: string, tenantId: string): Promise<any> {
    const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
    const res = await fetch(`${this.baseUrl}/api/v1/business/dashboard${qs}`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<any>(res);
  }

  // --- CALENDAR & BOOKINGS ---
  async getCalendar(
    params: { date: string; branch_id: string; staff_id?: string },
    token: string,
    tenantId: string
  ): Promise<any> {
    const qs = new URLSearchParams({
      date: params.date,
      branch_id: params.branch_id,
    });
    if (params.staff_id) qs.append('staff_id', params.staff_id);

    const res = await fetch(`${this.baseUrl}/api/v1/business/calendar?${qs.toString()}`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<any>(res);
  }

  async getBooking(id: string, token: string, tenantId: string): Promise<BookingCardResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/bookings/${id}`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<BookingCardResponse>(res);
  }

  async updateBookingStatus(
    id: string,
    payload: StatusUpdateRequest,
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/bookings/${id}/status`, {
      method: 'PATCH',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async createBooking(
    payload: CRMCreateBookingRequest,
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/bookings`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async rescheduleBooking(
    id: string,
    payload: { starts_at_utc?: string; new_starts_at_utc?: string; staff_id?: string; new_staff_id?: string },
    token: string,
    tenantId: string
  ): Promise<any> {
    const startsAt = payload.starts_at_utc || payload.new_starts_at_utc;
    const staffId = payload.staff_id || payload.new_staff_id;
    const res = await fetch(`${this.baseUrl}/api/v1/business/bookings/${id}/reschedule`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        starts_at_utc: startsAt,
        new_starts_at_utc: startsAt,
        staff_id: staffId,
        new_staff_id: staffId,
      }),
    });
    return handleResponse<any>(res);
  }

  async cancelBooking(
    id: string,
    payload: { reason?: string },
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/bookings/${id}/cancel`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async createCalendarBlock(
    payload: CalendarBlockCreateRequest,
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/calendar-blocks`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async deleteCalendarBlock(id: string, token: string, tenantId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/calendar-blocks/${id}`, {
      method: 'DELETE',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<any>(res);
  }

  // --- CUSTOMERS ---
  async getCustomers(
    params: {
      search?: string;
      min_visits?: number;
      visits_filter?: string;
      sort_by?: string;
      order?: string;
      limit?: number;
      offset?: number;
    } = {},
    token: string,
    tenantId: string
  ): Promise<CustomerResponse[]> {
    const qs = new URLSearchParams();
    if (params.search) qs.append('search', params.search);
    if (params.min_visits !== undefined) qs.append('min_visits', String(params.min_visits));
    if (params.visits_filter) qs.append('visits_filter', params.visits_filter);
    if (params.sort_by) qs.append('sort_by', params.sort_by);
    if (params.order) qs.append('order', params.order);
    if (params.limit) qs.append('limit', String(params.limit));
    if (params.offset) qs.append('offset', String(params.offset));

    const res = await fetch(`${this.baseUrl}/api/v1/business/customers?${qs.toString()}`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<CustomerResponse[]>(res);
  }

  async getCustomer(id: string, token: string, tenantId: string): Promise<CustomerResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/customers/${id}`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<CustomerResponse>(res);
  }

  async createCustomer(
    payload: {
      full_name: string;
      phone_e164: string;
      email?: string;
      notes_private?: string;
      confirm_shared_phone?: boolean;
    },
    token: string,
    tenantId: string
  ): Promise<CustomerResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/customers`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<CustomerResponse>(res);
  }

  async updateCustomer(
    id: string,
    payload: CustomerUpdateRequest,
    token: string,
    tenantId: string
  ): Promise<CustomerResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/customers/${id}`, {
      method: 'PATCH',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<CustomerResponse>(res);
  }

  async addCustomerNote(
    customerId: string,
    noteText: string,
    token: string,
    tenantId: string
  ): Promise<CustomerNoteResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/customers/${customerId}/notes`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ note: noteText, note_text: noteText }),
    });
    return handleResponse<CustomerNoteResponse>(res);
  }

  // --- STAFF ---
  async getStaff(
    params: { branch_id?: string } = {},
    token: string,
    tenantId: string
  ): Promise<StaffDetailResponse[]> {
    const qs = params.branch_id ? `?branch_id=${encodeURIComponent(params.branch_id)}` : '';
    const res = await fetch(`${this.baseUrl}/api/v1/business/staff${qs}`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<StaffDetailResponse[]>(res);
  }

  async getStaffDetail(id: string, token: string, tenantId: string): Promise<StaffDetailResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/staff/${id}`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<StaffDetailResponse>(res);
  }

  async createStaff(
    payload: StaffCreateRequest,
    token: string,
    tenantId: string
  ): Promise<StaffDetailResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/staff`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<StaffDetailResponse>(res);
  }

  async updateStaff(
    id: string,
    payload: Partial<StaffCreateRequest> & { active?: boolean },
    token: string,
    tenantId: string
  ): Promise<StaffDetailResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/staff/${id}`, {
      method: 'PATCH',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<StaffDetailResponse>(res);
  }

  async updateStaffServices(
    staffId: string,
    offers: StaffServiceOfferUpdateRequest[],
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/staff/${staffId}/services`, {
      method: 'PUT',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(offers),
    });
    return handleResponse<any>(res);
  }

  async getStaffSchedule(staffId: string, token: string, tenantId: string, branchId?: string): Promise<WeeklyShiftResponse[]> {
    const url = `${this.baseUrl}/api/v1/business/staff/${staffId}/schedule${branchId ? '?branch_id=' + branchId : ''}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<WeeklyShiftResponse[]>(res);
  }

  async updateStaffSchedule(
    staffId: string,
    shifts: any,
    token: string,
    tenantId: string,
    branchId?: string
  ): Promise<any> {
    const url = `${this.baseUrl}/api/v1/business/staff/${staffId}/schedule${branchId ? '?branch_id=' + branchId : ''}`;
    const payload = Array.isArray(shifts) ? { shifts } : shifts;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async getStaffTimeOff(
    staffId: string,
    token: string,
    tenantId: string
  ): Promise<StaffTimeOffResponse[]> {
    const url = `${this.baseUrl}/api/v1/business/staff/${staffId}/time-off`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<StaffTimeOffResponse[]>(res);
  }

  async createStaffTimeOff(
    staffId: string,
    payload: StaffTimeOffCreateRequest,
    token: string,
    tenantId: string
  ): Promise<StaffTimeOffResponse> {
    const url = `${this.baseUrl}/api/v1/business/staff/${staffId}/time-off`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<StaffTimeOffResponse>(res);
  }

  async deleteStaffTimeOff(
    staffId: string,
    timeOffId: string,
    token: string,
    tenantId: string
  ): Promise<any> {
    const url = `${this.baseUrl}/api/v1/business/staff/${staffId}/time-off/${timeOffId}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<any>(res);
  }

  // --- SERVICES & CATEGORIES ---
  async getServices(
    params: { branch_id?: string } = {},
    token: string,
    tenantId: string
  ): Promise<ServiceDetailResponse[]> {
    const qs = params.branch_id ? `?branch_id=${encodeURIComponent(params.branch_id)}` : '';
    const res = await fetch(`${this.baseUrl}/api/v1/business/services${qs}`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<ServiceDetailResponse[]>(res);
  }

  async createService(
    payload: ServiceCreateRequest,
    token: string,
    tenantId: string
  ): Promise<ServiceDetailResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/services`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<ServiceDetailResponse>(res);
  }

  async updateService(
    id: string,
    payload: ServiceUpdateRequest,
    token: string,
    tenantId: string
  ): Promise<ServiceDetailResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/services/${id}`, {
      method: 'PATCH',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<ServiceDetailResponse>(res);
  }

  async deleteService(id: string, token: string, tenantId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/services/${id}`, {
      method: 'DELETE',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<any>(res);
  }

  async getServiceCategories(token: string, tenantId: string): Promise<ServiceCategoryResponse[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/service-categories`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<ServiceCategoryResponse[]>(res);
  }

  async createServiceCategory(
    payload: ServiceCategoryCreateRequest,
    token: string,
    tenantId: string
  ): Promise<ServiceCategoryResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/service-categories`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<ServiceCategoryResponse>(res);
  }

  async updateServiceCategory(
    id: string,
    payload: ServiceCategoryUpdateRequest,
    token: string,
    tenantId: string
  ): Promise<ServiceCategoryResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/service-categories/${id}`, {
      method: 'PATCH',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<ServiceCategoryResponse>(res);
  }

  // --- ONLINE BOOKING SETTINGS ---
  async getBookingSettings(token: string, tenantId: string): Promise<BookingSettingsResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/booking-settings`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<BookingSettingsResponse>(res);
  }

  async updateBookingPolicy(
    payload: BookingPolicyUpdateRequest,
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/booking-settings`, {
      method: 'PATCH',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async updateBookingTheme(
    payload: { primary_color?: string; accent_color?: string },
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/booking-theme`, {
      method: 'PATCH',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async toggleBookingPublication(
    isPublished: boolean,
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/booking-publication?publish=${isPublished}`, {
      method: 'PATCH',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ is_published: isPublished }),
    });
    return handleResponse<any>(res);
  }

  // --- REPORTS ---
  async getReportsOverview(
    params: { from_date?: string; to_date?: string; period?: string; branch_id?: string } = {},
    token: string,
    tenantId: string
  ): Promise<ReportsOverviewResponse> {
    const qs = new URLSearchParams();
    const today = new Date().toISOString().split('T')[0];
    const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0];
    qs.append('from_date', params.from_date || monthAgo);
    qs.append('to_date', params.to_date || today);
    if (params.branch_id) qs.append('branch_id', params.branch_id);

    const res = await fetch(`${this.baseUrl}/api/v1/business/reports/overview?${qs.toString()}`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<ReportsOverviewResponse>(res);
  }

  // --- BRANCHES ---
  async getBranches(token: string, tenantId: string): Promise<BranchResponse[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/branches`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<BranchResponse[]>(res);
  }

  async createBranch(payload: any, token: string, tenantId: string): Promise<BranchResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/branches`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<BranchResponse>(res);
  }

  async updateBranch(id: string, payload: any, token: string, tenantId: string): Promise<BranchResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/branches/${id}`, {
      method: 'PATCH',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<BranchResponse>(res);
  }

  // --- USERS & INVITES ---
  async getUsers(token: string, tenantId: string): Promise<MembershipResponse[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/users`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<MembershipResponse[]>(res);
  }

  async createInvite(
    payload: InviteCreateRequest,
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/invites`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  // --- SUPPORT ACCESS (OWNER APPROVAL) ---
  async getPendingSupportAccessRequests(token: string, tenantId: string): Promise<BusinessPendingSupportRequest[]> {
    const res = await fetch(this.baseUrl + '/api/v1/business/access-requests/pending', {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<BusinessPendingSupportRequest[]>(res);
  }

  async approveTenantSupportAccess(requestId: string, token: string, tenantId: string): Promise<any> {
    const res = await fetch(this.baseUrl + '/api/v1/business/access-requests/' + encodeURIComponent(requestId) + '/approve', {
      method: 'POST',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<any>(res);
  }

  async denyTenantSupportAccess(requestId: string, token: string, tenantId: string): Promise<any> {
    const res = await fetch(this.baseUrl + '/api/v1/business/access-requests/' + encodeURIComponent(requestId) + '/deny', {
      method: 'POST',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<any>(res);
  }

  async getActiveSupportSessions(token: string, tenantId: string): Promise<BusinessActiveSupportSession[]> {
    const res = await fetch(this.baseUrl + '/api/v1/business/access-sessions/active', {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<BusinessActiveSupportSession[]>(res);
  }

  async revokeTenantSupportSession(sessionId: string, token: string, tenantId: string): Promise<any> {
    const res = await fetch(this.baseUrl + '/api/v1/business/access-sessions/' + encodeURIComponent(sessionId) + '/revoke', {
      method: 'POST',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<any>(res);
  }

  // ==========================================
  // SPRINT M12: Ручная касса и частичная оплата
  // ==========================================

  async createPayment(
    payload: PaymentCreateRequest,
    token: string,
    tenantId: string,
    idempotencyKey?: string
  ): Promise<PaymentRecord> {
    try {
      const headers = this.headers(token, tenantId);
      headers['Content-Type'] = 'application/json';
      if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;
      }
      const url = payload.booking_id
        ? `${this.baseUrl}/api/v1/business/bookings/${encodeURIComponent(payload.booking_id)}/payments`
        : `${this.baseUrl}/api/v1/business/payments`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const record = await handleResponse<PaymentRecord>(res);
        FinanceMockStorage.savePayment(tenantId, record);
        return record;
      }
    } catch (_) {}

    // Check idempotency in mock
    if (idempotencyKey) {
      const existing = FinanceMockStorage.getPayments(tenantId).find(
        p => p.idempotency_key === idempotencyKey
      );
      if (existing) {
        return existing;
      }
    }

    const openShift = FinanceMockStorage.getShifts(tenantId).find(s => s.status === 'open');
    const shiftId = payload.shift_id || openShift?.id || null;
    const branchId = openShift?.branch_id || '';

    const newPayment: PaymentRecord = {
      id: 'pay_' + Math.random().toString(36).substring(2, 10),
      tenant_id: tenantId,
      branch_id: branchId,
      booking_id: payload.booking_id,
      customer_id: payload.customer_id,
      amount_minor: payload.amount_minor,
      currency: 'KZT',
      payment_method: payload.payment_method,
      payment_type: payload.payment_type || 'payment',
      status: 'confirmed',
      cashier_name: payload.cashier_name || 'Администратор',
      comment: payload.comment,
      created_at: new Date().toISOString(),
      shift_id: shiftId,
      idempotency_key: idempotencyKey,
    };

    FinanceMockStorage.savePayment(tenantId, newPayment);
    return newPayment;
  }

  async getVisitPayments(
    bookingId: string,
    token: string,
    tenantId: string
  ): Promise<PaymentRecord[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/business/bookings/${encodeURIComponent(bookingId)}/payments`, {
        method: 'GET',
        headers: this.headers(token, tenantId),
      });
      if (res.ok) {
        return await handleResponse<PaymentRecord[]>(res);
      }
    } catch (_) {}

    return FinanceMockStorage.getPayments(tenantId).filter(p => p.booking_id === bookingId);
  }

  // ==========================================
  // SPRINT M13: Возвраты, авансы и кассовая смена
  // ==========================================

  async refundPayment(
    payload: PaymentRefundRequest,
    token: string,
    tenantId: string,
    idempotencyKey?: string
  ): Promise<PaymentRecord> {
    const all = FinanceMockStorage.getPayments(tenantId);
    const orig = all.find(p => p.id === payload.payment_id);
    const bookingId = payload.booking_id || orig?.booking_id;
    try {
      const headers = this.headers(token, tenantId);
      headers['Content-Type'] = 'application/json';
      if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;
      }
      const url = bookingId
        ? `${this.baseUrl}/api/v1/business/bookings/${encodeURIComponent(bookingId)}/refunds`
        : `${this.baseUrl}/api/v1/business/payments/${encodeURIComponent(payload.payment_id)}/refund`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const record = await handleResponse<PaymentRecord>(res);
        FinanceMockStorage.savePayment(tenantId, record);
        return record;
      }
    } catch (_) {}
    if (!orig) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Исходный платеж не найден');
    }

    const openShift = FinanceMockStorage.getShifts(tenantId).find(s => s.status === 'open');

    // CRITICAL: Return is a NEW corrective record, does NOT delete original payment!
    const refundRecord: PaymentRecord = {
      id: 'ref_' + Math.random().toString(36).substring(2, 10),
      tenant_id: tenantId,
      branch_id: orig.branch_id || openShift?.branch_id,
      booking_id: orig.booking_id,
      customer_id: orig.customer_id,
      amount_minor: payload.amount_minor,
      currency: orig.currency,
      payment_method: payload.payment_method || orig.payment_method,
      payment_type: 'refund',
      status: 'confirmed',
      cashier_name: payload.cashier_name || 'Администратор',
      comment: `Возврат: ${payload.reason}${payload.comment ? ` (${payload.comment})` : ''}`,
      created_at: new Date().toISOString(),
      shift_id: openShift?.id || null,
      original_payment_id: orig.id,
      idempotency_key: idempotencyKey,
    };

    FinanceMockStorage.savePayment(tenantId, refundRecord);
    return refundRecord;
  }

  async getCurrentCashShift(
    branchId: string,
    token: string,
    tenantId: string
  ): Promise<CashShiftSummary | null> {
    try {
      const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
      const res = await fetch(`${this.baseUrl}/api/v1/business/cash/shifts/current${qs}`, {
        method: 'GET',
        headers: this.headers(token, tenantId),
      });
      if (res.ok) {
        return await handleResponse<CashShiftSummary>(res);
      }
    } catch (_) {}

    const shifts = FinanceMockStorage.getShifts(tenantId);
    const openShift = shifts.find(s => s.status === 'open' && (!branchId || s.branch_id === branchId));
    if (!openShift) return null;

    // Calculate shift movements
    const payments = FinanceMockStorage.getPayments(tenantId).filter(
      p => p.shift_id === openShift.id || (p.branch_id === openShift.branch_id && new Date(p.created_at) >= new Date(openShift.opened_at))
    );

    let cash_inflow = 0;
    let cash_refund = 0;
    let card_inflow = 0;
    let advance_inflow = 0;

    for (const p of payments) {
      if (p.payment_type === 'refund') {
        if (p.payment_method === 'cash') cash_refund += p.amount_minor;
      } else if (p.payment_type === 'advance') {
        advance_inflow += p.amount_minor;
        if (p.payment_method === 'cash') cash_inflow += p.amount_minor;
        else card_inflow += p.amount_minor;
      } else {
        if (p.payment_method === 'cash') cash_inflow += p.amount_minor;
        else card_inflow += p.amount_minor;
      }
    }

    const expected_cash = openShift.opening_balance_minor + cash_inflow - cash_refund;

    return {
      shift: openShift,
      cash_inflow_minor: cash_inflow,
      cash_refund_minor: cash_refund,
      card_inflow_minor: card_inflow,
      advance_inflow_minor: advance_inflow,
      expected_cash_balance_minor: expected_cash,
      transactions_count: payments.length,
    };
  }

  async openCashShift(
    payload: ShiftOpenRequest,
    token: string,
    tenantId: string
  ): Promise<CashShift> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/business/cash/shifts/open`, {
        method: 'POST',
        headers: {
          ...this.headers(token, tenantId),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const record = await handleResponse<CashShift>(res);
        FinanceMockStorage.saveShift(tenantId, record);
        return record;
      }
    } catch (_) {}

    const newShift: CashShift = {
      id: 'shift_' + Math.random().toString(36).substring(2, 10),
      tenant_id: tenantId,
      branch_id: payload.branch_id,
      status: 'open',
      opened_by: payload.opened_by,
      opened_at: new Date().toISOString(),
      opening_balance_minor: payload.opening_balance_minor,
      comment: payload.comment || null,
    };

    FinanceMockStorage.saveShift(tenantId, newShift);
    return newShift;
  }

  async closeCashShift(
    payload: ShiftCloseRequest,
    token: string,
    tenantId: string
  ): Promise<CashShift> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/business/cash/shifts/${encodeURIComponent(payload.shift_id)}/close`, {
        method: 'POST',
        headers: {
          ...this.headers(token, tenantId),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const record = await handleResponse<CashShift>(res);
        FinanceMockStorage.saveShift(tenantId, record);
        return record;
      }
    } catch (_) {}

    const shifts = FinanceMockStorage.getShifts(tenantId);
    const shift = shifts.find(s => s.id === payload.shift_id);
    if (!shift) {
      throw new ApiError(404, 'SHIFT_NOT_FOUND', 'Смена не найдена');
    }

    const summary = await this.getCurrentCashShift(shift.branch_id, token, tenantId);
    const expected = summary?.expected_cash_balance_minor ?? shift.opening_balance_minor;
    const diff = payload.closing_cash_actual_minor - expected;

    shift.status = 'closed';
    shift.closed_by = payload.closed_by;
    shift.closed_at = new Date().toISOString();
    shift.closing_cash_actual_minor = payload.closing_cash_actual_minor;
    shift.closing_cash_expected_minor = expected;
    shift.difference_minor = diff;
    if (payload.comment) shift.comment = payload.comment;

    FinanceMockStorage.saveShift(tenantId, shift);
    return shift;
  }

  async getCashShifts(
    branchId: string,
    token: string,
    tenantId: string
  ): Promise<CashShift[]> {
    try {
      const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
      const res = await fetch(`${this.baseUrl}/api/v1/business/cash/shifts${qs}`, {
        method: 'GET',
        headers: this.headers(token, tenantId),
      });
      if (res.ok) {
        return await handleResponse<CashShift[]>(res);
      }
    } catch (_) {}

    return FinanceMockStorage.getShifts(tenantId).filter(
      s => !branchId || s.branch_id === branchId
    );
  }

  // ==========================================
  // SPRINT M14: Расходы и базовые отчёты
  // ==========================================

  async getExpenses(
    branchId?: string,
    token?: string,
    tenantId?: string,
    fromDate?: string,
    toDate?: string
  ): Promise<ExpenseRecord[]> {
    if (token && tenantId) {
      try {
        const params: string[] = [];
        if (branchId) params.push(`branch_id=${encodeURIComponent(branchId)}`);
        if (fromDate) params.push(`from_date=${encodeURIComponent(fromDate)}`);
        if (toDate) params.push(`to_date=${encodeURIComponent(toDate)}`);
        const qs = params.length > 0 ? `?${params.join('&')}` : '';
        const res = await fetch(`${this.baseUrl}/api/v1/business/expenses${qs}`, {
          method: 'GET',
          headers: this.headers(token, tenantId),
        });
        if (res.ok) {
          return await handleResponse<ExpenseRecord[]>(res);
        }
      } catch (_) {}
    }

    let list = tenantId ? FinanceMockStorage.getExpenses(tenantId) : [];
    if (branchId) {
      list = list.filter(e => !e.branch_id || e.branch_id === branchId);
    }
    if (fromDate) {
      list = list.filter(e => e.expense_date >= fromDate);
    }
    if (toDate) {
      list = list.filter(e => e.expense_date <= toDate);
    }
    return list;
  }

  async createExpense(
    payload: ExpenseCreateRequest,
    token: string,
    tenantId: string
  ): Promise<ExpenseRecord> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/business/expenses`, {
        method: 'POST',
        headers: {
          ...this.headers(token, tenantId),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const record = await handleResponse<ExpenseRecord>(res);
        FinanceMockStorage.saveExpense(tenantId, record);
        return record;
      }
    } catch (_) {}

    const newExp: ExpenseRecord = {
      id: 'exp_' + Math.random().toString(36).substring(2, 10),
      tenant_id: tenantId,
      branch_id: payload.branch_id,
      category: payload.category,
      amount_minor: payload.amount_minor,
      currency: 'KZT',
      expense_date: payload.expense_date,
      created_by: payload.created_by,
      payment_method: payload.payment_method,
      comment: payload.comment,
      created_at: new Date().toISOString(),
    };

    FinanceMockStorage.saveExpense(tenantId, newExp);
    return newExp;
  }

  async deleteExpense(
    expenseId: string,
    token: string,
    tenantId: string
  ): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/v1/business/expenses/${encodeURIComponent(expenseId)}`, {
        method: 'DELETE',
        headers: this.headers(token, tenantId),
      });
    } catch (_) {}
    FinanceMockStorage.deleteExpense(tenantId, expenseId);
  }

  async getVisitsReport(
    params: { branchId?: string; fromDate?: string; toDate?: string; staffId?: string },
    token: string,
    tenantId: string
  ): Promise<VisitsReportData> {
    try {
      const q = new URLSearchParams();
      if (params.branchId) q.set('branch_id', params.branchId);
      if (params.fromDate) q.set('from_date', params.fromDate);
      if (params.toDate) q.set('to_date', params.toDate);
      if (params.staffId) q.set('staff_id', params.staffId);
      const res = await fetch(`${this.baseUrl}/api/v1/business/reports/visits?${q.toString()}`, {
        method: 'GET',
        headers: this.headers(token, tenantId),
      });
      if (res.ok) return await handleResponse<VisitsReportData>(res);
    } catch (_) {}

    // Generate from calendar data
    let bookings: any[] = [];
    try {
      const cal = await this.getCalendar(
        { date: params.fromDate || new Date().toISOString().split('T')[0], branch_id: params.branchId || '', staff_id: params.staffId },
        token,
        tenantId
      );
      bookings = cal?.bookings || [];
    } catch (_) {}

    if (params.staffId) {
      bookings = bookings.filter((b: any) => b.staff_id === params.staffId);
    }

    const total = bookings.length;
    const completed = bookings.filter((b: any) => b.status === 'completed').length;
    const cancelled = bookings.filter((b: any) => b.status === 'cancelled').length;
    const arrived = bookings.filter((b: any) => b.status === 'arrived').length;
    const in_progress = bookings.filter((b: any) => b.status === 'in_progress').length;
    const no_show = bookings.filter((b: any) => b.status === 'no_show').length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const items = bookings.map((b: any) => {
      const d = new Date(b.starts_at_utc);
      return {
        id: b.id,
        public_ref: b.public_ref,
        customer_name: b.customer_name,
        staff_name: b.staff_name,
        services: b.services,
        date_display: d.toISOString().split('T')[0],
        time_display: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: b.status,
        amount_minor: b.amount_minor,
      };
    });

    return {
      total_bookings: total,
      completed_bookings: completed,
      cancelled_bookings: cancelled,
      arrived_bookings: arrived,
      in_progress_bookings: in_progress,
      no_show_bookings: no_show,
      completion_rate_percent: rate,
      items,
    };
  }

  async getServicesReport(
    params: { branchId?: string; fromDate?: string; toDate?: string },
    token: string,
    tenantId: string
  ): Promise<ServicesReportData> {
    try {
      const q = new URLSearchParams();
      if (params.branchId) q.set('branch_id', params.branchId);
      if (params.fromDate) q.set('from_date', params.fromDate);
      if (params.toDate) q.set('to_date', params.toDate);
      const res = await fetch(`${this.baseUrl}/api/v1/business/reports/services?${q.toString()}`, {
        method: 'GET',
        headers: this.headers(token, tenantId),
      });
      if (res.ok) return await handleResponse<ServicesReportData>(res);
    } catch (_) {}

    let bookings: any[] = [];
    try {
      const cal = await this.getCalendar(
        { date: params.fromDate || new Date().toISOString().split('T')[0], branch_id: params.branchId || '' },
        token,
        tenantId
      );
      bookings = cal?.bookings || [];
    } catch (_) {}

    const completed = bookings.filter((b: any) => b.status === 'completed');

    const serviceCounts: Record<string, { count: number; total_minor: number }> = {};
    let totalServicesCount = 0;
    let totalRendered = 0;

    for (const b of completed) {
      const srvList = b.services || ['Услуга'];
      const perServiceAmount = Math.round(b.amount_minor / srvList.length);
      for (const sName of srvList) {
        if (!serviceCounts[sName]) {
          serviceCounts[sName] = { count: 0, total_minor: 0 };
        }
        serviceCounts[sName].count += 1;
        serviceCounts[sName].total_minor += perServiceAmount;
        totalServicesCount += 1;
        totalRendered += perServiceAmount;
      }
    }

    const top_services = Object.entries(serviceCounts).map(([name, data]) => ({
      service_id: name,
      service_name: name,
      count: data.count,
      total_minor: data.total_minor,
      percentage: totalRendered > 0 ? Math.round((data.total_minor / totalRendered) * 100) : 0,
    })).sort((a, b) => b.total_minor - a.total_minor);

    return {
      total_services_count: totalServicesCount,
      total_rendered_minor: totalRendered,
      average_ticket_minor: totalServicesCount > 0 ? Math.round(totalRendered / totalServicesCount) : 0,
      top_services,
    };
  }

  async getFinanceReport(
    params: { branchId?: string; fromDate?: string; toDate?: string },
    token: string,
    tenantId: string
  ): Promise<FinanceReportData> {
    try {
      const q = new URLSearchParams();
      if (params.branchId) q.set('branch_id', params.branchId);
      if (params.fromDate) q.set('from_date', params.fromDate);
      if (params.toDate) q.set('to_date', params.toDate);
      const res = await fetch(`${this.baseUrl}/api/v1/business/reports/finance?${q.toString()}`, {
        method: 'GET',
        headers: this.headers(token, tenantId),
      });
      if (res.ok) {
        const raw = await handleResponse<any>(res);
        if (raw && raw.total) {
          const t = raw.total;
          const cashIn = t.received_by_account_kind?.cash ?? 0;
          const cardIn = (t.received_by_account_kind?.bank_transfer ?? 0) + (t.received_by_account_kind?.card ?? 0);
          return {
            rendered_minor: t.rendered_minor ?? 0,
            paid_minor: t.received_minor ?? 0,
            debt_minor: t.receivables_end_minor ?? 0,
            expenses_minor: t.expenses_minor ?? 0,
            refunds_minor: 0,
            advances_minor: t.advances_received_minor ?? 0,
            net_cash_flow_minor: t.net_cash_flow_minor ?? 0,
            cash_inflow_minor: cashIn,
            card_inflow_minor: cardIn,
          };
        }
        return raw;
      }
    } catch (_) {}

    // Strict Sprint M14 Rule:
    // Rendered = strictly completed bookings sum
    // Paid = actual payment transactions minus refunds
    // Debt = Rendered - Paid
    let bookings: any[] = [];
    try {
      const cal = await this.getCalendar(
        { date: params.fromDate || new Date().toISOString().split('T')[0], branch_id: params.branchId || '' },
        token,
        tenantId
      );
      bookings = cal?.bookings || [];
    } catch (_) {}

    const completedBookings = bookings.filter((b: any) => b.status === 'completed');
    const rendered_minor = completedBookings.reduce((sum: number, b: any) => sum + (b.cost_minor || b.amount_minor || 0), 0);

    const allPayments = FinanceMockStorage.getPayments(tenantId);
    let cash_inflow = 0;
    let card_inflow = 0;
    let advance_inflow = 0;
    let refunds_minor = 0;

    for (const p of allPayments) {
      if (params.branchId && p.branch_id && p.branch_id !== params.branchId) continue;
      if (params.fromDate && p.created_at < params.fromDate) continue;
      if (params.toDate && p.created_at > params.toDate + 'T23:59:59.999Z') continue;

      if (p.payment_type === 'refund') {
        refunds_minor += p.amount_minor;
      } else if (p.payment_type === 'advance') {
        advance_inflow += p.amount_minor;
      } else {
        if (p.payment_method === 'cash') {
          cash_inflow += p.amount_minor;
        } else {
          card_inflow += p.amount_minor;
        }
      }
    }

    const paid_minor = (cash_inflow + card_inflow) - refunds_minor;
    const debt_minor = Math.max(0, rendered_minor - paid_minor);

    const expensesList = await this.getExpenses(params.branchId, token, tenantId, params.fromDate, params.toDate);
    const expenses_minor = expensesList.reduce((s: number, e: ExpenseRecord) => s + e.amount_minor, 0);

    const net_cash_flow_minor = paid_minor + advance_inflow - expenses_minor;

    return {
      rendered_minor,
      paid_minor,
      debt_minor,
      expenses_minor,
      refunds_minor,
      advances_minor: advance_inflow,
      net_cash_flow_minor,
      cash_inflow_minor: cash_inflow,
      card_inflow_minor: card_inflow,
    };
  }

  async getDebtsReport(
    params: { branchId?: string },
    token: string,
    tenantId: string
  ): Promise<DebtsReportData> {
    try {
      const q = new URLSearchParams();
      if (params.branchId) q.set('branch_id', params.branchId);
      const res = await fetch(`${this.baseUrl}/api/v1/business/reports/debts?${q.toString()}`, {
        method: 'GET',
        headers: this.headers(token, tenantId),
      });
      if (res.ok) return await handleResponse<DebtsReportData>(res);
    } catch (_) {}

    let bookings: any[] = [];
    try {
      const cal = await this.getCalendar(
        { date: new Date().toISOString().split('T')[0], branch_id: params.branchId || '' },
        token,
        tenantId
      );
      bookings = cal?.bookings || [];
    } catch (_) {}

    const allPayments = FinanceMockStorage.getPayments(tenantId);

    const items: DebtItem[] = [];
    let totalDebt = 0;

    for (const b of bookings) {
      // Debt exists when service was rendered (completed) and cost > paid
      const cost = b.cost_minor || b.amount_minor || 0;
      const isCompleted = b.status === 'completed';
      const rendered = isCompleted ? cost : 0;

      const visitPayments = allPayments.filter(p => p.booking_id === b.id);
      let paid = 0;
      for (const p of visitPayments) {
        if (p.payment_type === 'refund') paid -= p.amount_minor;
        else paid += p.amount_minor;
      }
      paid = Math.max(0, paid);

      const debt = isCompleted ? Math.max(0, rendered - paid) : 0;
      if (debt > 0) {
        totalDebt += debt;
        const d = new Date(b.starts_at_utc);
        items.push({
          booking_id: b.id,
          public_ref: b.public_ref,
          customer_id: b.customer_id,
          customer_name: b.customer_name,
          customer_phone: b.customer_phone,
          visit_date: d.toISOString().split('T')[0],
          cost_minor: cost,
          rendered_minor: rendered,
          paid_minor: paid,
          debt_minor: debt,
          payment_status: paid > 0 ? 'partially_paid' : 'unpaid',
          services: b.services,
        });
      }
    }

    return {
      total_debt_minor: totalDebt,
      debtors_count: items.length,
      items,
    };
  }
}

// Client-side mock repository for M12, M13, M14 (fallback when backend route not yet available)
class FinanceMockStorage {
  private static getKey(tenantId: string, resource: string) {
    return `crm_finance_${tenantId}_${resource}`;
  }

  private static load<T>(tenantId: string, resource: string): T[] {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(this.getKey(tenantId, resource));
        if (raw) return JSON.parse(raw);
      }
    } catch (_) {}
    return [];
  }

  private static save<T>(tenantId: string, resource: string, data: T[]): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(this.getKey(tenantId, resource), JSON.stringify(data));
      }
    } catch (_) {}
  }

  static getPayments(tenantId: string): PaymentRecord[] {
    return this.load<PaymentRecord>(tenantId, 'payments');
  }

  static savePayment(tenantId: string, payment: PaymentRecord): void {
    const list = this.getPayments(tenantId);
    list.unshift(payment);
    this.save(tenantId, 'payments', list);
  }

  static getShifts(tenantId: string): CashShift[] {
    return this.load<CashShift>(tenantId, 'shifts');
  }

  static saveShift(tenantId: string, shift: CashShift): void {
    const list = this.getShifts(tenantId);
    const idx = list.findIndex(s => s.id === shift.id);
    if (idx >= 0) {
      list[idx] = shift;
    } else {
      list.unshift(shift);
    }
    this.save(tenantId, 'shifts', list);
  }

  static getExpenses(tenantId: string): ExpenseRecord[] {
    return this.load<ExpenseRecord>(tenantId, 'expenses');
  }

  static saveExpense(tenantId: string, exp: ExpenseRecord): void {
    const list = this.getExpenses(tenantId);
    list.unshift(exp);
    this.save(tenantId, 'expenses', list);
  }

  static deleteExpense(tenantId: string, id: string): void {
    const list = this.getExpenses(tenantId).filter(e => e.id !== id);
    this.save(tenantId, 'expenses', list);
  }
}

export * from './types';

export class PlatformApiClient {
  private baseUrl: string;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? '';
  }

  private headers(token: string, idempotencyKey?: string): Record<string, string> {
    const h: Record<string, string> = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
    if (idempotencyKey) {
      h['Idempotency-Key'] = idempotencyKey;
    }
    return h;
  }

  async login(payload: LoginRequest): Promise<TokenResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<TokenResponse>(res);
  }

  async getMe(token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/me`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<any>(res);
  }

  // --- OVERVIEW ---
  async getOverview(token: string): Promise<PlatformOverviewResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/overview`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformOverviewResponse>(res);
  }

  // --- TENANTS REGISTRY ---
  async getTenants(
    params: {
      query?: string;
      status_filter?: string;
      niche?: string;
      plan_code?: string;
      payment_status?: string;
    } = {},
    token: string
  ): Promise<PlatformTenantListItem[]> {
    const qs = new URLSearchParams();
    if (params.query) qs.append('query', params.query);
    if (params.status_filter) qs.append('status_filter', params.status_filter);
    if (params.niche) qs.append('niche', params.niche);
    if (params.plan_code) qs.append('plan_code', params.plan_code);
    if (params.payment_status) qs.append('payment_status', params.payment_status);

    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants?${qs.toString()}`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformTenantListItem[]>(res);
  }

  async createTenant(payload: any, token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async getTenantDetails(tenantId: string, token: string): Promise<PlatformTenantDetailResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants/${tenantId}`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformTenantDetailResponse>(res);
  }

  async getTenantUsers(tenantId: string, token: string): Promise<PlatformTenantUsersResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants/${tenantId}/users`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformTenantUsersResponse>(res);
  }

  async resendInvite(tenantId: string, email: string, token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants/${tenantId}/resend-invite`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return handleResponse<any>(res);
  }

  async getTenantEntitlements(tenantId: string, token: string): Promise<PlatformTenantEntitlement[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants/${tenantId}/entitlements`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformTenantEntitlement[]>(res);
  }

  async setTenantEntitlementOverride(
    tenantId: string,
    payload: { feature_key: string; override_value?: number | null; expires_days?: number; reason: string },
    token: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants/${tenantId}/entitlements`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async getTenantActivity(tenantId: string, token: string): Promise<PlatformAuditEventItem[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants/${tenantId}/activity`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformAuditEventItem[]>(res);
  }

  async changeTenantPlan(
    tenantId: string,
    payload: { new_plan_code: string; reason?: string },
    token: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants/${tenantId}/change-plan`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async suspendTenant(tenantId: string, reason: string, token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants/${tenantId}/suspend`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    return handleResponse<any>(res);
  }

  async reactivateTenant(tenantId: string, reason: string, token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/tenants/${tenantId}/reactivate`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    return handleResponse<any>(res);
  }

  // --- SUBSCRIPTIONS & CHARGES ---
  async getSubscriptions(
    params: { status_filter?: string; query?: string } = {},
    token: string
  ): Promise<PlatformSubscriptionItem[]> {
    const qs = new URLSearchParams();
    if (params.status_filter) qs.append('status_filter', params.status_filter);
    if (params.query) qs.append('query', params.query);

    const res = await fetch(`${this.baseUrl}/api/v1/platform/subscriptions?${qs.toString()}`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformSubscriptionItem[]>(res);
  }

  async renewSubscription(
    subscriptionId: string,
    payload: {
      extend_days?: number;
      record_payment?: boolean;
      amount_minor?: number;
      evidence_reference?: string;
      payment_method?: string;
    },
    token: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/subscriptions/${subscriptionId}/renew`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async getCharges(
    params: { status_filter?: string; tenant_id?: string } = {},
    token: string
  ): Promise<PlatformChargeItem[]> {
    const qs = new URLSearchParams();
    if (params.status_filter) qs.append('status_filter', params.status_filter);
    if (params.tenant_id) qs.append('tenant_id', params.tenant_id);

    const res = await fetch(`${this.baseUrl}/api/v1/platform/charges?${qs.toString()}`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformChargeItem[]>(res);
  }

  async issueCharge(
    subscriptionId: string,
    payload: {
      period_start: string;
      period_end: string;
      amount_minor: number;
      currency?: string;
      evidence_reference?: string;
    },
    token: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/subscriptions/${subscriptionId}/charges`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async recordPayment(
    chargeId: string,
    payload: {
      amount_minor: number;
      evidence_reference: string;
      payment_method?: string;
      note?: string;
    },
    token: string,
    idempotencyKey?: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/charges/${chargeId}/record-payment`, {
      method: 'POST',
      headers: {
        ...this.headers(token, idempotencyKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  // --- PLANS ---
  async getPlans(token: string): Promise<PlatformPlanItem[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/plans`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformPlanItem[]>(res);
  }

  async createPlan(
    payload: {
      code: string;
      name: string;
      description?: string;
      price_minor: number;
      currency?: string;
      max_branches?: number;
      max_active_staff?: number;
    },
    token: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/plans`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async createPlanVersion(
    planId: string,
    payload: {
      price_minor: number;
      currency?: string;
      max_branches?: number;
      max_active_staff?: number;
      online_booking?: boolean;
      basic_reports?: boolean;
    },
    token: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/plans/${planId}/versions`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  // --- MODULES CATALOG ---
  async getModulesCatalog(token: string): Promise<PlatformFeatureItem[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/modules/catalog`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformFeatureItem[]>(res);
  }

  // --- SUPPORT & DIAGNOSIS ---
  async getSupportTickets(
    params: { status_filter?: string; tenant_id?: string } = {},
    token: string
  ): Promise<PlatformSupportTicketItem[]> {
    const qs = new URLSearchParams();
    if (params.status_filter) qs.append('status_filter', params.status_filter);
    if (params.tenant_id) qs.append('tenant_id', params.tenant_id);

    const res = await fetch(`${this.baseUrl}/api/v1/platform/support/tickets?${qs.toString()}`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformSupportTicketItem[]>(res);
  }

  async createSupportTicket(
    payload: {
      tenant_id: string;
      subject: string;
      priority?: string;
      initial_message: string;
    },
    token: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/support/tickets`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async getSupportTicketDetails(ticketId: string, token: string): Promise<PlatformSupportTicketDetail> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/support/tickets/${ticketId}`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformSupportTicketDetail>(res);
  }

  async addSupportMessage(
    ticketId: string,
    payload: { message: string; is_internal?: boolean },
    token: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/support/tickets/${ticketId}/messages`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async getTenantDiagnosis(tenantId: string, token: string): Promise<PlatformDiagnosisResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/support/diagnosis/${tenantId}`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformDiagnosisResponse>(res);
  }

  async getAccessRequests(token: string): Promise<PlatformAccessRequestItem[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/access-requests`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformAccessRequestItem[]>(res);
  }

  async createAccessRequest(
    payload: { tenant_id: string; reason: string; requested_scope?: string },
    token: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/access-requests`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async approveAccessRequest(requestId: string, token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/access-requests/${requestId}/approve`, {
      method: 'POST',
      headers: this.headers(token),
    });
    return handleResponse<any>(res);
  }

  async revokeAccessRequest(requestId: string, token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/access-requests/${requestId}/revoke`, {
      method: 'POST',
      headers: this.headers(token),
    });
    return handleResponse<any>(res);
  }

  async getActiveSupportSession(token: string): Promise<PlatformActiveSessionResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/support/active-session`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformActiveSessionResponse>(res);
  }

  // --- AUDIT LOGS ---
  async getAuditLogs(
    params: { target_tenant_id?: string; action?: string; actor_email?: string; limit?: number } = {},
    token: string
  ): Promise<PlatformAuditEventItem[]> {
    const qs = new URLSearchParams();
    if (params.target_tenant_id) qs.append('target_tenant_id', params.target_tenant_id);
    if (params.action) qs.append('action', params.action);
    if (params.actor_email) qs.append('actor_email', params.actor_email);
    if (params.limit) qs.append('limit', String(params.limit));

    const res = await fetch(`${this.baseUrl}/api/v1/platform/audit?${qs.toString()}`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformAuditEventItem[]>(res);
  }

  // --- STAFF & SETTINGS ---
  async getStaff(token: string): Promise<PlatformStaffItem[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/staff`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformStaffItem[]>(res);
  }

  async createStaff(
    payload: { email: string; display_name: string; platform_role?: string; allow_crm_user_upgrade?: boolean },
    token: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/staff`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async activateStaff(
    payload: { activation_token: string; password?: string; current_password?: string; display_name?: string }
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/staff/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }

  async approveTenantSupportAccess(requestId: string, token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/access-requests/${requestId}/approve`, {
      method: 'POST',
      headers: this.headers(token),
    });
    return handleResponse<any>(res);
  }

  async denyTenantSupportAccess(requestId: string, token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/access-requests/${requestId}/deny`, {
      method: 'POST',
      headers: this.headers(token),
    });
    return handleResponse<any>(res);
  }

  async getSettings(token: string): Promise<PlatformSettingsResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/settings`, {
      method: 'GET',
      headers: this.headers(token),
    });
    return handleResponse<PlatformSettingsResponse>(res);
  }

  async updateSetting(key: string, payload: { value: any; description?: string }, token: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/platform/settings/${key}`, {
      method: 'PATCH',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }
}

export * from './types';
