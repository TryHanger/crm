import pytest
import pytest_asyncio
import asyncio
from sqlalchemy.pool import NullPool
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from apps.api.app.core.config import settings
from apps.api.app.infrastructure.db.session import configure_engines
from apps.api.app.infrastructure.db.init_db import init_database, seed_database
from scripts.setup_test_db import ensure_test_database

@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    if settings.ENVIRONMENT == "production":
        raise RuntimeError("FATAL: Running pytest against PRODUCTION environment is strictly forbidden!")

    # Switch settings and all URLs to isolated test database
    settings.set_test_database_name("saas_crm_test")

    ensure_test_database(db_name="saas_crm_test", clean=True)
    configure_engines()

    # Active connection verification before initializing schema
    from sqlalchemy import create_engine, text
    with create_engine(settings.ADMIN_SYNC_DATABASE_URL).connect() as conn:
        res = conn.execute(text("SELECT current_database(), current_user, inet_server_addr();")).one()
        curr_db, curr_user, srv_addr = res[0], res[1], res[2]
        if not curr_db.endswith("_test") or curr_db in ("saas_crm", "postgres", "production"):
            raise RuntimeError(f"FATAL: Connected to unsafe database '{curr_db}'! Must end with '_test'. Aborting!")
        print(f"[TEST SETUP] Verified active connection: db={curr_db}, user={curr_user}, host={srv_addr}")

    init_database()
    seed_database()

@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncSession:
    # Use NullPool to avoid cross-loop connection sharing between tests on Windows
    test_engine = create_async_engine(settings.ASYNC_DATABASE_URL, echo=False, poolclass=NullPool)
    session_factory = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
        await session.rollback()
        await session.close()
    await test_engine.dispose()
