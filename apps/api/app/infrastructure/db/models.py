import uuid
from datetime import datetime, time
from typing import Optional, List, Any
from sqlalchemy import (
    String, Integer, Boolean, DateTime, Time, ForeignKey, Index, Text, JSON,
    UniqueConstraint, CheckConstraint, text
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, TSRANGE
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

# =========================================================================
# CONTROL PLANE MODELS (GLOBAL / NON-TENANT PII)
# =========================================================================

class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vertical: Mapped[str] = mapped_column(String(32), default="barbershop", nullable=False)
    lifecycle_status: Mapped[str] = mapped_column(String(32), default="active", nullable=False, index=True)
    timezone_default: Mapped[str] = mapped_column(String(64), default="Asia/Almaty", nullable=False)
    owner_membership_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    suspended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    suspension_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    domains: Mapped[List["TenantDomain"]] = relationship("TenantDomain", back_populates="tenant", cascade="all, delete-orphan")
    memberships: Mapped[List["TenantMembership"]] = relationship("TenantMembership", back_populates="tenant", cascade="all, delete-orphan")
    subscriptions: Mapped[List["Subscription"]] = relationship("Subscription", back_populates="tenant", cascade="all, delete-orphan")


class TenantDomain(Base):
    __tablename__ = "tenant_domains"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    hostname_normalized: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    domain_type: Mapped[str] = mapped_column(String(32), default="system_subdomain", nullable=False)  # system_subdomain, custom
    verification_status: Mapped[str] = mapped_column(String(32), default="verified", nullable=False)  # pending, verified, failed
    tls_status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)  # active, pending
    canonical: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="domains")


class IdentityUser(Base):
    __tablename__ = "identity_users"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    oidc_subject: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    email_normalized: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # dev/local fallback
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    memberships: Mapped[List["TenantMembership"]] = relationship("TenantMembership", back_populates="user", cascade="all, delete-orphan")
    platform_staff: Mapped[Optional["PlatformStaff"]] = relationship("PlatformStaff", back_populates="user", uselist=False)


class TenantMembership(Base):
    __tablename__ = "tenant_memberships"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("identity_users.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False)  # owner, admin, master
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)  # active, invited, revoked
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="memberships")
    user: Mapped["IdentityUser"] = relationship("IdentityUser", back_populates="memberships")
    branch_grants: Mapped[List["BranchRoleGrant"]] = relationship("BranchRoleGrant", back_populates="membership", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_tenant_user_membership"),
    )


class BranchRoleGrant(Base):
    __tablename__ = "branch_role_grants"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    membership_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenant_memberships.id", ondelete="CASCADE"), nullable=False, index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    role_override: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    membership: Mapped["TenantMembership"] = relationship("TenantMembership", back_populates="branch_grants")


class PlatformStaff(Base):
    __tablename__ = "platform_staff"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("identity_users.id", ondelete="CASCADE"), unique=True, nullable=False)
    platform_role: Mapped[str] = mapped_column(String(32), nullable=False)  # platform_owner, support, finance
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    mfa_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    user: Mapped["IdentityUser"] = relationship("IdentityUser", back_populates="platform_staff")


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    invite_type: Mapped[str] = mapped_column(String(32), nullable=False)  # owner_invite, staff_invite, platform_staff_invite
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    branch_scope: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)  # start, pro, business
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    versions: Mapped[List["PlanVersion"]] = relationship("PlanVersion", back_populates="plan", cascade="all, delete-orphan")


class PlanVersion(Base):
    __tablename__ = "plan_versions"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("plans.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    price_minor: Mapped[int] = mapped_column(Integer, default=900000, nullable=False)  # 9 000.00 KZT
    currency: Mapped[str] = mapped_column(String(3), default="KZT", nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    plan: Mapped["Plan"] = relationship("Plan", back_populates="versions")
    entitlements: Mapped[List["PlanEntitlement"]] = relationship("PlanEntitlement", back_populates="plan_version", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plan_id", "version", name="uq_plan_version"),
    )


class PlanEntitlement(Base):
    __tablename__ = "plan_entitlements"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_version_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("plan_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    feature_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    limit_value: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # NULL = unlimited
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    plan_version: Mapped["PlanVersion"] = relationship("PlanVersion", back_populates="entitlements")

    __table_args__ = (
        UniqueConstraint("plan_version_id", "feature_key", name="uq_plan_version_feature"),
    )


class FeatureCatalog(Base):
    __tablename__ = "feature_catalog"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    release_stage: Mapped[str] = mapped_column(String(32), default="available", nullable=False)  # planned, internal_test, beta, available, retired
    configurable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_version_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("plan_versions.id"), nullable=False)
    lifecycle_status: Mapped[str] = mapped_column(String(32), default="trial", nullable=False, index=True)  # trial, active, grace, expired_pending_action, suspended, canceled
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    trial_ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    grace_ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    suspended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    renewal_mode: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)
    next_plan_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("plan_versions.id"), nullable=True)
    next_effective_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="subscriptions")
    plan_version: Mapped["PlanVersion"] = relationship("PlanVersion", foreign_keys=[plan_version_id])
    charges: Mapped[List["SubscriptionCharge"]] = relationship("SubscriptionCharge", back_populates="subscription", cascade="all, delete-orphan")


