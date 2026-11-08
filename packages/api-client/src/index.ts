import {
  PublicSiteResponse,
  BranchResponse,
  ServiceItemResponse,
  StaffPublicResponse,
  AvailabilitySearchRequest,
  AvailabilitySearchResponse,
  CreatePublicBookingRequest,
  BookingCreatedResponse,
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

  async getStaff(branchId?: string): Promise<StaffPublicResponse[]> {
    const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
    const res = await fetch(`${this.baseUrl}/api/v1/public/staff${qs}`, {
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

  async getBooking(id: string, token: string, tenantId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/bookings/${id}`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<any>(res);
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
    payload: { starts_at_utc: string; staff_id?: string },
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/bookings/${id}/reschedule`, {
      method: 'POST',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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
    params: { search?: string; limit?: number; offset?: number } = {},
    token: string,
    tenantId: string
  ): Promise<CustomerResponse[]> {
    const qs = new URLSearchParams();
    if (params.search) qs.append('search', params.search);
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
    payload: { full_name: string; phone_e164: string; email?: string; notes_private?: string },
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
      body: JSON.stringify({ note_text: noteText }),
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

  async getStaffSchedule(staffId: string, token: string, tenantId: string): Promise<WeeklyShiftResponse[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/staff/${staffId}/schedule`, {
      method: 'GET',
      headers: this.headers(token, tenantId),
    });
    return handleResponse<WeeklyShiftResponse[]>(res);
  }

  async updateStaffSchedule(
    staffId: string,
    shifts: WeeklyShiftResponse[],
    token: string,
    tenantId: string
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/staff/${staffId}/schedule`, {
      method: 'PUT',
      headers: {
        ...this.headers(token, tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(shifts),
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
    const res = await fetch(`${this.baseUrl}/api/v1/business/booking-publication/publish`, {
      method: 'POST',
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
}
