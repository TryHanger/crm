from apps.api.app.core.config import settings
from sqlalchemy import create_engine, text

def ensure_test_database(clean: bool = False):
    admin_base_url = f"postgresql://{settings.ADMIN_DB_USER}:{settings.ADMIN_DB_PASSWORD}@{settings.DB_HOST}:{settings.DB_PORT}/postgres"
    engine = create_engine(admin_base_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        if clean:
            conn.execute(text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'saas_crm_test' AND pid <> pg_backend_pid();"))
            conn.execute(text("DROP DATABASE IF EXISTS saas_crm_test;"))
            conn.execute(text("CREATE DATABASE saas_crm_test;"))
            print("Database saas_crm_test recreated fresh!")
        else:
            res = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = 'saas_crm_test'"))
            if not res.scalar():
                conn.execute(text("CREATE DATABASE saas_crm_test;"))
                print("Database saas_crm_test created successfully!")
            else:
                print("Database saas_crm_test already exists.")

if __name__ == "__main__":
    ensure_test_database()
