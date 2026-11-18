"""initial_schema_and_rls

Revision ID: 001_initial
Revises:
Create Date: 2026-11-08 15:00:00.000000

Схема зафиксирована явным DDL (M01-D2-01). Миграция больше не вызывает
Base.metadata.create_all и не импортирует модели приложения: изменения моделей
должны приходить новыми ревизиями, а эта ревизия даёт одинаковую схему
на любой чистой PostgreSQL. Результат совпадает с прежней версией 001,
поэтому базы, уже стоящие на 001_initial, перемигрировать не нужно.
"""
import os
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Список таблиц с tenant_id на момент этой ревизии. Новые tenant-таблицы
# включают RLS в своих ревизиях, этот список не меняется.
TENANT_TABLES = [
    "branches",
    "tenant_settings",
    "booking_policies",
    "service_categories",
    "services",
    "staff_profiles",
    "staff_branches",
    "staff_service_offers",
    "weekly_shifts",
    "shift_breaks",
    "staff_time_off",
    "customers",
    "customer_notes",
    "bookings",
    "booking_items",
    "staff_occupancies",
    "calendar_blocks",
    "booking_events",
    "booking_quotes",
    "public_management_tokens",
    "booking_themes",
    "booking_publications",
]


def _runtime_role() -> str:
    return os.getenv("DB_USER", "crm_app_user")


