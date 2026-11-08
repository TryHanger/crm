import uuid
import datetime
from sqlalchemy import text
import apps.api.app.infrastructure.db.session as db_session
from apps.api.app.core.config import settings
from apps.api.app.infrastructure.security.jwt import get_password_hash
from apps.api.app.infrastructure.db.models import (
    Base, Tenant, TenantDomain, IdentityUser, TenantMembership, PlatformStaff,
    Invite, Plan, PlanVersion, PlanEntitlement, FeatureCatalog, Subscription,
    PlatformSetting, PlatformAlert, PlatformSupportTicket, SupportMessage,
    SupportAccessRequest, SupportAccessSession, SubscriptionCharge, PaymentRecord,
    Branch, TenantSettings, BookingPolicy, ServiceCategory, Service,
    StaffProfile, StaffBranch, StaffServiceOffer, WeeklyShift, ShiftBreak,
    Customer, Booking, BookingItem, StaffOccupancy, BookingTheme, BookingPublication
)

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

def apply_rls_and_constraints():
    """Applies btree_gist, exclusion constraints, and forces RLS on all tenant tables."""
    with db_session.admin_sync_engine.connect() as conn:
        # 1. Enable btree_gist
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist;"))

        # 2. Add PostgreSQL Exclusion Constraint for staff_occupancies (no overlapping active occupancies)
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'staff_occupancy_no_overlap'
                ) THEN
                    ALTER TABLE staff_occupancies
                    ADD CONSTRAINT staff_occupancy_no_overlap
                    EXCLUDE USING gist (
                        tenant_id WITH =,
                        staff_id WITH =,
                        tstzrange(starts_at_utc, ends_at_utc, '[)') WITH &&
                    ) WHERE (released_at IS NULL);
                END IF;
            END $$;
        """))

        # 2b. Add lookup_public_management_token SECURITY DEFINER function for safe public token resolution across RLS
        conn.execute(text("""
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
        """))

        # 3. Apply RLS on each tenant table
        for table in TENANT_TABLES:
            conn.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;"))
            conn.execute(text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;"))
            conn.execute(text(f"DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};"))
            conn.execute(text(f"""
                CREATE POLICY {table}_tenant_isolation ON {table}
                FOR ALL
                USING (
                    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
                )
                WITH CHECK (
                    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
                );
            """))

        # 4. Create and grant least-privilege permissions to runtime role
        db_user = settings.DB_USER
        db_pwd = settings.DB_PASSWORD or "crm_app_secret"
        conn.execute(text(f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{db_user}') THEN
                    EXECUTE format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', '{db_user}', '{db_pwd}');
                ELSE
                    EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', '{db_user}', '{db_pwd}');
                END IF;
                GRANT USAGE ON SCHEMA public TO "{db_user}";
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{db_user}";
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "{db_user}";
                GRANT EXECUTE ON FUNCTION lookup_public_management_token(text) TO "{db_user}";
                ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "{db_user}";
                ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "{db_user}";
            END $$;
        """))

        conn.commit()
    print("PostgreSQL RLS and Exclusion Constraints applied successfully!")


def init_database():
    """Creates all database tables, extensions, constraints, and RLS policies."""
    with db_session.admin_sync_engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist;"))
        conn.commit()

    Base.metadata.create_all(bind=db_session.admin_sync_engine)
    apply_rls_and_constraints()
    print("Database tables initialized successfully!")


