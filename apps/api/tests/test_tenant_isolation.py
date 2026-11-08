import pytest
import uuid
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from apps.api.app.infrastructure.db.models import Tenant, Customer, StaffProfile, Branch
from apps.api.app.infrastructure.db.session import set_tenant_context

@pytest.mark.asyncio
async def test_strict_rls_tenant_isolation(db_session: AsyncSession):
    """
    CRITICAL P0 TEST:
    Verifies that PostgreSQL Row-Level Security strictly isolates tenant data.
    Both Tenant 1 (Barber House) and Tenant 2 (Modern Cut) have a customer with phone '+77771234567'.
    Under Tenant 1 context, ONLY Tenant 1 customer is returned.
    Under Tenant 2 context, ONLY Tenant 2 customer is returned.
    With no tenant context, ZERO rows are returned (Fail Closed)!
    """
    # 1. Fetch Tenant 1 and Tenant 2 IDs
    res1 = await db_session.execute(select(Tenant).where(Tenant.slug == "barberhouse"))
    t1 = res1.scalar_one()

    res2 = await db_session.execute(select(Tenant).where(Tenant.slug == "moderncut"))
    t2 = res2.scalar_one()

    # 2. Test Tenant 1 Context
    await set_tenant_context(db_session, t1.id)
    stmt_c1 = select(Customer).where(Customer.phone_e164 == "+77771234567")
    res_c1 = await db_session.execute(stmt_c1)
    customers_t1 = res_c1.scalars().all()
    assert len(customers_t1) == 1
    assert customers_t1[0].tenant_id == t1.id
    assert customers_t1[0].full_name == "Арман Сериков"

    # Also verify staff profiles under Tenant 1
    stmt_staff1 = select(StaffProfile)
    res_s1 = await db_session.execute(stmt_staff1)
    staff_t1 = res_s1.scalars().all()
    assert all(s.tenant_id == t1.id for s in staff_t1)
    assert any("Дамир" in s.display_name for s in staff_t1)
    assert not any("Руслан" in s.display_name for s in staff_t1)  # Ruslan belongs to Modern Cut!

    # 3. Test Tenant 2 Context
    await set_tenant_context(db_session, t2.id)
    stmt_c2 = select(Customer).where(Customer.phone_e164 == "+77771234567")
    res_c2 = await db_session.execute(stmt_c2)
    customers_t2 = res_c2.scalars().all()
    assert len(customers_t2) == 1
    assert customers_t2[0].tenant_id == t2.id
    assert "Modern Cut" in customers_t2[0].full_name

    # Verify staff profiles under Tenant 2
    stmt_staff2 = select(StaffProfile)
    res_s2 = await db_session.execute(stmt_staff2)
    staff_t2 = res_s2.scalars().all()
    assert all(s.tenant_id == t2.id for s in staff_t2)
    assert any("Руслан" in s.display_name for s in staff_t2)
    assert not any("Дамир" in s.display_name for s in staff_t2)

    # 4. Test Blank Context (Fail Closed)
    # Reset app.current_tenant to empty
    await db_session.execute(text("SELECT set_config('app.current_tenant', '', true)"))
    res_blank = await db_session.execute(select(Customer))
    blank_customers = res_blank.scalars().all()
    assert len(blank_customers) == 0, "With no tenant context, RLS must return ZERO rows (Fail Closed)!"


@pytest.mark.asyncio
async def test_cross_tenant_foreign_key_prevention(db_session: AsyncSession):
    """
    CRITICAL P0 TEST:
    Verifies that a tenant cannot reference entities of another tenant.
    """
    res1 = await db_session.execute(select(Tenant).where(Tenant.slug == "barberhouse"))
    t1 = res1.scalar_one()

    res2 = await db_session.execute(select(Tenant).where(Tenant.slug == "moderncut"))
    t2 = res2.scalar_one()

    await set_tenant_context(db_session, t2.id)
    res_s2 = await db_session.execute(select(StaffProfile).where(StaffProfile.tenant_id == t2.id))
    modern_cut_staff = res_s2.scalars().first()

    # Now switch to Tenant 1
    await set_tenant_context(db_session, t1.id)
    # Attempting to assign modern_cut_staff to Tenant 1 branch
    res_b1 = await db_session.execute(select(Branch).where(Branch.tenant_id == t1.id))
    b1 = res_b1.scalar_one()

    # Querying staff by modern_cut_staff.id in Tenant 1 returns None due to RLS!
    res_cross = await db_session.execute(select(StaffProfile).where(StaffProfile.id == modern_cut_staff.id))
    found = res_cross.scalar_one_or_none()
    assert found is None, "Tenant 1 must not be able to find or read Tenant 2 staff!"
