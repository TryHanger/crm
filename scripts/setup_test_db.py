from apps.api.app.core.config import settings
from sqlalchemy import create_engine, text

def ensure_test_database(db_name: str = "saas_crm_test", clean: bool = False):
    if not db_name.endswith("_test") or db_name in ("saas_crm", "postgres", "production"):
        raise RuntimeError(f"FATAL: Refusing to create/drop database with unsafe name '{db_name}'! Must end with '_test'.")
    admin_base_url = f"postgresql://{settings.ADMIN_DB_USER}:{settings.ADMIN_DB_PASSWORD}@{settings.DB_HOST}:{settings.DB_PORT}/postgres"
    engine = create_engine(admin_base_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        res_info = conn.execute(text("SELECT current_database(), current_user, inet_server_addr();")).one()
        curr_db, curr_user, srv_addr = res_info[0], res_info[1], res_info[2]
        if clean:
            conn.execute(text(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{db_name}' AND pid <> pg_backend_pid();"))
            conn.execute(text(f"DROP DATABASE IF EXISTS {db_name};"))
            conn.execute(text(f"CREATE DATABASE {db_name};"))
            print(f"Database {db_name} recreated fresh on {srv_addr} by {curr_user}!")
        else:
            res = conn.execute(text(f"SELECT 1 FROM pg_database WHERE datname = '{db_name}'"))
            if not res.scalar():
                conn.execute(text(f"CREATE DATABASE {db_name};"))
                print(f"Database {db_name} created successfully!")
            else:
                print(f"Database {db_name} already exists.")

if __name__ == "__main__":
    ensure_test_database()
