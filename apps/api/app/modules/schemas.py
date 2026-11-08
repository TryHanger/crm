import uuid
import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field, EmailStr, model_validator

# Standard Error Envelope
class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Optional[Any] = None

class ErrorResponse(BaseModel):
    error: ErrorDetail
    request_id: Optional[str] = None

# Auth Schemas
class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: uuid.UUID
    display_name: str
    email: str
    role: Optional[str] = None
    platform_role: Optional[str] = None

# Public Site Schemas
class PublicSiteResponse(BaseModel):
    tenant_id: uuid.UUID
    slug: str
    display_name: str
    business_name: str
    timezone: str
    primary_color: str
    accent_color: str
    logo_url: Optional[str] = None
    cancellation_cutoff_minutes: int
    book_ahead_days: int
    min_advance_minutes: int
    max_services_per_booking: int
    is_published: bool

class BranchResponse(BaseModel):
    id: uuid.UUID
    name: str
    city: str
    address: str
    timezone_iana: str
    timezone: Optional[str] = None
    phone: Optional[str] = None
    phone_number: Optional[str] = None
    weekly_hours: Optional[Any] = None

    @model_validator(mode="before")
    @classmethod
    def populate_aliases(cls, data: Any) -> Any:
        if hasattr(data, "__dict__"):
            d = data.__dict__
            d["timezone"] = getattr(data, "timezone_iana", None)
            d["phone_number"] = getattr(data, "phone", None)
            return data
        elif isinstance(data, dict):
            if "timezone" not in data and "timezone_iana" in data:
                data["timezone"] = data["timezone_iana"]
            if "phone_number" not in data and "phone" in data:
                data["phone_number"] = data["phone"]
            if "timezone_iana" not in data and "timezone" in data:
                data["timezone_iana"] = data["timezone"]
            if "phone" not in data and "phone_number" in data:
                data["phone"] = data["phone_number"]
        return data

class ServiceItemResponse(BaseModel):
    id: uuid.UUID
    category_id: Optional[uuid.UUID] = None
    category_name: Optional[str] = None
    name: str
    description: Optional[str] = None
    base_price_minor: int
    price_formatted: str
    currency: str
    base_duration_minutes: int

class StaffPublicResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    role_title: str
    color: str

class AvailabilitySearchRequest(BaseModel):
    branch_id: uuid.UUID
    service_ids: List[uuid.UUID]
    from_date: datetime.date
    to_date: datetime.date
    staff_id: Optional[uuid.UUID] = None
    staff_mode: str = Field(default="any")  # "specific" or "any"

class SlotResponse(BaseModel):
    staff_id: str
    staff_name: str
    staff_role: str
    starts_at_utc: str
    ends_at_utc: str
    duration_minutes: int
    price_minor: int
    currency: str
    quote_id: str
    quote_expires_at: str

class AvailabilitySearchResponse(BaseModel):
    slots: List[SlotResponse]
    total_count: int

class CreatePublicBookingRequest(BaseModel):
    branch_id: uuid.UUID
    staff_id: uuid.UUID
    service_ids: List[uuid.UUID]
    starts_at_utc: datetime.datetime
    customer_name: str
    customer_phone: str
    customer_email: Optional[str] = None
    notes: Optional[str] = None
    quote_id: Optional[uuid.UUID] = None
    expected_price_minor: Optional[int] = None

class BookingCreatedResponse(BaseModel):
    booking_id: uuid.UUID
    public_ref: str
    status: str
    starts_at_utc: datetime.datetime
    service_ends_at_utc: datetime.datetime
    total_amount_minor: int
    currency: str
    management_token: str
    management_url: str

class PublicManageBookingResponse(BaseModel):
    booking_id: uuid.UUID
    public_ref: str
    status: str
    starts_at_utc: datetime.datetime
    service_ends_at_utc: datetime.datetime
    total_amount_minor: int
    currency: str
    branch_id: uuid.UUID
    staff_id: uuid.UUID
    service_ids: List[uuid.UUID]
    customer_name: str
    customer_phone_masked: str
    cancellation_cutoff_minutes: int
    can_cancel: bool
    can_reschedule: bool
    items: List[Dict[str, Any]]

class RescheduleRequest(BaseModel):
    new_starts_at_utc: datetime.datetime
    new_staff_id: Optional[uuid.UUID] = None

class CancelRequest(BaseModel):
    reason: Optional[str] = "Клиент отменил запись"

# CRM Schemas
class CRMCreateBookingRequest(BaseModel):
    branch_id: uuid.UUID
    staff_id: uuid.UUID
    service_ids: List[uuid.UUID]
    starts_at_utc: datetime.datetime
    customer_name: str
    customer_phone: str
    customer_email: Optional[str] = None
    notes: Optional[str] = None

class StatusUpdateRequest(BaseModel):
    status: str  # confirmed, arrived, in_progress, completed, no_show, cancelled
    reason: Optional[str] = None

class CalendarBlockCreateRequest(BaseModel):
    branch_id: uuid.UUID
    staff_id: uuid.UUID
    starts_at_utc: datetime.datetime
    ends_at_utc: datetime.datetime
    block_reason: str = "Личное"

class CustomerCreateRequest(BaseModel):
    full_name: str
    phone_e164: str
    email: Optional[str] = None
    notes_private: Optional[str] = None