class TenantEntitlementOverride(Base):
    __tablename__ = "tenant_entitlement_overrides"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    feature_key: Mapped[str] = mapped_column(String(64), nullable=False)
    override_value: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    authorized_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class SubscriptionCharge(Base):
    __tablename__ = "subscription_charges"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    subscription_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("subscriptions.id", ondelete="CASCADE"), nullable=False, index=True)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="KZT", nullable=False)
    discount_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    charge_status: Mapped[str] = mapped_column(String(32), default="issued", nullable=False)  # draft, issued, partially_paid, paid, void
    evidence_reference: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    subscription: Mapped["Subscription"] = relationship("Subscription", back_populates="charges")
    payments: Mapped[List["PaymentRecord"]] = relationship("PaymentRecord", back_populates="charge", cascade="all, delete-orphan")


class PaymentRecord(Base):
    __tablename__ = "payment_records"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    charge_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("subscription_charges.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="KZT", nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    recorded_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(32), default="bank_transfer", nullable=False)  # bank_transfer, cash, manual_adjustment
    evidence_reference: Mapped[str] = mapped_column(String(255), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(128), unique=True, nullable=True, index=True)

    charge: Mapped["SubscriptionCharge"] = relationship("SubscriptionCharge", back_populates="payments")


class SubscriptionDecision(Base):
    __tablename__ = "subscription_decisions"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    decision_type: Mapped[str] = mapped_column(String(64), nullable=False)  # plan_change, renewal, suspend, reactivate
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    old_state: Mapped[str] = mapped_column(String(64), nullable=False)
    new_state: Mapped[str] = mapped_column(String(64), nullable=False)


class PlatformSupportTicket(Base):
    __tablename__ = "platform_support_tickets"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    creator_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="open", nullable=False, index=True)  # open, in_progress, waiting_client, resolved, closed
    priority: Mapped[str] = mapped_column(String(32), default="normal", nullable=False)  # low, normal, urgent
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    messages: Mapped[List["SupportMessage"]] = relationship("SupportMessage", back_populates="ticket", cascade="all, delete-orphan")


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("platform_support_tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    sender_role: Mapped[str] = mapped_column(String(32), nullable=False)  # platform_support, tenant_user
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    ticket: Mapped["PlatformSupportTicket"] = relationship("PlatformSupportTicket", back_populates="messages")


class SupportAccessRequest(Base):
    __tablename__ = "support_access_requests"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    requester_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    requested_scope: Mapped[str] = mapped_column(String(64), default="read_only_diagnostic", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)  # pending, approved, denied, expired
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    sessions: Mapped[List["SupportAccessSession"]] = relationship("SupportAccessSession", back_populates="request", cascade="all, delete-orphan")


class SupportAccessSession(Base):
    __tablename__ = "support_access_sessions"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("support_access_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    approved_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)  # active, expired, revoked

    request: Mapped["SupportAccessRequest"] = relationship("SupportAccessRequest", back_populates="sessions")


class PlatformAuditEvent(Base):
    __tablename__ = "platform_audit_events"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    actor_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    object_type: Mapped[str] = mapped_column(String(64), nullable=False)
    object_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    before_sanitized: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    after_sanitized: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True)


class PlatformAlert(Base):
    __tablename__ = "platform_alerts"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    alert_type: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(32), default="warning", nullable=False)  # info, warning, error, critical
    message: Mapped[str] = mapped_column(Text, nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    aggregate_id: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_sanitized: Mapped[Any] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scope: Mapped[str] = mapped_column(String(64), nullable=False)  # public_booking, crm_booking, payment
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    actor_or_context_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    response_body_redacted: Mapped[str] = mapped_column(Text, nullable=False)
    response_code: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("scope", "idempotency_key", name="uq_scope_idempotency_key"),
    )


