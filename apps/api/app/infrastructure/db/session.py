import uuid
from typing import AsyncGenerator
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import sessionmaker, Session
from apps.api.app.core.config import settings

import os
from sqlalchemy.pool import NullPool, AsyncAdaptedQueuePool

# Async Engine for FastAPI Request/Response Cycle and Tests (crm_app_user, strict RLS)
# Use NullPool to ensure connections are never tied to closed event loops across async tests
async_engine = create_async_engine(
    settings.ASYNC_DATABASE_URL,
    echo=False,
    poolclass=NullPool
)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

# Admin Sync Engine for Migrations, DDL, and Schema Initialization (postgres superuser)
admin_sync_engine = create_engine(
    settings.ADMIN_SYNC_DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True
)

AdminSyncSessionLocal = sessionmaker(
    bind=admin_sync_engine,
    autocommit=False,
    autoflush=False
)

# Runtime Sync Engine for non-admin tasks if needed
sync_engine = create_engine(
    settings.SYNC_DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=5,
    pool_pre_ping=True
)

SyncSessionLocal = sessionmaker(
    bind=sync_engine,
    autocommit=False,
    autoflush=False
)

def configure_engines():
    """Reconfigures database engines dynamically (e.g. for switching to isolated test database)."""
    global async_engine, AsyncSessionLocal, admin_sync_engine, AdminSyncSessionLocal, sync_engine, SyncSessionLocal
    async_engine = create_async_engine(settings.ASYNC_DATABASE_URL, echo=False, poolclass=NullPool)
    AsyncSessionLocal = async_sessionmaker(bind=async_engine, class_=AsyncSession, expire_on_commit=False, autocommit=False, autoflush=False)
    admin_sync_engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, echo=False, pool_size=5, max_overflow=5, pool_pre_ping=True)
    AdminSyncSessionLocal = sessionmaker(bind=admin_sync_engine, autocommit=False, autoflush=False)
    sync_engine = create_engine(settings.SYNC_DATABASE_URL, echo=False, pool_size=10, max_overflow=5, pool_pre_ping=True)
    SyncSessionLocal = sessionmaker(bind=sync_engine, autocommit=False, autoflush=False)

async def set_tenant_context(session: AsyncSession, tenant_id: uuid.UUID) -> None:
    """Sets transaction-scoped app.current_tenant in PostgreSQL."""
    await session.execute(
        text("SELECT set_config('app.current_tenant', :tenant_id, true)"),
        {"tenant_id": str(tenant_id)}
    )

def set_tenant_context_sync(session: Session, tenant_id: uuid.UUID) -> None:
    """Sync version for testing / migrations / tasks with transaction-local scope."""
    session.execute(
        text("SELECT set_config('app.current_tenant', :tenant_id, true)"),
        {"tenant_id": str(tenant_id)}
    )

async def clear_tenant_context(session: AsyncSession) -> None:
    """Explicitly resets transaction-scoped app.current_tenant."""
    await session.execute(text("SELECT set_config('app.current_tenant', '', true)"))

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency for database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
            try:
                await session.execute(text("RESET app.current_tenant"))
            except Exception:
                pass
            await session.close()