class CustomerNoteCreateRequest(BaseModel):
    note: Optional[str] = None
    note_text: Optional[str] = None

    @model_validator(mode="after")
    def validate_note(self):
        if not self.note and self.note_text:
            self.note = self.note_text
        if not self.note:
            raise ValueError("note is required")
        return self

class StaffCreateRequest(BaseModel):
    display_name: str
    role_title: str = "Барбер"
    color: str = "#3B82F6"
    online_bookable: bool = True
    branch_ids: List[uuid.UUID]

class StaffServiceOfferUpdateRequest(BaseModel):
    branch_id: uuid.UUID
    service_id: uuid.UUID
    price_override_minor: Optional[int] = None
    duration_override_minutes: Optional[int] = None
    active: bool = True
    online_visible: bool = True

class ServiceCreateRequest(BaseModel):
    category_id: Optional[uuid.UUID] = None
    name: str
    description: Optional[str] = None
    base_price_minor: int
    base_duration_minutes: int
    active: bool = True
    online_visible: bool = True

class ServiceCategoryCreateRequest(BaseModel):
    name: str
    sort_order: int = 0

class BookingPolicyUpdateRequest(BaseModel):
    book_ahead_days: Optional[int] = None
    min_advance_minutes: Optional[int] = None
    cancellation_cutoff_minutes: Optional[int] = None
    allow_self_reschedule: Optional[bool] = None
    slot_step_minutes: Optional[int] = None
    max_services_per_booking: Optional[int] = None
    allow_online_booking: Optional[bool] = None

class BookingBrandingUpdateRequest(BaseModel):
    primary_color: Optional[str] = None
    accent_color: Optional[str] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None

class InviteCreateRequest(BaseModel):
    email: EmailStr
    role: str = "admin"  # admin, master
    branch_scope: Optional[str] = None

# Platform Console Schemas
class PlatformTenantCreateRequest(BaseModel):
    slug: str
    display_name: str
    owner_email: EmailStr
    owner_name: str
    vertical: str = "barbershop"
    plan_code: str = "start"

class SuspendTenantRequest(BaseModel):
    reason: str

class ReactivateTenantRequest(BaseModel):
    reason: str

class IssueChargeRequest(BaseModel):
    amount_minor: int
    currency: str = "KZT"
    period_start: datetime.datetime
    period_end: datetime.datetime
    evidence_reference: Optional[str] = None

class RecordPaymentRequest(BaseModel):
    amount_minor: int
    evidence_reference: str
    payment_method: str = "bank_transfer"
    note: Optional[str] = None


class PlanVersionCreateRequest(BaseModel):
    price_minor: int
    currency: str = "KZT"
    max_branches: int = 1
    max_active_staff: int = 5
    online_booking: bool = True
    basic_reports: bool = True

class RenewSubscriptionRequest(BaseModel):
    extend_days: int = 30
    record_payment: bool = False
    amount_minor: Optional[int] = None
    evidence_reference: Optional[str] = None
    payment_method: str = "bank_transfer"

class ChangePlanRequest(BaseModel):
    new_plan_code: str
    reason: Optional[str] = None

class FeatureOverrideCreateRequest(BaseModel):
    feature_key: str
    override_value: Optional[int] = None
    expires_days: int = 30
    reason: str

class PlatformStaffCreateRequest(BaseModel):
    email: EmailStr
    display_name: str
    platform_role: str = "viewer"
    password: Optional[str] = None

class PlatformSettingUpdateRequest(BaseModel):
    value: Any
    description: Optional[str] = None

class FeatureOverrideRequest(BaseModel):
    feature_key: str
    override_value: Optional[int] = None
    reason: str
    expires_at: datetime.datetime

class SupportAccessRequestCreate(BaseModel):
    tenant_id: uuid.UUID
    reason: str
    requested_scope: str = "read_only_diagnostic"

class SupportTicketCreateRequest(BaseModel):
    tenant_id: uuid.UUID
    subject: str
    priority: str = "normal"
    initial_message: str

class SupportMessageCreateRequest(BaseModel):
    message: str
    is_internal: bool = False

# Full Business CRM Schemas
class CustomerUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    phone_e164: Optional[str] = None
    email: Optional[str] = None
    notes_private: Optional[str] = None

class StaffUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    role_title: Optional[str] = None
    color: Optional[str] = None
    online_bookable: Optional[bool] = None
    active: Optional[bool] = None
    branch_ids: Optional[List[uuid.UUID]] = None

class ShiftBreakDto(BaseModel):
    local_start: str
    local_end: str

class WeeklyShiftDto(BaseModel):
    weekday_iso: int
    local_start: str = "10:00"
    local_end: str = "20:00"
    is_working: bool = True
    breaks: List[ShiftBreakDto] = []

class StaffScheduleUpdateRequest(BaseModel):
    shifts: List[WeeklyShiftDto]

class ServiceUpdateRequest(BaseModel):
    category_id: Optional[uuid.UUID] = None
    name: Optional[str] = None
    description: Optional[str] = None
    base_price_minor: Optional[int] = None
    base_duration_minutes: Optional[int] = None
    active: Optional[bool] = None
    online_visible: Optional[bool] = None

class ServiceCategoryUpdateRequest(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None

class BranchUpdateRequest(BaseModel):
    name: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    timezone_iana: Optional[str] = None
    timezone: Optional[str] = None
    phone: Optional[str] = None
    phone_number: Optional[str] = None