# =========================================================================
# DATA PLANE MODELS (PROTECTED BY tenant_id NOT NULL AND RLS)
# =========================================================================

class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    city: Mapped[str] = mapped_column(String(128), nullable=False)
    address: Mapped[str] = mapped_column(String(255), nullable=False)
    timezone_iana: Mapped[str] = mapped_column(String(64), default="Asia/Almaty", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    weekly_hours: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_branch_tenant_id"),
    )


class TenantSettings(Base):
    __tablename__ = "tenant_settings"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), unique=True, nullable=False, index=True)
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    locale: Mapped[str] = mapped_column(String(10), default="ru", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="KZT", nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class BookingPolicy(Base):
    __tablename__ = "booking_policies"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    branch_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    book_ahead_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    min_advance_minutes: Mapped[int] = mapped_column(Integer, default=120, nullable=False)
    cancellation_cutoff_minutes: Mapped[int] = mapped_column(Integer, default=180, nullable=False)
    allow_self_reschedule: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    slot_step_minutes: Mapped[int] = mapped_column(Integer, default=15, nullable=False)
    max_services_per_booking: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    allow_online_booking: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    price_change_requires_acceptance: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_policy_tenant_id"),
    )


class ServiceCategory(Base):
    __tablename__ = "service_categories"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    services: Mapped[List["Service"]] = relationship("Service", back_populates="category", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_cat_tenant_id"),
    )


class Service(Base):
    __tablename__ = "services"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    category_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("service_categories.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    base_price_minor: Mapped[int] = mapped_column(Integer, nullable=False)  # in minor units (tiyn / cents)
    currency: Mapped[str] = mapped_column(String(3), default="KZT", nullable=False)
    base_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    online_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    category: Mapped[Optional["ServiceCategory"]] = relationship("ServiceCategory", back_populates="services")

    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_service_tenant_id"),
    )


class StaffProfile(Base):
    __tablename__ = "staff_profiles"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)  # if linked to login user
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role_title: Mapped[str] = mapped_column(String(128), default="Барбер", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    online_bookable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    color: Mapped[str] = mapped_column(String(16), default="#3B82F6", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    offers: Mapped[List["StaffServiceOffer"]] = relationship("StaffServiceOffer", back_populates="staff", cascade="all, delete-orphan")
    shifts: Mapped[List["WeeklyShift"]] = relationship("WeeklyShift", back_populates="staff", cascade="all, delete-orphan")
    time_off: Mapped[List["StaffTimeOff"]] = relationship("StaffTimeOff", back_populates="staff", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_staff_tenant_id"),
    )


class StaffBranch(Base):
    __tablename__ = "staff_branches"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("staff_profiles.id", ondelete="CASCADE"), nullable=False)
    branch_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    valid_to: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "staff_id", "branch_id", name="uq_staff_branch_pair"),
    )


class StaffServiceOffer(Base):
    __tablename__ = "staff_service_offers"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("staff_profiles.id", ondelete="CASCADE"), nullable=False)
    branch_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    service_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), nullable=False)
    price_override_minor: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    duration_override_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    online_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    staff: Mapped["StaffProfile"] = relationship("StaffProfile", back_populates="offers")

    __table_args__ = (
        UniqueConstraint("tenant_id", "staff_id", "branch_id", "service_id", name="uq_staff_branch_service_offer"),
    )


class WeeklyShift(Base):
    __tablename__ = "weekly_shifts"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("staff_profiles.id", ondelete="CASCADE"), nullable=False)
    branch_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    weekday_iso: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 = Monday .. 7 = Sunday
    local_start: Mapped[time] = mapped_column(Time, nullable=False)
    local_end: Mapped[time] = mapped_column(Time, nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    effective_to: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    staff: Mapped["StaffProfile"] = relationship("StaffProfile", back_populates="shifts")
    breaks: Mapped[List["ShiftBreak"]] = relationship("ShiftBreak", back_populates="shift", cascade="all, delete-orphan")


class ShiftBreak(Base):
    __tablename__ = "shift_breaks"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    shift_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("weekly_shifts.id", ondelete="CASCADE"), nullable=False)
    local_start: Mapped[time] = mapped_column(Time, nullable=False)
    local_end: Mapped[time] = mapped_column(Time, nullable=False)

    shift: Mapped["WeeklyShift"] = relationship("WeeklyShift", back_populates="breaks")


