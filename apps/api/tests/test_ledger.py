"""M05-D2: финансовые таблицы и инварианты журнала денег.

Все проверки идут под runtime-ролью приложения (NOSUPERUSER, NOBYPASSRLS) с tenant-контекстом,
как в рабочем API; админ-подключение используется только чтобы подготовить данные и
доказать, что триггеры неизменяемости действуют и на владельца таблиц.
"""
import asyncio
import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.app.modules.finance import ledger, orders
from apps.api.app.modules.finance.ledger import FinanceError


def admin(sql, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(sql), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


def tenant(slug):
    row = admin("SELECT t.id, b.id FROM tenants t JOIN branches b ON b.tenant_id = t.id WHERE t.slug = :s "
                "ORDER BY b.created_at LIMIT 1", s=slug)[0]
    return row[0], row[1]


async def set_ctx(s, tenant_id):
    """tenant context is transaction-local (like the API): restore it after commit/rollback."""
    await s.execute(text("SELECT set_config('app.current_tenant', :t, true)"), {"t": str(tenant_id)})


@asynccontextmanager
async def app_session(tenant_id):
    """Сессия как в API: runtime-роль + transaction-local tenant context."""
    engine = create_async_engine(settings.ASYNC_DATABASE_URL, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as s:
            await s.execute(text("SELECT set_config('app.current_tenant', :t, true)"), {"t": str(tenant_id)})
            yield s
    finally:
        await engine.dispose()


async def make_order(tenant_id, branch_id, price=8000_00):
    async with app_session(tenant_id) as s:
        order = await orders.new_order(s, tenant_id=tenant_id, branch_id=branch_id, source="walk_in")
        await orders.add_item(s, order, name="Стрижка M05", unit_price_minor=price, price_source="base")
        await s.commit()
        return order.id


async def public_booking(branch_id):
    """Real booking through the public API (no fixtures in the DB)."""
    import datetime
    from httpx import ASGITransport, AsyncClient
    from apps.api.app.main import app
    host = {"Host": "barberhouse.book.example.kz"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as c:
        svc = (await c.get("/api/v1/public/services", headers=host)).json()[0]["id"]
        staff = (await c.get(f"/api/v1/public/staff?branch_id={branch_id}&service_ids={svc}", headers=host)).json()[0]["id"]
        day = datetime.date.today() + datetime.timedelta(days=25)
        slots = (await c.post("/api/v1/public/availability/search", headers=host, json={
            "branch_id": str(branch_id), "service_ids": [svc], "staff_id": staff, "staff_mode": "specific",
            "from_date": day.isoformat(), "to_date": (day + datetime.timedelta(days=3)).isoformat()})).json()["slots"]
        slot = slots[len(slots) // 2]
        r = await c.post("/api/v1/public/bookings", headers={**host, "Idempotency-Key": key()}, json={
            "branch_id": str(branch_id), "staff_id": staff, "service_ids": [svc], "starts_at_utc": slot["starts_at_utc"],
            "customer_name": "Ledger Test", "customer_phone": "+77010000555", "expected_price_minor": slot["price_minor"]})
        assert r.status_code == 201, r.text
        return uuid.UUID(r.json()["booking_id"])


def key():
    return f"m05-{uuid.uuid4()}"


async def post(tenant_id, branch_id, **kw):
    async with app_session(tenant_id) as s:
        res = await ledger.post_entry(s, tenant_id=tenant_id, branch_id=branch_id, **kw)
        await s.commit()
        return res


# ---------------------------------------------------------------- schema

def test_finance_tables_are_tenant_isolated_and_constrained():
    rls = dict(admin("SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('orders','order_items','ledger_entries')"))
    assert rls == {"orders": True, "order_items": True, "ledger_entries": True}
    triggers = {r[0] for r in admin("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal "
                                     "AND tgrelid::regclass::text IN ('orders','order_items','ledger_entries')")}
    assert triggers == {"ledger_entries_append_only", "order_items_immutable", "orders_no_delete"}


# ---------------------------------------------------------------- order snapshot

async def test_order_item_snapshot_math_and_immutability():
    t, b = tenant("barberhouse")
    async with app_session(t) as s:
        order = await orders.new_order(s, tenant_id=t, branch_id=b, source="walk_in")
        item = await orders.add_item(s, order, name="Комплекс", unit_price_minor=4500_00, quantity=2,
                                     discount_minor=1000_00, price_source="manual")
        assert order.currency == "KZT" and item.total_minor == 8000_00 and item.sequence == 1
        with pytest.raises(FinanceError, match="Скидка"):
            await orders.add_item(s, order, name="x", unit_price_minor=100, discount_minor=101, price_source="base")
        await s.commit()

    # БД сама не даёт записать неверный итог
    with pytest.raises(IntegrityError, match="ck_order_item_total"):
        admin("INSERT INTO order_items (id, tenant_id, order_id, sequence, kind, name_snapshot, unit_price_minor, "
              "quantity, discount_minor, total_minor, currency, price_source) VALUES (gen_random_uuid(), :t, :o, 9, "
              "'service', 'bad', 100, 1, 0, 99, 'KZT', 'base')", t=t, o=order.id)
    # позиция и заказ не переписываются и не удаляются даже владельцем таблиц
    for sql in ("UPDATE order_items SET unit_price_minor = 1 WHERE order_id = :o",
                "DELETE FROM order_items WHERE order_id = :o",
                "DELETE FROM orders WHERE id = :o"):
        with pytest.raises(DBAPIError, match="FINANCE_IMMUTABLE"):
            admin(sql, o=order.id)


async def test_booking_order_requires_booking_and_is_unique_per_booking():
    t, b = tenant("barberhouse")
    async with app_session(t) as s:
        with pytest.raises(FinanceError, match="ссылаться на запись"):
            await orders.new_order(s, tenant_id=t, branch_id=b, source="booking")
    booking_id = await public_booking(b)
    async with app_session(t) as s:
        await orders.new_order(s, tenant_id=t, branch_id=b, source="booking", booking_id=booking_id)
        with pytest.raises(IntegrityError, match="uq_order_per_booking"):
            await orders.new_order(s, tenant_id=t, branch_id=b, source="booking", booking_id=booking_id)
        await s.rollback()


# ---------------------------------------------------------------- idempotency

async def test_same_key_posts_once_and_conflicting_reuse_is_rejected():
    t, b = tenant("barberhouse")
    order_id = await make_order(t, b)
    k = key()
    first = await post(t, b, kind="service_rendered", amount_minor=8000_00, currency="KZT", idempotency_key=k, order_id=order_id)
    again = await post(t, b, kind="service_rendered", amount_minor=8000_00, currency="kzt", idempotency_key=k, order_id=order_id)
    assert first.created and not again.created and first.entry.id == again.entry.id
    with pytest.raises(FinanceError) as e:
        await post(t, b, kind="service_rendered", amount_minor=7000_00, currency="KZT", idempotency_key=k, order_id=order_id)
    assert e.value.code == "IDEMPOTENCY_KEY_REUSED"
    assert admin("SELECT count(*) FROM ledger_entries WHERE idempotency_key = :k", k=k)[0][0] == 1


async def test_twenty_parallel_retries_create_one_entry():
    t, b = tenant("barberhouse")
    order_id = await make_order(t, b)
    k = key()
    results = await asyncio.gather(*[
        post(t, b, kind="payment", amount_minor=3000_00, currency="KZT", idempotency_key=k, order_id=order_id)
        for _ in range(20)
    ])
    assert sum(r.created for r in results) == 1
    assert len({r.entry.id for r in results}) == 1
    assert admin("SELECT count(*) FROM ledger_entries WHERE idempotency_key = :k", k=k)[0][0] == 1


async def test_same_key_in_two_companies_is_independent():
    ta, ba = tenant("barberhouse")
    tb, bb = tenant("moderncut")
    k = key()
    a = await post(ta, ba, kind="advance", amount_minor=2000_00, currency="KZT", idempotency_key=k)
    b = await post(tb, bb, kind="advance", amount_minor=2000_00, currency="KZT", idempotency_key=k)
    assert a.created and b.created and a.entry.id != b.entry.id


# ---------------------------------------------------------------- corrections

async def test_reversal_not_delete_and_only_once():
    t, b = tenant("barberhouse")
    order_id = await make_order(t, b)
    pay = await post(t, b, kind="payment", amount_minor=3000_00, currency="KZT", idempotency_key=key(), order_id=order_id)
    async with app_session(t) as s:
        with pytest.raises(FinanceError, match="причина"):
            await ledger.reverse_entry(s, tenant_id=t, entry_id=pay.entry.id, idempotency_key=key(), reason=" ")
        k = key()
        rev = await ledger.reverse_entry(s, tenant_id=t, entry_id=pay.entry.id, idempotency_key=k, reason="ошибка кассира")
        assert rev.created and rev.entry.amount_minor == -3000_00 and rev.entry.reverses_entry_id == pay.entry.id
        assert (await ledger.reverse_entry(s, tenant_id=t, entry_id=pay.entry.id, idempotency_key=k,
                                           reason="ошибка кассира")).created is False
        with pytest.raises(FinanceError) as e:
            await ledger.reverse_entry(s, tenant_id=t, entry_id=pay.entry.id, idempotency_key=key(), reason="ещё раз")
        assert e.value.code == "ALREADY_REVERSED"
        await s.rollback()
        await set_ctx(s, t)
        rev2 = await ledger.reverse_entry(s, tenant_id=t, entry_id=pay.entry.id, idempotency_key=k, reason="ошибка кассира")
        with pytest.raises(FinanceError) as e:
            await ledger.reverse_entry(s, tenant_id=t, entry_id=rev2.entry.id, idempotency_key=key(), reason="x")
        assert e.value.code == "CANNOT_REVERSE_REVERSAL"
        await s.commit()
    # исходная запись на месте, журнал нельзя переписать
    assert admin("SELECT amount_minor FROM ledger_entries WHERE id = :i", i=pay.entry.id)[0][0] == 3000_00
    for sql in ("UPDATE ledger_entries SET amount_minor = 1 WHERE id = :i", "DELETE FROM ledger_entries WHERE id = :i"):
        with pytest.raises(DBAPIError, match="FINANCE_IMMUTABLE"):
            admin(sql, i=pay.entry.id)


async def test_entry_must_match_order_currency_branch_and_company():
    t, b = tenant("barberhouse")
    tb, bb = tenant("moderncut")
    order_id = await make_order(t, b)
    with pytest.raises(FinanceError) as e:
        await post(t, bb, kind="payment", amount_minor=100, currency="KZT", idempotency_key=key(), order_id=order_id)
    assert e.value.code == "BRANCH_MISMATCH"
    with pytest.raises(FinanceError) as e:
        await post(t, b, kind="payment", amount_minor=100, currency="USD", idempotency_key=key(), order_id=order_id)
    assert e.value.code == "CURRENCY_UNSUPPORTED"
    with pytest.raises(FinanceError) as e:   # заказ другой компании невидим под RLS
        await post(tb, bb, kind="payment", amount_minor=100, currency="KZT", idempotency_key=key(), order_id=order_id)
    assert e.value.code == "ORDER_NOT_FOUND"
    for bad in (0, -5, True, 1.5):
        with pytest.raises(FinanceError):
            await post(t, b, kind="payment", amount_minor=bad, currency="KZT", idempotency_key=key())
    with pytest.raises(FinanceError, match="причина"):
        await post(t, b, kind="adjustment", amount_minor=-100, currency="KZT", idempotency_key=key())


async def test_runtime_role_cannot_write_into_another_company():
    t, b = tenant("barberhouse")
    tb, bb = tenant("moderncut")
    async with app_session(t) as s:
        with pytest.raises(DBAPIError, match="row-level security"):
            await s.execute(text(
                "INSERT INTO ledger_entries (id, tenant_id, branch_id, kind, amount_minor, currency, idempotency_key) "
                "VALUES (gen_random_uuid(), :t, :b, 'advance', 100, 'KZT', :k)"), {"t": str(tb), "b": str(bb), "k": key()})
        await s.rollback()
    async with app_session(tb) as s:
        seen = (await s.execute(text("SELECT count(*) FROM ledger_entries WHERE tenant_id = :t"), {"t": str(t)})).scalar()
        assert seen == 0


# ---------------------------------------------------------------- demo numbers (M11/M12 preview)

async def test_order_position_rendered_received_debt():
    t, b = tenant("barberhouse")
    order_id = await make_order(t, b, price=8000_00)
    await post(t, b, kind="service_rendered", amount_minor=8000_00, currency="KZT", idempotency_key=key(), order_id=order_id)
    async with app_session(t) as s:
        p = await ledger.order_position(s, t, order_id)
    assert (p.sold_minor, p.rendered_minor, p.received_minor, p.debt_minor) == (8000_00, 8000_00, 0, 8000_00)

    pay = await post(t, b, kind="payment", amount_minor=3000_00, currency="KZT", idempotency_key=key(), order_id=order_id)
    async with app_session(t) as s:
        p = await ledger.order_position(s, t, order_id)
        assert (p.received_minor, p.debt_minor) == (3000_00, 5000_00)
        await ledger.reverse_entry(s, tenant_id=t, entry_id=pay.entry.id, idempotency_key=key(), reason="не та сумма")
        await s.commit()
        await set_ctx(s, t)
        p = await ledger.order_position(s, t, order_id)
    assert (p.received_minor, p.debt_minor) == (0, 8000_00)
