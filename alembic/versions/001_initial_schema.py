"""initial_schema_and_rls

Revision ID: 001_initial
Revises: 
Create Date: 2026-11-08 15:00:00.000000

"""
import os
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from apps.api.app.infrastructure.db.models import Base
from apps.api.app.infrastructure.db.init_db import TENANT_TABLES

revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Enable btree_gist extension for PostgreSQL exclusion constraint
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist;")

    # 2. Ensure application runtime role exists with NOSUPERUSER and NOBYPASSRLS
    db_user = os.getenv("DB_USER", "crm_app_user")
    db_pwd = os.getenv("DB_PASSWORD", "crm_app_secret")
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{db_user}') THEN
                EXECUTE format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', '{db_user}', '{db_pwd}');
            END IF;
        END $$;
    """)
    
    # 3. Create all tables from metadata
    Base.metadata.create_all(bind=op.get_bind())
    
    # 4. Exclusion constraint on staff_occupancies
    op.execute("""
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
    """)

    # 5. Add lookup_public_management_token SECURITY DEFINER function for safe public token resolution across RLS
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

    # 6. Force RLS and tenant policy on all tenant tables
    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        op.execute(f"DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};")
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

    # 7. Grant least-privilege runtime access to crm_app_user (no DDL)
    op.execute("""
        GRANT USAGE ON SCHEMA public TO crm_app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app_user;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app_user;
        GRANT EXECUTE ON FUNCTION lookup_public_management_token(text) TO crm_app_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO crm_app_user;
    """)

def downgrade() -> None:
    for table in TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
    
    op.execute("ALTER TABLE staff_occupancies DROP CONSTRAINT IF EXISTS staff_occupancy_no_overlap;")
    Base.metadata.drop_all(bind=op.get_bind())
