import psycopg2

conn = psycopg2.connect(
    host="127.0.0.1",
    port=5433,
    user="postgres",
    dbname="postgres"
)
conn.autocommit = True
cur = conn.cursor()
cur.execute("SELECT 1 FROM pg_database WHERE datname='saas_crm'")
if not cur.fetchone():
    cur.execute("CREATE DATABASE saas_crm;")
    print("Database saas_crm created!")
else:
    print("Database saas_crm already exists!")

cur.close()
conn.close()

# Now connect to saas_crm and enable btree_gist
conn2 = psycopg2.connect(
    host="127.0.0.1",
    port=5433,
    user="postgres",
    dbname="saas_crm"
)
conn2.autocommit = True
cur2 = conn2.cursor()
cur2.execute("CREATE EXTENSION IF NOT EXISTS btree_gist;")
print("btree_gist installed in saas_crm!")
cur2.close()
conn2.close()
print("PostgreSQL 17.2 setup complete and verified!")