def upgrade() -> None:
    # 1. btree_gist нужен для exclusion constraint по занятости мастера
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist;")

    # 2. Runtime-роль приложения: без superuser и без обхода RLS
    db_user = _runtime_role()
    db_pwd = os.getenv("DB_PASSWORD", "crm_app_secret")
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{db_user}') THEN
                EXECUTE format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', '{db_user}', '{db_pwd}');
            END IF;
        END $$;
    """)

    # 3. Таблицы, индексы, ключи
    op.create_table('booking_policies',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('branch_id', sa.UUID(), nullable=True),
    sa.Column('book_ahead_days', sa.Integer(), nullable=False),
    sa.Column('min_advance_minutes', sa.Integer(), nullable=False),
    sa.Column('cancellation_cutoff_minutes', sa.Integer(), nullable=False),
    sa.Column('allow_self_reschedule', sa.Boolean(), nullable=False),
    sa.Column('slot_step_minutes', sa.Integer(), nullable=False),
    sa.Column('max_services_per_booking', sa.Integer(), nullable=False),
    sa.Column('allow_online_booking', sa.Boolean(), nullable=False),
    sa.Column('price_change_requires_acceptance', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'id', name='uq_policy_tenant_id')
    )
    op.create_index(op.f('ix_booking_policies_tenant_id'), 'booking_policies', ['tenant_id'], unique=False)
    op.create_table('booking_publications',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('branch_id', sa.UUID(), nullable=True),
    sa.Column('is_published', sa.Boolean(), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('slug', sa.String(length=64), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'slug', name='uq_tenant_pub_slug')
    )
    op.create_index(op.f('ix_booking_publications_tenant_id'), 'booking_publications', ['tenant_id'], unique=False)
    op.create_table('booking_quotes',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('branch_id', sa.UUID(), nullable=False),
    sa.Column('staff_id', sa.UUID(), nullable=False),
    sa.Column('selected_service_ids_ordered', sa.JSON(), nullable=False),
    sa.Column('starts_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('amount_minor', sa.Integer(), nullable=False),
    sa.Column('duration_minutes', sa.Integer(), nullable=False),
    sa.Column('pricing_version_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_booking_quotes_expires_at'), 'booking_quotes', ['expires_at'], unique=False)
    op.create_index(op.f('ix_booking_quotes_tenant_id'), 'booking_quotes', ['tenant_id'], unique=False)
    op.create_table('booking_themes',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('primary_color', sa.String(length=16), nullable=False),
    sa.Column('accent_color', sa.String(length=16), nullable=False),
    sa.Column('logo_url', sa.String(length=512), nullable=True),
    sa.Column('banner_url', sa.String(length=512), nullable=True),
    sa.Column('custom_css', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_booking_themes_tenant_id'), 'booking_themes', ['tenant_id'], unique=True)
    op.create_table('branches',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('city', sa.String(length=128), nullable=False),
    sa.Column('address', sa.String(length=255), nullable=False),
    sa.Column('timezone_iana', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('phone', sa.String(length=32), nullable=True),
    sa.Column('weekly_hours', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'id', name='uq_branch_tenant_id')
    )
    op.create_index(op.f('ix_branches_tenant_id'), 'branches', ['tenant_id'], unique=False)
    op.create_table('customers',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('full_name', sa.String(length=255), nullable=False),
    sa.Column('phone_e164', sa.String(length=32), nullable=False),
    sa.Column('phone_digits_index', sa.String(length=32), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('notes_private', sa.Text(), nullable=True),
    sa.Column('marketing_consent', sa.Boolean(), nullable=False),
    sa.Column('data_source', sa.String(length=32), nullable=False),
    sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'id', name='uq_customer_tenant_id')
    )
    op.create_index('ix_cust_tenant_phone', 'customers', ['tenant_id', 'phone_e164'], unique=False)
    op.create_index(op.f('ix_customers_phone_digits_index'), 'customers', ['phone_digits_index'], unique=False)
    op.create_index(op.f('ix_customers_phone_e164'), 'customers', ['phone_e164'], unique=False)
    op.create_index(op.f('ix_customers_tenant_id'), 'customers', ['tenant_id'], unique=False)
    op.create_table('feature_catalog',
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('release_stage', sa.String(length=32), nullable=False),
    sa.Column('configurable', sa.Boolean(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('idempotency_records',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('scope', sa.String(length=64), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=True),
    sa.Column('actor_or_context_hash', sa.String(length=128), nullable=False),
    sa.Column('idempotency_key', sa.String(length=128), nullable=False),
    sa.Column('request_hash', sa.String(length=128), nullable=False),
    sa.Column('response_body_redacted', sa.Text(), nullable=False),
    sa.Column('response_code', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('scope', 'idempotency_key', name='uq_scope_idempotency_key')
    )
    op.create_table('identity_users',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('oidc_subject', sa.String(length=255), nullable=False),
    sa.Column('email_normalized', sa.String(length=255), nullable=False),
    sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('display_name', sa.String(length=255), nullable=False),
    sa.Column('account_status', sa.String(length=32), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_identity_users_email_normalized'), 'identity_users', ['email_normalized'], unique=True)
    op.create_index(op.f('ix_identity_users_oidc_subject'), 'identity_users', ['oidc_subject'], unique=True)
    op.create_table('outbox_events',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=True),
    sa.Column('event_type', sa.String(length=128), nullable=False),
    sa.Column('aggregate_id', sa.String(length=128), nullable=False),
    sa.Column('payload_sanitized', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('retry_count', sa.Integer(), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_outbox_events_created_at'), 'outbox_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_outbox_events_event_type'), 'outbox_events', ['event_type'], unique=False)
    op.create_index(op.f('ix_outbox_events_tenant_id'), 'outbox_events', ['tenant_id'], unique=False)
    op.create_table('plans',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('code', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_plans_code'), 'plans', ['code'], unique=True)
    op.create_table('platform_alerts',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=True),
    sa.Column('alert_type', sa.String(length=64), nullable=False),
    sa.Column('severity', sa.String(length=32), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('resolved', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_platform_alerts_tenant_id'), 'platform_alerts', ['tenant_id'], unique=False)
    op.create_table('platform_audit_events',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('actor_id', sa.UUID(), nullable=True),
    sa.Column('actor_email', sa.String(length=255), nullable=True),
    sa.Column('action', sa.String(length=128), nullable=False),
    sa.Column('target_tenant_id', sa.UUID(), nullable=True),
    sa.Column('object_type', sa.String(length=64), nullable=False),
    sa.Column('object_id', sa.String(length=128), nullable=True),
    sa.Column('before_sanitized', sa.JSON(), nullable=True),
    sa.Column('after_sanitized', sa.JSON(), nullable=True),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('ip', sa.String(length=64), nullable=True),
    sa.Column('request_id', sa.String(length=64), nullable=True),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_platform_audit_events_action'), 'platform_audit_events', ['action'], unique=False)
    op.create_index(op.f('ix_platform_audit_events_actor_id'), 'platform_audit_events', ['actor_id'], unique=False)
    op.create_index(op.f('ix_platform_audit_events_occurred_at'), 'platform_audit_events', ['occurred_at'], unique=False)
    op.create_index(op.f('ix_platform_audit_events_target_tenant_id'), 'platform_audit_events', ['target_tenant_id'], unique=False)
    op.create_table('platform_settings',
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('value_json', sa.JSON(), nullable=False),
    sa.Column('description', sa.String(length=255), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('service_categories',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'id', name='uq_cat_tenant_id')
    )
    op.create_index(op.f('ix_service_categories_tenant_id'), 'service_categories', ['tenant_id'], unique=False)
    op.create_table('staff_profiles',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('display_name', sa.String(length=255), nullable=False),
    sa.Column('role_title', sa.String(length=128), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('online_bookable', sa.Boolean(), nullable=False),
    sa.Column('color', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'id', name='uq_staff_tenant_id')
    )
    op.create_index(op.f('ix_staff_profiles_tenant_id'), 'staff_profiles', ['tenant_id'], unique=False)
    op.create_table('tenant_settings',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('business_name', sa.String(length=255), nullable=False),
    sa.Column('locale', sa.String(length=10), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('phone', sa.String(length=32), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tenant_settings_tenant_id'), 'tenant_settings', ['tenant_id'], unique=True)
    op.create_table('tenants',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('slug', sa.String(length=64), nullable=False),
    sa.Column('display_name', sa.String(length=255), nullable=False),
    sa.Column('vertical', sa.String(length=32), nullable=False),
    sa.Column('lifecycle_status', sa.String(length=32), nullable=False),
    sa.Column('timezone_default', sa.String(length=64), nullable=False),
    sa.Column('owner_membership_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('suspended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('suspension_reason', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tenants_lifecycle_status'), 'tenants', ['lifecycle_status'], unique=False)
    op.create_index(op.f('ix_tenants_slug'), 'tenants', ['slug'], unique=True)
    op.create_table('bookings',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('branch_id', sa.UUID(), nullable=False),
    sa.Column('staff_id', sa.UUID(), nullable=False),
    sa.Column('customer_id', sa.UUID(), nullable=False),
    sa.Column('source', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('starts_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('service_ends_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('busy_ends_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('timezone_snapshot', sa.String(length=64), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('amount_minor_snapshot', sa.Integer(), nullable=False),
    sa.Column('public_ref', sa.String(length=32), nullable=False),
    sa.Column('idempotency_key', sa.String(length=128), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_by_user_id', sa.UUID(), nullable=True),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancellation_reason', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], ),
    sa.ForeignKeyConstraint(['staff_id'], ['staff_profiles.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'id', name='uq_booking_tenant_id')
    )
    op.create_index(op.f('ix_bookings_branch_id'), 'bookings', ['branch_id'], unique=False)
    op.create_index(op.f('ix_bookings_customer_id'), 'bookings', ['customer_id'], unique=False)
    op.create_index(op.f('ix_bookings_idempotency_key'), 'bookings', ['idempotency_key'], unique=False)
    op.create_index(op.f('ix_bookings_public_ref'), 'bookings', ['public_ref'], unique=False)
    op.create_index(op.f('ix_bookings_staff_id'), 'bookings', ['staff_id'], unique=False)
    op.create_index(op.f('ix_bookings_starts_at_utc'), 'bookings', ['starts_at_utc'], unique=False)
    op.create_index(op.f('ix_bookings_status'), 'bookings', ['status'], unique=False)
    op.create_index('ix_bookings_tenant_branch_start', 'bookings', ['tenant_id', 'branch_id', 'starts_at_utc'], unique=False)
    op.create_index(op.f('ix_bookings_tenant_id'), 'bookings', ['tenant_id'], unique=False)
    op.create_index('ix_bookings_tenant_staff_start', 'bookings', ['tenant_id', 'staff_id', 'starts_at_utc'], unique=False)
    op.create_table('calendar_blocks',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('staff_id', sa.UUID(), nullable=False),
    sa.Column('branch_id', sa.UUID(), nullable=False),
    sa.Column('starts_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('block_reason', sa.String(length=255), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('starts_at_utc < ends_at_utc', name='calendar_block_valid_range'),
    sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['staff_id'], ['staff_profiles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_calendar_blocks_staff_id'), 'calendar_blocks', ['staff_id'], unique=False)
    op.create_index(op.f('ix_calendar_blocks_tenant_id'), 'calendar_blocks', ['tenant_id'], unique=False)
    op.create_table('customer_notes',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('customer_id', sa.UUID(), nullable=False),
    sa.Column('author_id', sa.UUID(), nullable=False),
    sa.Column('note', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_customer_notes_tenant_id'), 'customer_notes', ['tenant_id'], unique=False)
    op.create_table('invites',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=True),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('invite_type', sa.String(length=32), nullable=False),
    sa.Column('role', sa.String(length=32), nullable=False),
    sa.Column('branch_scope', sa.String(length=255), nullable=True),
    sa.Column('token_hash', sa.String(length=128), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_invites_email'), 'invites', ['email'], unique=False)
    op.create_index(op.f('ix_invites_tenant_id'), 'invites', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_invites_token_hash'), 'invites', ['token_hash'], unique=True)
    op.create_table('plan_versions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('plan_id', sa.UUID(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('price_minor', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('effective_from', sa.DateTime(timezone=True), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('plan_id', 'version', name='uq_plan_version')
    )
    op.create_index(op.f('ix_plan_versions_plan_id'), 'plan_versions', ['plan_id'], unique=False)
    op.create_table('platform_staff',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('platform_role', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('mfa_required', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['identity_users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id')
    )
    op.create_table('platform_support_tickets',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('creator_id', sa.UUID(), nullable=False),
    sa.Column('subject', sa.String(length=255), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('priority', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_platform_support_tickets_status'), 'platform_support_tickets', ['status'], unique=False)
    op.create_index(op.f('ix_platform_support_tickets_tenant_id'), 'platform_support_tickets', ['tenant_id'], unique=False)
    op.create_table('services',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('category_id', sa.UUID(), nullable=True),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('base_price_minor', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('base_duration_minutes', sa.Integer(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('online_visible', sa.Boolean(), nullable=False),
    sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['service_categories.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'id', name='uq_service_tenant_id')
    )
    op.create_index(op.f('ix_services_tenant_id'), 'services', ['tenant_id'], unique=False)
    op.create_table('staff_branches',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('staff_id', sa.UUID(), nullable=False),
    sa.Column('branch_id', sa.UUID(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('valid_from', sa.DateTime(timezone=True), nullable=False),
    sa.Column('valid_to', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['staff_id'], ['staff_profiles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'staff_id', 'branch_id', name='uq_staff_branch_pair')
    )
    op.create_index(op.f('ix_staff_branches_tenant_id'), 'staff_branches', ['tenant_id'], unique=False)
    op.create_table('staff_time_off',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('staff_id', sa.UUID(), nullable=False),
    sa.Column('from_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('to_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('reason', sa.String(length=255), nullable=True),
    sa.ForeignKeyConstraint(['staff_id'], ['staff_profiles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_staff_time_off_tenant_id'), 'staff_time_off', ['tenant_id'], unique=False)
    op.create_table('subscription_decisions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('decision_type', sa.String(length=64), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('actor_id', sa.UUID(), nullable=False),
    sa.Column('effective_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('old_state', sa.String(length=64), nullable=False),
    sa.Column('new_state', sa.String(length=64), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_subscription_decisions_tenant_id'), 'subscription_decisions', ['tenant_id'], unique=False)
    op.create_table('support_access_requests',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('requester_id', sa.UUID(), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('requested_scope', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_support_access_requests_tenant_id'), 'support_access_requests', ['tenant_id'], unique=False)
    op.create_table('tenant_domains',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('hostname_normalized', sa.String(length=255), nullable=False),
    sa.Column('domain_type', sa.String(length=32), nullable=False),
    sa.Column('verification_status', sa.String(length=32), nullable=False),
    sa.Column('tls_status', sa.String(length=32), nullable=False),
    sa.Column('canonical', sa.Boolean(), nullable=False),
    sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tenant_domains_hostname_normalized'), 'tenant_domains', ['hostname_normalized'], unique=True)
    op.create_index(op.f('ix_tenant_domains_tenant_id'), 'tenant_domains', ['tenant_id'], unique=False)
    op.create_table('tenant_entitlement_overrides',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('feature_key', sa.String(length=64), nullable=False),
    sa.Column('override_value', sa.Integer(), nullable=True),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('valid_from', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('authorized_by', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tenant_entitlement_overrides_tenant_id'), 'tenant_entitlement_overrides', ['tenant_id'], unique=False)
    op.create_table('tenant_memberships',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('role', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('joined_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['identity_users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'user_id', name='uq_tenant_user_membership')
    )
    op.create_index(op.f('ix_tenant_memberships_tenant_id'), 'tenant_memberships', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_tenant_memberships_user_id'), 'tenant_memberships', ['user_id'], unique=False)
    op.create_table('weekly_shifts',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('staff_id', sa.UUID(), nullable=False),
    sa.Column('branch_id', sa.UUID(), nullable=False),
    sa.Column('weekday_iso', sa.Integer(), nullable=False),
    sa.Column('local_start', sa.Time(), nullable=False),
    sa.Column('local_end', sa.Time(), nullable=False),
    sa.Column('effective_from', sa.DateTime(timezone=True), nullable=False),
    sa.Column('effective_to', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['staff_id'], ['staff_profiles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_weekly_shifts_tenant_id'), 'weekly_shifts', ['tenant_id'], unique=False)
    op.create_table('booking_events',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('booking_id', sa.UUID(), nullable=False),
    sa.Column('event_type', sa.String(length=64), nullable=False),
    sa.Column('old_json_sanitized', sa.JSON(), nullable=True),
    sa.Column('new_json_sanitized', sa.JSON(), nullable=True),
    sa.Column('actor_type', sa.String(length=32), nullable=False),
    sa.Column('actor_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_booking_events_booking_id'), 'booking_events', ['booking_id'], unique=False)
    op.create_index(op.f('ix_booking_events_tenant_id'), 'booking_events', ['tenant_id'], unique=False)
    op.create_table('booking_items',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('booking_id', sa.UUID(), nullable=False),
    sa.Column('service_id', sa.UUID(), nullable=False),
    sa.Column('sequence', sa.Integer(), nullable=False),
    sa.Column('service_name_snapshot', sa.String(length=255), nullable=False),
    sa.Column('duration_minutes_snapshot', sa.Integer(), nullable=False),
    sa.Column('price_minor_snapshot', sa.Integer(), nullable=False),
    sa.Column('currency_snapshot', sa.String(length=3), nullable=False),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['service_id'], ['services.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'id', name='uq_bitem_tenant_id')
    )
    op.create_index(op.f('ix_booking_items_booking_id'), 'booking_items', ['booking_id'], unique=False)
    op.create_index(op.f('ix_booking_items_tenant_id'), 'booking_items', ['tenant_id'], unique=False)
    op.create_table('branch_role_grants',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('membership_id', sa.UUID(), nullable=False),
    sa.Column('branch_id', sa.UUID(), nullable=False),
    sa.Column('role_override', sa.String(length=32), nullable=True),
    sa.ForeignKeyConstraint(['membership_id'], ['tenant_memberships.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_branch_role_grants_branch_id'), 'branch_role_grants', ['branch_id'], unique=False)
    op.create_index(op.f('ix_branch_role_grants_membership_id'), 'branch_role_grants', ['membership_id'], unique=False)
    op.create_table('plan_entitlements',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('plan_version_id', sa.UUID(), nullable=False),
    sa.Column('feature_key', sa.String(length=64), nullable=False),
    sa.Column('limit_value', sa.Integer(), nullable=True),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['plan_version_id'], ['plan_versions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('plan_version_id', 'feature_key', name='uq_plan_version_feature')
    )
    op.create_index(op.f('ix_plan_entitlements_feature_key'), 'plan_entitlements', ['feature_key'], unique=False)
    op.create_index(op.f('ix_plan_entitlements_plan_version_id'), 'plan_entitlements', ['plan_version_id'], unique=False)
    op.create_table('public_management_tokens',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('booking_id', sa.UUID(), nullable=False),
    sa.Column('token_hash', sa.String(length=128), nullable=False),
    sa.Column('scope', sa.String(length=32), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_public_management_tokens_booking_id'), 'public_management_tokens', ['booking_id'], unique=False)
    op.create_index(op.f('ix_public_management_tokens_tenant_id'), 'public_management_tokens', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_public_management_tokens_token_hash'), 'public_management_tokens', ['token_hash'], unique=True)
    op.create_table('shift_breaks',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('shift_id', sa.UUID(), nullable=False),
    sa.Column('local_start', sa.Time(), nullable=False),
    sa.Column('local_end', sa.Time(), nullable=False),
    sa.ForeignKeyConstraint(['shift_id'], ['weekly_shifts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_shift_breaks_tenant_id'), 'shift_breaks', ['tenant_id'], unique=False)
    op.create_table('staff_occupancies',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('staff_id', sa.UUID(), nullable=False),
    sa.Column('branch_id', sa.UUID(), nullable=False),
    sa.Column('booking_id', sa.UUID(), nullable=True),
    sa.Column('block_id', sa.UUID(), nullable=True),
    sa.Column('starts_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at_utc', sa.DateTime(timezone=True), nullable=False),
    sa.Column('released_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('occupancy_type', sa.String(length=32), nullable=False),
    sa.CheckConstraint('starts_at_utc < ends_at_utc', name='staff_occupancy_valid_range'),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['staff_id'], ['staff_profiles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_occupancies_tenant_staff_dates', 'staff_occupancies', ['tenant_id', 'staff_id', 'starts_at_utc', 'ends_at_utc'], unique=False)
    op.create_index(op.f('ix_staff_occupancies_block_id'), 'staff_occupancies', ['block_id'], unique=False)
    op.create_index(op.f('ix_staff_occupancies_booking_id'), 'staff_occupancies', ['booking_id'], unique=False)
    op.create_index(op.f('ix_staff_occupancies_ends_at_utc'), 'staff_occupancies', ['ends_at_utc'], unique=False)
    op.create_index(op.f('ix_staff_occupancies_released_at'), 'staff_occupancies', ['released_at'], unique=False)
    op.create_index(op.f('ix_staff_occupancies_staff_id'), 'staff_occupancies', ['staff_id'], unique=False)
    op.create_index(op.f('ix_staff_occupancies_starts_at_utc'), 'staff_occupancies', ['starts_at_utc'], unique=False)
    op.create_index(op.f('ix_staff_occupancies_tenant_id'), 'staff_occupancies', ['tenant_id'], unique=False)
    op.create_table('staff_service_offers',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('staff_id', sa.UUID(), nullable=False),
    sa.Column('branch_id', sa.UUID(), nullable=False),
    sa.Column('service_id', sa.UUID(), nullable=False),
    sa.Column('price_override_minor', sa.Integer(), nullable=True),
    sa.Column('duration_override_minutes', sa.Integer(), nullable=True),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('online_visible', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['service_id'], ['services.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['staff_id'], ['staff_profiles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'staff_id', 'branch_id', 'service_id', name='uq_staff_branch_service_offer')
    )
    op.create_index(op.f('ix_staff_service_offers_tenant_id'), 'staff_service_offers', ['tenant_id'], unique=False)
    op.create_table('subscriptions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('plan_version_id', sa.UUID(), nullable=False),
    sa.Column('lifecycle_status', sa.String(length=32), nullable=False),
    sa.Column('period_start', sa.DateTime(timezone=True), nullable=False),
    sa.Column('period_end', sa.DateTime(timezone=True), nullable=False),
    sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('grace_ends_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('suspended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('renewal_mode', sa.String(length=32), nullable=False),
    sa.Column('next_plan_version_id', sa.UUID(), nullable=True),
    sa.Column('next_effective_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['next_plan_version_id'], ['plan_versions.id'], ),
    sa.ForeignKeyConstraint(['plan_version_id'], ['plan_versions.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_subscriptions_lifecycle_status'), 'subscriptions', ['lifecycle_status'], unique=False)
    op.create_index(op.f('ix_subscriptions_tenant_id'), 'subscriptions', ['tenant_id'], unique=False)
    op.create_table('support_access_sessions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('request_id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('staff_id', sa.UUID(), nullable=False),
    sa.Column('approved_by', sa.UUID(), nullable=False),
    sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.ForeignKeyConstraint(['request_id'], ['support_access_requests.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_support_access_sessions_request_id'), 'support_access_sessions', ['request_id'], unique=False)
    op.create_index(op.f('ix_support_access_sessions_tenant_id'), 'support_access_sessions', ['tenant_id'], unique=False)
    op.create_table('support_messages',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('ticket_id', sa.UUID(), nullable=False),
    sa.Column('sender_id', sa.UUID(), nullable=False),
    sa.Column('sender_role', sa.String(length=32), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('is_internal', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['ticket_id'], ['platform_support_tickets.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_support_messages_ticket_id'), 'support_messages', ['ticket_id'], unique=False)
    op.create_table('subscription_charges',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('subscription_id', sa.UUID(), nullable=False),
    sa.Column('period_start', sa.DateTime(timezone=True), nullable=False),
    sa.Column('period_end', sa.DateTime(timezone=True), nullable=False),
    sa.Column('amount_minor', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('discount_minor', sa.Integer(), nullable=False),
    sa.Column('charge_status', sa.String(length=32), nullable=False),
    sa.Column('evidence_reference', sa.String(length=255), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['subscription_id'], ['subscriptions.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_subscription_charges_subscription_id'), 'subscription_charges', ['subscription_id'], unique=False)
    op.create_index(op.f('ix_subscription_charges_tenant_id'), 'subscription_charges', ['tenant_id'], unique=False)
    op.create_table('payment_records',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('charge_id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('amount_minor', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('recorded_by', sa.UUID(), nullable=False),
    sa.Column('payment_method', sa.String(length=32), nullable=False),
    sa.Column('evidence_reference', sa.String(length=255), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('idempotency_key', sa.String(length=128), nullable=True),
    sa.ForeignKeyConstraint(['charge_id'], ['subscription_charges.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_payment_records_charge_id'), 'payment_records', ['charge_id'], unique=False)
    op.create_index(op.f('ix_payment_records_idempotency_key'), 'payment_records', ['idempotency_key'], unique=True)
    op.create_index(op.f('ix_payment_records_tenant_id'), 'payment_records', ['tenant_id'], unique=False)

    # 4. Запрет пересечения активных занятостей одного мастера
    op.execute("""
        ALTER TABLE staff_occupancies
        ADD CONSTRAINT staff_occupancy_no_overlap
        EXCLUDE USING gist (
            tenant_id WITH =,
            staff_id WITH =,
            tstzrange(starts_at_utc, ends_at_utc, '[)') WITH &&
        ) WHERE (released_at IS NULL);
    """)

    # 5. Поиск токена управления записью в обход RLS (только по хэшу)
    op.execute("""
        CREATE OR REPLACE FUNCTION lookup_public_management_token(p_token_hash text)
        RETURNS TABLE (tenant_id uuid, booking_id uuid)
        LANGUAGE sql
        SECURITY DEFINER
        AS $$
            SELECT tenant_id, booking_id FROM public_management_tokens
            WHERE token_hash = p_token_hash 
              AND revoked_at IS NULL 
              AND (expires_at IS NULL OR expires_at > clock_timestamp());
        $$;
    """)

    # 6. Принудительный RLS и политика изоляции по tenant
    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY {table}_tenant_isolation ON {table}
            FOR ALL
            USING (
                tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
            )
            WITH CHECK (
                tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
            );
        """)

    # 7. Минимальные права runtime-роли (без DDL)
    op.execute(f"""
        GRANT USAGE ON SCHEMA public TO "{db_user}";
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{db_user}";
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "{db_user}";
        GRANT EXECUTE ON FUNCTION lookup_public_management_token(text) TO "{db_user}";
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "{db_user}";
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "{db_user}";
    """)


