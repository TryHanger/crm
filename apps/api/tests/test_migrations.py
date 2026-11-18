"""M01-D2-01: миграции воспроизводятся на чистой PostgreSQL и совпадают с моделями.

- test_head_schema_matches_models: база тестов собрана только через `alembic upgrade head`
  (conftest -> init_database). Если модель поменяли без новой ревизии, тест падает (R09).
- test_upgrade_downgrade_roundtrip: на отдельной чистой базе upgrade -> downgrade base -> upgrade
  проходит, после отката не остаётся таблиц, после повторного наката есть RLS и exclusion constraint.
"""
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.app.infrastructure.db.init_db import TENANT_TABLES, alembic_config
from apps.api.app.infrastructure.db.models import Base
from scripts.setup_test_db import ensure_test_database

ROUNDTRIP_DB = "saas_crm_migrations_test"


def _admin_url(db_name: str) -> str:
    base, _ = settings.ADMIN_SYNC_DATABASE_URL.rsplit("/", 1)
    return f"{base}/{db_name}"


def _schema_state(conn):
    tables = {r[0] for r in conn.execute(text(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
    ))}
    rls = {r[0]: (r[1], r[2]) for r in conn.execute(text(
        "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
        "WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'"
    ))}
    has_overlap_guard = conn.execute(text(
        "SELECT 1 FROM pg_constraint WHERE conname = 'staff_occupancy_no_overlap'"
    )).scalar() == 1
    return tables, rls, has_overlap_guard


def test_head_schema_matches_models():
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
            assert version is not None, "test database was not built by alembic"
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    finally:
        engine.dispose()
    assert diff == [], f"models differ from migration head, add a new revision: {diff}"


def test_upgrade_downgrade_roundtrip():
    ensure_test_database(db_name=ROUNDTRIP_DB, clean=True)
    url = _admin_url(ROUNDTRIP_DB)
    cfg = alembic_config(url)
    engine = create_engine(url, poolclass=NullPool)
    try:
        command.upgrade(cfg, "head")
        with engine.connect() as conn:
            tables, rls, guard = _schema_state(conn)
        assert set(Base.metadata.tables) == tables
        assert guard
        for table in TENANT_TABLES:
            assert rls[table] == (True, True), f"RLS is not forced on {table}"

        command.downgrade(cfg, "base")
        with engine.connect() as conn:
            tables, _, guard = _schema_state(conn)
            fn = conn.execute(text(
                "SELECT 1 FROM pg_proc WHERE proname = 'lookup_public_management_token'"
            )).scalar()
        assert tables == set()
        assert not guard
        assert fn is None

        command.upgrade(cfg, "head")
        with engine.connect() as conn:
            tables, rls, guard = _schema_state(conn)
            runtime = conn.execute(text(
                "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = :r"
            ), {"r": settings.DB_USER}).one()
        assert set(Base.metadata.tables) == tables
        assert guard
        assert all(rls[t] == (True, True) for t in TENANT_TABLES)
        assert tuple(runtime) == (False, False)
    finally:
        engine.dispose()