class StaffTimeOff(Base):
    __tablename__ = "staff_time_off"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("staff_profiles.id", ondelete="CASCADE"), nullable=False)
    from_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    to_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    staff: Mapped["StaffProfile"] = relationship("StaffProfile", back_populates="time_off")


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_e164: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    phone_digits_index: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notes_private: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    marketing_consent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    data_source: Mapped[str] = mapped_column(String(32), default="public_booking", nullable=False)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    notes: Mapped[List["CustomerNote"]] = relationship("CustomerNote", back_populates="customer", cascade="all, delete-orphan")
    bookings: Mapped[List["Booking"]] = relationship("Booking", back_populates="customer")

    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_customer_tenant_id"),
        Index("ix_cust_tenant_phone", "tenant_id", "phone_e164"),
    )


class CustomerNote(Base):
    __tablename__ = "customer_notes"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    customer: Mapped["Customer"] = relationship("Customer", back_populates="notes")


class Booking(Base):
    __tablename__ = "bookings"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False, index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("staff_profiles.id"), nullable=False, index=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(32), default="public", nullable=False)  # public, crm_manual
    status: Mapped[str] = mapped_column(String(32), default="confirmed", nullable=False, index=True)  # confirmed, arrived, in_progress, completed, no_show, cancelled
    starts_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    service_ends_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    busy_ends_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    timezone_snapshot: Mapped[str] = mapped_column(String(64), default="Asia/Almaty", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="KZT", nullable=False)
    amount_minor_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)
    public_ref: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    customer: Mapped["Customer"] = relationship("Customer", back_populates="bookings")
    items: Mapped[List["BookingItem"]] = relationship("BookingItem", back_populates="booking", cascade="all, delete-orphan")
    events: Mapped[List["BookingEvent"]] = relationship("BookingEvent", back_populates="booking", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_booking_tenant_id"),
        Index("ix_bookings_tenant_branch_start", "tenant_id", "branch_id", "starts_at_utc"),
        Index("ix_bookings_tenant_staff_start", "tenant_id", "staff_id", "starts_at_utc"),
    )


class BookingItem(Base):
    __tablename__ = "booking_items"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    booking_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    service_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("services.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    service_name_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    duration_minutes_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)
    price_minor_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)
    currency_snapshot: Mapped[str] = mapped_column(String(3), default="KZT", nullable=False)

    booking: Mapped["Booking"] = relationship("Booking", back_populates="items")

    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_bitem_tenant_id"),
    )


class StaffOccupancy(Base):
    __tablename__ = "staff_occupancies"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("staff_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    booking_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE"), nullable=True, index=True)
    block_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    starts_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ends_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    released_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    occupancy_type: Mapped[str] = mapped_column(String(32), default="booking", nullable=False)  # booking, block

    __table_args__ = (
        CheckConstraint("starts_at_utc < ends_at_utc", name="staff_occupancy_valid_range"),
        Index("ix_occupancies_tenant_staff_dates", "tenant_id", "staff_id", "starts_at_utc", "ends_at_utc"),
    )


class CalendarBlock(Base):
    __tablename__ = "calendar_blocks"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("staff_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    starts_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    block_reason: Mapped[str] = mapped_column(String(255), default="Личное", nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint("starts_at_utc < ends_at_utc", name="calendar_block_valid_range"),
    )


class BookingEvent(Base):
    __tablename__ = "booking_events"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    booking_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)  # created, status_changed, rescheduled, cancelled
    old_json_sanitized: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    new_json_sanitized: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    actor_type: Mapped[str] = mapped_column(String(32), default="customer", nullable=False)  # customer, staff, system
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    booking: Mapped["Booking"] = relationship("Booking", back_populates="events")


class BookingQuote(Base):
    __tablename__ = "booking_quotes"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    staff_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    selected_service_ids_ordered: Mapped[Any] = mapped_column(JSON, nullable=False)
    starts_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    pricing_version_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class PublicManagementToken(Base):
    __tablename__ = "public_management_tokens"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    booking_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(32), default="manage_booking", nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class BookingTheme(Base):
    __tablename__ = "booking_themes"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), unique=True, nullable=False, index=True)
    primary_color: Mapped[str] = mapped_column(String(16), default="#1E293B", nullable=False)
    accent_color: Mapped[str] = mapped_column(String(16), default="#D97706", nullable=False)
    logo_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    banner_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    custom_css: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class BookingPublication(Base):
    __tablename__ = "booking_publications"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    branch_id: Mapped[Optional[uuid.UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=True)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_tenant_pub_slug"),
    )