def seed_system_baseline(session):
    """Seeds feature catalog, plans, and default platform roles (strictly non-tenant)."""
    existing_plan = session.query(Plan).filter_by(code="start").first()
    if existing_plan:
        return

    # 1. Feature Catalog
    features = [
        FeatureCatalog(key="online_booking", name="Онлайн-запись", release_stage="available", configurable=True, description="Публичный виджет записи"),
        FeatureCatalog(key="basic_reports", name="Базовые отчёты", release_stage="available", configurable=True, description="Статистика визитов и выручки"),
        FeatureCatalog(key="sms_notifications", name="SMS-уведомления", release_stage="planned", configurable=False, description="SMS клиентам (в разработке)"),
        FeatureCatalog(key="custom_domain", name="Собственный домен", release_stage="beta", configurable=True, description="Подключение CNAME домена"),
        FeatureCatalog(key="advanced_analytics", name="Расширенная аналитика", release_stage="available", configurable=True, description="Когорты и удержание клиентов"),
    ]
    session.add_all(features)

    # 2. Plans and Versions
    # Plan 1: Start (9 000 KZT)
    plan_start = Plan(code="start", name="Start", description="Для одного филиала и небольшой команды")
    session.add(plan_start)
    session.flush()

    pv_start = PlanVersion(plan_id=plan_start.id, version=1, price_minor=900000, currency="KZT", is_active=True)
    session.add(pv_start)
    session.flush()

    pe_start = [
        PlanEntitlement(plan_version_id=pv_start.id, feature_key="max_branches", limit_value=1, enabled=True),
        PlanEntitlement(plan_version_id=pv_start.id, feature_key="max_active_staff", limit_value=5, enabled=True),
        PlanEntitlement(plan_version_id=pv_start.id, feature_key="online_booking", limit_value=None, enabled=True),
        PlanEntitlement(plan_version_id=pv_start.id, feature_key="basic_reports", limit_value=None, enabled=True),
    ]
    session.add_all(pe_start)

    # Plan 2: Pro (18 000 KZT)
    plan_pro = Plan(code="pro", name="Pro", description="Для растущих барбершопов")
    session.add(plan_pro)
    session.flush()

    pv_pro = PlanVersion(plan_id=plan_pro.id, version=1, price_minor=1800000, currency="KZT", is_active=True)
    session.add(pv_pro)
    session.flush()

    pe_pro = [
        PlanEntitlement(plan_version_id=pv_pro.id, feature_key="max_branches", limit_value=3, enabled=True),
        PlanEntitlement(plan_version_id=pv_pro.id, feature_key="max_active_staff", limit_value=15, enabled=True),
        PlanEntitlement(plan_version_id=pv_pro.id, feature_key="online_booking", limit_value=None, enabled=True),
        PlanEntitlement(plan_version_id=pv_pro.id, feature_key="basic_reports", limit_value=None, enabled=True),
        PlanEntitlement(plan_version_id=pv_pro.id, feature_key="custom_domain", limit_value=None, enabled=True),
    ]
    session.add_all(pe_pro)

    # 3. Platform Users & Roles
    demo_pwd_hash = get_password_hash("Password123!")
    pv_start = session.query(PlanVersion).join(Plan).filter(Plan.code == "start").first()
    pv_pro = session.query(PlanVersion).join(Plan).filter(Plan.code == "pro").first()

    # Platform Owner
    u_powner = IdentityUser(
        oidc_subject="platform_owner_sub",
        email_normalized="owner@platform.example.kz",
        display_name="Главный Администратор Платформы",
        password_hash=demo_pwd_hash
    )
    session.add(u_powner)
    session.flush()

    ps_owner = PlatformStaff(user_id=u_powner.id, platform_role="platform_owner")
    session.add(ps_owner)

    # Platform Support
    u_psupport = IdentityUser(
        oidc_subject="platform_support_sub",
        email_normalized="support@platform.example.kz",
        display_name="Агент Поддержки Платформы",
        password_hash=demo_pwd_hash
    )
    session.add(u_psupport)
    session.flush()

    ps_support = PlatformStaff(user_id=u_psupport.id, platform_role="support")
    session.add(ps_support)

    # Platform Finance
    u_pfinance = IdentityUser(
        oidc_subject="platform_finance_sub",
        email_normalized="finance@platform.example.kz",
        display_name="Финансовый Менеджер Платформы",
        password_hash=demo_pwd_hash
    )
    session.add(u_pfinance)
    session.flush()

    ps_finance = PlatformStaff(user_id=u_pfinance.id, platform_role="finance")
    session.add(ps_finance)
    session.flush()

    # Platform Viewer
    u_pviewer = IdentityUser(
        oidc_subject="platform_viewer_sub",
        email_normalized="viewer@platform.example.kz",
        display_name="Аудитор Платформы",
        password_hash=demo_pwd_hash
    )
    session.add(u_pviewer)
    session.flush()

    ps_viewer = PlatformStaff(user_id=u_pviewer.id, platform_role="viewer")
    session.add(ps_viewer)
    session.flush()

    # Seed Platform Settings if not exist
    if not session.query(PlatformSetting).filter_by(key="trial_days").first():
        s_trial = PlatformSetting(key="trial_days", value_json=14, description="Стандартный пробный период (дней)")
        s_grace = PlatformSetting(key="grace_period_days", value_json=7, description="Льготный период после окончания срока (дней)")
        s_verticals = PlatformSetting(
            key="supported_verticals",
            value_json=["barbershop", "beauty_salon", "dentistry", "auto_service", "fitness"],
            description="Поддерживаемые ниши бизнеса"
        )
        session.add_all([s_trial, s_grace, s_verticals])
        session.flush()


