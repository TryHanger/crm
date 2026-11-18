import time
import psycopg2
from apps.api.app.core.config import settings

def ensure_test_database(db_name: str = "saas_crm_test", clean: bool = False):
    if not db_name.endswith("_test") or db_name in ("saas_crm", "postgres", "production"):
        raise RuntimeError(f"FATAL: Refusing to create/drop database with unsafe name '{db_name}'! Must end with '_test'.")

    conn = psycopg2.connect(
        dbname="postgres",
        user=settings.ADMIN_DB_USER,
        password=settings.ADMIN_DB_PASSWORD,
        host=settings.DB_HOST,
        port=settings.DB_PORT
    )
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), current_user, inet_server_addr();")
            res_info = cur.fetchone()
            curr_db, curr_user, srv_addr = res_info[0], res_info[1], res_info[2]

            if clean:
                dropped = False
                for attempt in range(5):
                    cur.execute(
                        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid != pg_backend_pid();",
                        (db_name,)
                    )
                    time.sleep(0.2)
                    try:
                        cur.execute(f"DROP DATABASE IF EXISTS {db_name} WITH (FORCE);")
                    except Exception:
                        try:
                            cur.execute(f"DROP DATABASE IF EXISTS {db_name};")
                        except Exception:
                            pass
                    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
                    if not cur.fetchone():
                        dropped = True
                        break
                    time.sleep(0.3)

                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
                if not cur.fetchone():
                    cur.execute(f"CREATE DATABASE {db_name};")
                    print(f"Database {db_name} recreated fresh on {srv_addr} by {curr_user}!")
                else:
                    print(f"Database {db_name} already exists. Cleaning schema public...")
                    # Fallback clean schema public
                    conn_db = psycopg2.connect(
                        dbname=db_name,
                        user=settings.ADMIN_DB_USER,
                        password=settings.ADMIN_DB_PASSWORD,
                        host=settings.DB_HOST,
                        port=settings.DB_PORT
                    )
                    conn_db.autocommit = True
                    with conn_db.cursor() as cur_db:
                        cur_db.execute("DROP SCHEMA IF EXISTS public CASCADE;")
                        cur_db.execute("CREATE SCHEMA public;")
                        cur_db.execute("GRANT ALL ON SCHEMA public TO public;")
                    conn_db.close()
                    print(f"Schema public in {db_name} reset fresh!")
            else:
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
                if not cur.fetchone():
                    cur.execute(f"CREATE DATABASE {db_name};")
                    print(f"Database {db_name} created successfully!")
                else:
                    print(f"Database {db_name} already exists.")
    finally:
        conn.close()

if __name__ == "__main__":
    ensure_test_database()