def downgrade() -> None:
    for table in TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};")
    op.execute("DROP FUNCTION IF EXISTS lookup_public_management_token(text);")
    op.execute("ALTER TABLE staff_occupancies DROP CONSTRAINT IF EXISTS staff_occupancy_no_overlap;")
    op.drop_index(op.f('ix_payment_records_tenant_id'), table_name='payment_records')
    op.drop_index(op.f('ix_payment_records_idempotency_key'), table_name='payment_records')
    op.drop_index(op.f('ix_payment_records_charge_id'), table_name='payment_records')
    op.drop_table('payment_records')
    op.drop_index(op.f('ix_subscription_charges_tenant_id'), table_name='subscription_charges')
    op.drop_index(op.f('ix_subscription_charges_subscription_id'), table_name='subscription_charges')
    op.drop_table('subscription_charges')
    op.drop_index(op.f('ix_support_messages_ticket_id'), table_name='support_messages')
    op.drop_table('support_messages')
    op.drop_index(op.f('ix_support_access_sessions_tenant_id'), table_name='support_access_sessions')
    op.drop_index(op.f('ix_support_access_sessions_request_id'), table_name='support_access_sessions')
    op.drop_table('support_access_sessions')
    op.drop_index(op.f('ix_subscriptions_tenant_id'), table_name='subscriptions')
    op.drop_index(op.f('ix_subscriptions_lifecycle_status'), table_name='subscriptions')
    op.drop_table('subscriptions')
    op.drop_index(op.f('ix_staff_service_offers_tenant_id'), table_name='staff_service_offers')
    op.drop_table('staff_service_offers')
    op.drop_index(op.f('ix_staff_occupancies_tenant_id'), table_name='staff_occupancies')
    op.drop_index(op.f('ix_staff_occupancies_starts_at_utc'), table_name='staff_occupancies')
    op.drop_index(op.f('ix_staff_occupancies_staff_id'), table_name='staff_occupancies')
    op.drop_index(op.f('ix_staff_occupancies_released_at'), table_name='staff_occupancies')
    op.drop_index(op.f('ix_staff_occupancies_ends_at_utc'), table_name='staff_occupancies')
    op.drop_index(op.f('ix_staff_occupancies_booking_id'), table_name='staff_occupancies')
    op.drop_index(op.f('ix_staff_occupancies_block_id'), table_name='staff_occupancies')
    op.drop_index('ix_occupancies_tenant_staff_dates', table_name='staff_occupancies')
    op.drop_table('staff_occupancies')
    op.drop_index(op.f('ix_shift_breaks_tenant_id'), table_name='shift_breaks')
    op.drop_table('shift_breaks')
    op.drop_index(op.f('ix_public_management_tokens_token_hash'), table_name='public_management_tokens')
    op.drop_index(op.f('ix_public_management_tokens_tenant_id'), table_name='public_management_tokens')
    op.drop_index(op.f('ix_public_management_tokens_booking_id'), table_name='public_management_tokens')
    op.drop_table('public_management_tokens')
    op.drop_index(op.f('ix_plan_entitlements_plan_version_id'), table_name='plan_entitlements')
    op.drop_index(op.f('ix_plan_entitlements_feature_key'), table_name='plan_entitlements')
    op.drop_table('plan_entitlements')
    op.drop_index(op.f('ix_branch_role_grants_membership_id'), table_name='branch_role_grants')
    op.drop_index(op.f('ix_branch_role_grants_branch_id'), table_name='branch_role_grants')
    op.drop_table('branch_role_grants')
    op.drop_index(op.f('ix_booking_items_tenant_id'), table_name='booking_items')
    op.drop_index(op.f('ix_booking_items_booking_id'), table_name='booking_items')
    op.drop_table('booking_items')
    op.drop_index(op.f('ix_booking_events_tenant_id'), table_name='booking_events')
    op.drop_index(op.f('ix_booking_events_booking_id'), table_name='booking_events')
    op.drop_table('booking_events')
    op.drop_index(op.f('ix_weekly_shifts_tenant_id'), table_name='weekly_shifts')
    op.drop_table('weekly_shifts')
    op.drop_index(op.f('ix_tenant_memberships_user_id'), table_name='tenant_memberships')
    op.drop_index(op.f('ix_tenant_memberships_tenant_id'), table_name='tenant_memberships')
    op.drop_table('tenant_memberships')
    op.drop_index(op.f('ix_tenant_entitlement_overrides_tenant_id'), table_name='tenant_entitlement_overrides')
    op.drop_table('tenant_entitlement_overrides')
    op.drop_index(op.f('ix_tenant_domains_tenant_id'), table_name='tenant_domains')
    op.drop_index(op.f('ix_tenant_domains_hostname_normalized'), table_name='tenant_domains')
    op.drop_table('tenant_domains')
    op.drop_index(op.f('ix_support_access_requests_tenant_id'), table_name='support_access_requests')
    op.drop_table('support_access_requests')
    op.drop_index(op.f('ix_subscription_decisions_tenant_id'), table_name='subscription_decisions')
    op.drop_table('subscription_decisions')
    op.drop_index(op.f('ix_staff_time_off_tenant_id'), table_name='staff_time_off')
    op.drop_table('staff_time_off')
    op.drop_index(op.f('ix_staff_branches_tenant_id'), table_name='staff_branches')
    op.drop_table('staff_branches')
    op.drop_index(op.f('ix_services_tenant_id'), table_name='services')
    op.drop_table('services')
    op.drop_index(op.f('ix_platform_support_tickets_tenant_id'), table_name='platform_support_tickets')
    op.drop_index(op.f('ix_platform_support_tickets_status'), table_name='platform_support_tickets')
    op.drop_table('platform_support_tickets')
    op.drop_table('platform_staff')
    op.drop_index(op.f('ix_plan_versions_plan_id'), table_name='plan_versions')
    op.drop_table('plan_versions')
    op.drop_index(op.f('ix_invites_token_hash'), table_name='invites')
    op.drop_index(op.f('ix_invites_tenant_id'), table_name='invites')
    op.drop_index(op.f('ix_invites_email'), table_name='invites')
    op.drop_table('invites')
    op.drop_index(op.f('ix_customer_notes_tenant_id'), table_name='customer_notes')
    op.drop_table('customer_notes')
    op.drop_index(op.f('ix_calendar_blocks_tenant_id'), table_name='calendar_blocks')
    op.drop_index(op.f('ix_calendar_blocks_staff_id'), table_name='calendar_blocks')
    op.drop_table('calendar_blocks')
    op.drop_index('ix_bookings_tenant_staff_start', table_name='bookings')
    op.drop_index(op.f('ix_bookings_tenant_id'), table_name='bookings')
    op.drop_index('ix_bookings_tenant_branch_start', table_name='bookings')
    op.drop_index(op.f('ix_bookings_status'), table_name='bookings')
    op.drop_index(op.f('ix_bookings_starts_at_utc'), table_name='bookings')
    op.drop_index(op.f('ix_bookings_staff_id'), table_name='bookings')
    op.drop_index(op.f('ix_bookings_public_ref'), table_name='bookings')
    op.drop_index(op.f('ix_bookings_idempotency_key'), table_name='bookings')
    op.drop_index(op.f('ix_bookings_customer_id'), table_name='bookings')
    op.drop_index(op.f('ix_bookings_branch_id'), table_name='bookings')
    op.drop_table('bookings')
    op.drop_index(op.f('ix_tenants_slug'), table_name='tenants')
    op.drop_index(op.f('ix_tenants_lifecycle_status'), table_name='tenants')
    op.drop_table('tenants')
    op.drop_index(op.f('ix_tenant_settings_tenant_id'), table_name='tenant_settings')
    op.drop_table('tenant_settings')
    op.drop_index(op.f('ix_staff_profiles_tenant_id'), table_name='staff_profiles')
    op.drop_table('staff_profiles')
    op.drop_index(op.f('ix_service_categories_tenant_id'), table_name='service_categories')
    op.drop_table('service_categories')
    op.drop_table('platform_settings')
    op.drop_index(op.f('ix_platform_audit_events_target_tenant_id'), table_name='platform_audit_events')
    op.drop_index(op.f('ix_platform_audit_events_occurred_at'), table_name='platform_audit_events')
    op.drop_index(op.f('ix_platform_audit_events_actor_id'), table_name='platform_audit_events')
    op.drop_index(op.f('ix_platform_audit_events_action'), table_name='platform_audit_events')
    op.drop_table('platform_audit_events')
    op.drop_index(op.f('ix_platform_alerts_tenant_id'), table_name='platform_alerts')
    op.drop_table('platform_alerts')
    op.drop_index(op.f('ix_plans_code'), table_name='plans')
    op.drop_table('plans')
    op.drop_index(op.f('ix_outbox_events_tenant_id'), table_name='outbox_events')
    op.drop_index(op.f('ix_outbox_events_event_type'), table_name='outbox_events')
    op.drop_index(op.f('ix_outbox_events_created_at'), table_name='outbox_events')
    op.drop_table('outbox_events')
    op.drop_index(op.f('ix_identity_users_oidc_subject'), table_name='identity_users')
    op.drop_index(op.f('ix_identity_users_email_normalized'), table_name='identity_users')
    op.drop_table('identity_users')
    op.drop_table('idempotency_records')
    op.drop_table('feature_catalog')
    op.drop_index(op.f('ix_customers_tenant_id'), table_name='customers')
    op.drop_index(op.f('ix_customers_phone_e164'), table_name='customers')
    op.drop_index(op.f('ix_customers_phone_digits_index'), table_name='customers')
    op.drop_index('ix_cust_tenant_phone', table_name='customers')
    op.drop_table('customers')
    op.drop_index(op.f('ix_branches_tenant_id'), table_name='branches')
    op.drop_table('branches')
    op.drop_index(op.f('ix_booking_themes_tenant_id'), table_name='booking_themes')
    op.drop_table('booking_themes')
    op.drop_index(op.f('ix_booking_quotes_tenant_id'), table_name='booking_quotes')
    op.drop_index(op.f('ix_booking_quotes_expires_at'), table_name='booking_quotes')
    op.drop_table('booking_quotes')
    op.drop_index(op.f('ix_booking_publications_tenant_id'), table_name='booking_publications')
    op.drop_table('booking_publications')
    op.drop_index(op.f('ix_booking_policies_tenant_id'), table_name='booking_policies')
    op.drop_table('booking_policies')
