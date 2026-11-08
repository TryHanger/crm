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

  async getBookingManage(token: string): Promise<PublicManageBookingResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/public/manage/${token}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    return handleResponse<PublicManageBookingResponse>(res);
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
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    return handleResponse<any>(res);
  }

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
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Tenant-ID': tenantId,
      },
    });
    return handleResponse<any>(res);
  }

  async getBooking(id: string, token: string, tenantId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/business/bookings/${id}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Tenant-ID': tenantId,
      },
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
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Tenant-ID': tenantId,
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
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Tenant-ID': tenantId,
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<any>(res);
  }
}