def seed_demo_tenants(session):
    """Seeds two independent demo tenants for dev/testing only."""
    existing_t = session.query(Tenant).filter_by(slug="barberhouse").first()
    if existing_t:
        return

    demo_pwd_hash = get_password_hash("Password123!")
    pv_start = session.query(PlanVersion).join(Plan).filter(Plan.code == "start").first()
    pv_pro = session.query(PlanVersion).join(Plan).filter(Plan.code == "pro").first()

    # =========================================================================
    # SEED TENANT 1: Barber House (barberhouse.book.example.kz)
    # =========================================================================
    t1 = Tenant(
        slug="barberhouse",
        display_name="Barber House",
        vertical="barbershop",
        lifecycle_status="active",
        timezone_default="Asia/Almaty"
    )
    session.add(t1)
    session.flush()

    td1 = TenantDomain(
        tenant_id=t1.id,
        hostname_normalized="barberhouse.book.example.kz",
        domain_type="system_subdomain",
        verification_status="verified",
        canonical=True,
        verified_at=datetime.datetime.utcnow()
    )
    session.add(td1)

    td1_local = TenantDomain(
        tenant_id=t1.id,
        hostname_normalized="barberhouse.localhost",
        domain_type="custom",
        verification_status="verified",
        canonical=False,
        verified_at=datetime.datetime.utcnow()
    )
    session.add(td1_local)

    # Owner for Barber House
    u_t1_owner = IdentityUser(
        oidc_subject="barberhouse_owner_sub",
        email_normalized="owner@barberhouse.kz",
        display_name="Алишер Владелец",
        password_hash=demo_pwd_hash
    )
    session.add(u_t1_owner)
    session.flush()

    m_t1_owner = TenantMembership(tenant_id=t1.id, user_id=u_t1_owner.id, role="owner", status="active")
    session.add(m_t1_owner)
    session.flush()
    t1.owner_membership_id = m_t1_owner.id

    # Master login for Barber House
    u_t1_master = IdentityUser(
        oidc_subject="damir_master_sub",
        email_normalized="damir@barberhouse.kz",
        display_name="Дамир Мастер",
        password_hash=demo_pwd_hash
    )
    session.add(u_t1_master)
    session.flush()

    m_t1_master = TenantMembership(tenant_id=t1.id, user_id=u_t1_master.id, role="master", status="active")
    session.add(m_t1_master)

    # Subscription for Barber House: Trial 14 days, Grace 7 days
    now = datetime.datetime.utcnow()
    sub1 = Subscription(
        tenant_id=t1.id,
        plan_version_id=pv_start.id,
        lifecycle_status="trial",
        period_start=now,
        period_end=now + datetime.timedelta(days=14),
        trial_ends_at=now + datetime.timedelta(days=14),
        grace_ends_at=now + datetime.timedelta(days=21),
        renewal_mode="manual"
    )
    session.add(sub1)

    # Session tenant context for Tenant 1 Data
    session.execute(text("SET LOCAL app.current_tenant = :t"), {"t": str(t1.id)})

    # Tenant 1: Branch
    b1 = Branch(
        tenant_id=t1.id,
        name="Barber House Астана",
        city="Астана",
        address="пр. Мангилик Ел, 24",
        timezone_iana="Asia/Almaty",
        status="active",
        phone="+77011112233"
    )
    session.add(b1)
    session.flush()

    # Tenant 1: Settings & Policy
    ts1 = TenantSettings(
        tenant_id=t1.id,
        business_name="Barber House",
        locale="ru",
        currency="KZT",
        phone="+77011112233",
        description="Премиальный барбершоп в центре Астаны"
    )
    session.add(ts1)

    bp1 = BookingPolicy(
        tenant_id=t1.id,
        branch_id=b1.id,
        book_ahead_days=30,
        min_advance_minutes=120,
        cancellation_cutoff_minutes=180,
        allow_self_reschedule=True,
        slot_step_minutes=15,
        max_services_per_booking=5,
        allow_online_booking=True
    )
    session.add(bp1)

    btheme1 = BookingTheme(
        tenant_id=t1.id,
        primary_color="#1E293B",
        accent_color="#D97706"
    )
    session.add(btheme1)

    bpub1 = BookingPublication(
        tenant_id=t1.id,
        branch_id=b1.id,
        is_published=True,
        slug="barberhouse"
    )
    session.add(bpub1)

    # Tenant 1: Categories & Services
    cat1 = ServiceCategory(tenant_id=t1.id, name="Стрижки", sort_order=1)
    cat2 = ServiceCategory(tenant_id=t1.id, name="Борода и бритье", sort_order=2)
    session.add_all([cat1, cat2])
    session.flush()

    s1_haircut = Service(
        tenant_id=t1.id,
        category_id=cat1.id,
        name="Мужская стрижка",
        description="Мытье головы, моделирование стрижки, укладка",
        base_price_minor=700000,  # 7 000 KZT
        currency="KZT",
        base_duration_minutes=45,
        active=True,
        online_visible=True
    )
    s1_beard = Service(
        tenant_id=t1.id,
        category_id=cat2.id,
        name="Моделирование бороды",
        description="Оформление контуров, стрижка бороды, уход маслом",
        base_price_minor=450000,  # 4 500 KZT
        currency="KZT",
        base_duration_minutes=30,
        active=True,
        online_visible=True
    )
    s1_combo = Service(
        tenant_id=t1.id,
        category_id=cat1.id,
        name="Комплекс: Стрижка + Борода",
        description="Полный комплекс ухода",
        base_price_minor=1050000,  # 10 500 KZT
        currency="KZT",
        base_duration_minutes=75,
        active=True,
        online_visible=True
    )
    session.add_all([s1_haircut, s1_beard, s1_combo])
    session.flush()

    # Tenant 1: Staff Profiles
    sp_damir = StaffProfile(
        tenant_id=t1.id,
        user_id=u_t1_master.id,
        display_name="Дамир Султанов",
        role_title="Топ-барбер",
        active=True,
        online_bookable=True,
        color="#2563EB"
    )
    sp_erzhan = StaffProfile(
        tenant_id=t1.id,
        display_name="Ержан Касымов",
        role_title="Барбер",
        active=True,
        online_bookable=True,
        color="#10B981"
    )
    session.add_all([sp_damir, sp_erzhan])
    session.flush()

    # Staff Branch assignment
    session.add_all([
        StaffBranch(tenant_id=t1.id, staff_id=sp_damir.id, branch_id=b1.id, active=True, valid_from=now),
        StaffBranch(tenant_id=t1.id, staff_id=sp_erzhan.id, branch_id=b1.id, active=True, valid_from=now),
    ])

    # Staff Service Offers with Overrides (e.g. Damir is top barber: slightly higher price or same)
    # Damir: 8 000 KZT for haircut (override +1000 KZT), 45 min
    session.add(StaffServiceOffer(
        tenant_id=t1.id, staff_id=sp_damir.id, branch_id=b1.id, service_id=s1_haircut.id,
        price_override_minor=800000, duration_override_minutes=45, active=True, online_visible=True
    ))
    session.add(StaffServiceOffer(
        tenant_id=t1.id, staff_id=sp_damir.id, branch_id=b1.id, service_id=s1_beard.id,
        price_override_minor=500000, duration_override_minutes=30, active=True, online_visible=True
    ))
    session.add(StaffServiceOffer(
        tenant_id=t1.id, staff_id=sp_damir.id, branch_id=b1.id, service_id=s1_combo.id,
        price_override_minor=1200000, duration_override_minutes=75, active=True, online_visible=True
    ))
    # Erzhan: base price 7 000 KZT, 50 min
    session.add(StaffServiceOffer(
        tenant_id=t1.id, staff_id=sp_erzhan.id, branch_id=b1.id, service_id=s1_haircut.id,
        price_override_minor=700000, duration_override_minutes=50, active=True, online_visible=True
    ))
    session.add(StaffServiceOffer(
        tenant_id=t1.id, staff_id=sp_erzhan.id, branch_id=b1.id, service_id=s1_beard.id,
        price_override_minor=450000, duration_override_minutes=30, active=True, online_visible=True
    ))
    session.add(StaffServiceOffer(
        tenant_id=t1.id, staff_id=sp_erzhan.id, branch_id=b1.id, service_id=s1_combo.id,
        price_override_minor=1050000, duration_override_minutes=75, active=True, online_visible=True
    ))
    session.flush()

    # Working Shifts for Damir & Erzhan (Monday to Saturday: 10:00 to 20:00 with lunch break 14:00 - 15:00)
    for weekday in range(1, 7):
        shift_d = WeeklyShift(
            tenant_id=t1.id, staff_id=sp_damir.id, branch_id=b1.id, weekday_iso=weekday,
            local_start=datetime.time(10, 0), local_end=datetime.time(20, 0), effective_from=now
        )
        session.add(shift_d)
        session.flush()
        session.add(ShiftBreak(
            tenant_id=t1.id, shift_id=shift_d.id,
            local_start=datetime.time(14, 0), local_end=datetime.time(15, 0)
        ))

        shift_e = WeeklyShift(
            tenant_id=t1.id, staff_id=sp_erzhan.id, branch_id=b1.id, weekday_iso=weekday,
            local_start=datetime.time(10, 0), local_end=datetime.time(20, 0), effective_from=now
        )
        session.add(shift_e)
        session.flush()
        session.add(ShiftBreak(
            tenant_id=t1.id, shift_id=shift_e.id,
            local_start=datetime.time(13, 0), local_end=datetime.time(14, 0)
        ))

    # Tenant 1: Customer
    c1 = Customer(
        tenant_id=t1.id,
        full_name="Арман Сериков",
        phone_e164="+77771234567",
        phone_digits_index="77771234567",
        email="arman@example.kz",
        notes_private="Предпочитает классический фейд",
        marketing_consent=True,
        data_source="crm_manual"
    )
    session.add(c1)
    session.flush()

    # =========================================================================
    # SEED TENANT 2: Modern Cut (moderncut.book.example.kz) - Isolated Independent
    # =========================================================================
    t2 = Tenant(
        slug="moderncut",
        display_name="Modern Cut Studio",
        vertical="barbershop",
        lifecycle_status="active",
        timezone_default="Asia/Almaty"
    )
    session.add(t2)
    session.flush()

    td2 = TenantDomain(
        tenant_id=t2.id,
        hostname_normalized="moderncut.book.example.kz",
        domain_type="system_subdomain",
        verification_status="verified",
        canonical=True,
        verified_at=datetime.datetime.utcnow()
    )
    session.add(td2)

    td2_local = TenantDomain(
        tenant_id=t2.id,
        hostname_normalized="moderncut.localhost",
        domain_type="custom",
        verification_status="verified",
        canonical=False,
        verified_at=datetime.datetime.utcnow()
    )
    session.add(td2_local)

    u_t2_owner = IdentityUser(
        oidc_subject="moderncut_owner_sub",
        email_normalized="owner@moderncut.kz",
        display_name="Тимур ModernCut",
        password_hash=demo_pwd_hash
    )
    session.add(u_t2_owner)
    session.flush()

    m_t2_owner = TenantMembership(tenant_id=t2.id, user_id=u_t2_owner.id, role="owner", status="active")
    session.add(m_t2_owner)
    session.flush()
    t2.owner_membership_id = m_t2_owner.id

    sub2 = Subscription(
        tenant_id=t2.id,
        plan_version_id=pv_pro.id,
        lifecycle_status="active",
        period_start=now,
        period_end=now + datetime.timedelta(days=30),
        renewal_mode="manual"
    )
    session.add(sub2)

    # Switch context to Tenant 2
    session.execute(text("SET LOCAL app.current_tenant = :t"), {"t": str(t2.id)})

    b2 = Branch(
        tenant_id=t2.id,
        name="Modern Cut Алматы",
        city="Алматы",
        address="ул. Достык, 89",
        timezone_iana="Asia/Almaty",
        status="active",
        phone="+77279998877"
    )
    session.add(b2)
    session.flush()

    ts2 = TenantSettings(
        tenant_id=t2.id,
        business_name="Modern Cut Studio",
        locale="ru",
        currency="KZT",
        phone="+77279998877"
    )
    session.add(ts2)

    bp2 = BookingPolicy(
        tenant_id=t2.id,
        branch_id=b2.id,
        book_ahead_days=14,
        min_advance_minutes=60,
        cancellation_cutoff_minutes=120,
        allow_self_reschedule=True,
        slot_step_minutes=15,
        max_services_per_booking=3,
        allow_online_booking=True
    )
    session.add(bp2)

    bpub2 = BookingPublication(
        tenant_id=t2.id,
        branch_id=b2.id,
        is_published=True,
        slug="moderncut"
    )
    session.add(bpub2)

    cat_t2 = ServiceCategory(tenant_id=t2.id, name="Услуги стилиста", sort_order=1)
    session.add(cat_t2)
    session.flush()

    s2_cut = Service(
        tenant_id=t2.id,
        category_id=cat_t2.id,
        name="Стрижка Modern Cut",
        base_price_minor=900000,
        currency="KZT",
        base_duration_minutes=60,
        active=True,
        online_visible=True
    )
    session.add(s2_cut)
    session.flush()

    sp_t2_master = StaffProfile(
        tenant_id=t2.id,
        display_name="Руслан Стилист",
        role_title="Шеф-барбер",
        active=True,
        online_bookable=True,
        color="#8B5CF6"
    )
    session.add(sp_t2_master)
    session.flush()

    session.add(StaffBranch(tenant_id=t2.id, staff_id=sp_t2_master.id, branch_id=b2.id, active=True, valid_from=now))
    session.add(StaffServiceOffer(
        tenant_id=t2.id, staff_id=sp_t2_master.id, branch_id=b2.id, service_id=s2_cut.id,
        price_override_minor=900000, duration_override_minutes=60, active=True, online_visible=True
    ))

    # Weekly shifts for Modern Cut master (Mon - Sat, 10:00 - 19:00)
    for wd in range(1, 7):
        session.add(WeeklyShift(
            tenant_id=t2.id,
            staff_id=sp_t2_master.id,
            branch_id=b2.id,
            weekday_iso=wd,
            local_start=datetime.time(10, 0),
            local_end=datetime.time(19, 0),
            effective_from=datetime.date(2026, 1, 1)
        ))

    # Tenant 2: Customer with SAME PHONE as Tenant 1 customer! (Crucial isolation test fixture)
    c2 = Customer(
        tenant_id=t2.id,
        full_name="Арман (клиент Modern Cut)",
        phone_e164="+77771234567",  # SAME PHONE NUMBER!
        phone_digits_index="77771234567",
        email="arman@example.kz",
        notes_private="Заметка видна ТОЛЬКО персоналу Modern Cut!",
        marketing_consent=False,
        data_source="public_booking"
    )
    session.add(c2)
    session.flush()

    # Seed additional tenants for Platform Console review (Cut & Co, Studio 17, Fade Lab, Smile Dent, Old Town Cuts)
    pv_business = session.query(PlanVersion).join(Plan).filter(Plan.code == "business").first()
    if not pv_business:
        plan_bus = session.query(Plan).filter_by(code="business").first()
        if not plan_bus:
            plan_bus = Plan(code="business", name="Business", description="Сеть и свой домен")
            session.add(plan_bus)
            session.flush()
        pv_business = PlanVersion(plan_id=plan_bus.id, version=1, price_minor=3900000, currency="KZT", is_active=True)
        session.add(pv_business)
        session.flush()

    extra_tenants = [
        ("cutco", "Cut & Co", "barbershop", "active", "start", "pending_suspension", now - datetime.timedelta(days=22), now - datetime.timedelta(days=8), now - datetime.timedelta(days=1)),
        ("studio17", "Studio 17", "beauty_salon", "active", "start", "grace", now - datetime.timedelta(days=33), now - datetime.timedelta(days=3), now + datetime.timedelta(days=4)),
        ("fadelab", "Fade Lab", "barbershop", "active", "business", "active", now - datetime.timedelta(days=60), now + datetime.timedelta(days=120), None),
        ("smiledent", "Smile Dent", "dentistry", "active", "start", "trial", now - datetime.timedelta(days=9), now + datetime.timedelta(days=5), None),
        ("oldtowncuts", "Old Town Cuts", "barbershop", "suspended", "start", "suspended", now - datetime.timedelta(days=90), now - datetime.timedelta(days=8), None)
    ]

    for slug, dname, vert, lstatus, pcode, sstatus, pstart, pend, gends in extra_tenants:
        t_exist = session.query(Tenant).filter_by(slug=slug).first()
        if not t_exist:
            ext_t = Tenant(slug=slug, display_name=dname, vertical=vert, lifecycle_status=lstatus, timezone_default="Asia/Almaty")
            if lstatus == "suspended":
                ext_t.suspended_at = now - datetime.timedelta(days=8)
                ext_t.suspension_reason = "Не оплачена подписка по окончании льготного периода"
            session.add(ext_t)
            session.flush()
            ext_dom = TenantDomain(tenant_id=ext_t.id, hostname_normalized=f"{slug}.book.example.kz", domain_type="system_subdomain", verification_status="verified", canonical=True, verified_at=now)
            session.add(ext_dom)
            p_ver = pv_business if pcode == "business" else (pv_pro if pcode == "pro" else pv_start)
            ext_sub = Subscription(
                tenant_id=ext_t.id,
                plan_version_id=p_ver.id,
                lifecycle_status=sstatus,
                period_start=pstart,
                period_end=pend,
                trial_ends_at=pend if sstatus == "trial" else None,
                grace_ends_at=gends,
                renewal_mode="manual"
            )
            session.add(ext_sub)
            session.flush()

    # Platform users for demo seed
    p_fin = session.query(IdentityUser).filter_by(email_normalized="finance@platform.example.kz").first()
    p_sup = session.query(IdentityUser).filter_by(email_normalized="support@platform.example.kz").first()

    # Seed demo charges and payments for Barber House
    ch1 = SubscriptionCharge(
        tenant_id=t1.id,
        subscription_id=sub1.id,
        period_start=now - datetime.timedelta(days=30),
        period_end=now,
        amount_minor=1900000,
        currency="KZT",
        charge_status="paid",
        evidence_reference="Счёт № 201 от 15 сен"
    )
    session.add(ch1)
    session.flush()
    pm1 = PaymentRecord(
        charge_id=ch1.id,
        tenant_id=t1.id,
        amount_minor=1900000,
        currency="KZT",
        recorded_by=p_fin.id if p_fin else u_t1_owner.id,
        payment_method="bank_transfer",
        evidence_reference="Платёжное поручение № 4410",
        note="Оплата подписки Pro за сентябрь-октябрь"
    )
    session.add(pm1)

    # Current charge (issued, awaiting payment)
    ch2 = SubscriptionCharge(
        tenant_id=t1.id,
        subscription_id=sub1.id,
        period_start=now,
        period_end=now + datetime.timedelta(days=30),
        amount_minor=1900000,
        currency="KZT",
        charge_status="issued",
        evidence_reference="Счёт № 214 от 15 окт"
    )
    session.add(ch2)

    # Seed demo support ticket for Barber House
    tick1 = PlatformSupportTicket(
        tenant_id=t1.id,
        creator_id=u_t1_owner.id,
        subject="Не приходит приглашение мастеру",
        status="open",
        priority="high"
    )
    session.add(tick1)
    session.flush()

    msg1 = SupportMessage(
        ticket_id=tick1.id,
        sender_id=u_t1_owner.id,
        sender_role="tenant_user",
        message="Мастер Ерлан не получил письмо с приглашением. Проверьте, пожалуйста.",
        is_internal=False
    )
    session.add(msg1)

    # Seed support access request for ticket #1042
    req_acc = SupportAccessRequest(
        tenant_id=t1.id,
        requester_id=p_sup.id if p_sup else u_t1_owner.id,
        reason="Обращение #1042: не приходит приглашение мастеру",
        requested_scope="read_only_diagnostic",
        status="pending",
        expires_at=now + datetime.timedelta(hours=24)
    )
    session.add(req_acc)
    session.flush()

    print("Demo tenants, billing ledger and support tickets seeded successfully.")


def seed_database():
    """Seeds baseline catalog, plans, platform roles, and conditionally seeds demo tenants only in DEV/TEST."""
    with db_session.AdminSyncSessionLocal() as session:
        seed_system_baseline(session)
        if getattr(settings, "ENABLE_DEMO_SEED", False) and settings.ENVIRONMENT in ("development", "test"):
            seed_demo_tenants(session)
            print("Database demo seed applied.")
        else:
            print("Database demo seed skipped (ENABLE_DEMO_SEED is disabled).")
        session.commit()
    print("Database seeding completed.")

if __name__ == "__main__":
    init_database()
    seed_database()
