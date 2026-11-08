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

    # Switch to isolated test database
    settings.DB_NAME = "saas_crm_test"
    settings.ENVIRONMENT = "test"
    if not settings.DB_NAME.endswith("_test"):
        raise RuntimeError("FATAL: Test database name must end with '_test'!")

    ensure_test_database(clean=True)
    configure_engines()
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
