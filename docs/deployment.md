# Deployment, Configuration & Operations Runbook

## 1. Local & Production Infrastructure Topology
The backend runs in containerized environments using Docker and Docker Compose:
- **`postgres`**: PostgreSQL 17 with `btree_gist` extension and two dedicated database roles:
  - `postgres` (Superuser): For schema migrations (Alembic), DDL, and extensions.
  - `crm_app_user` (Application Runtime): `NOSUPERUSER`, `NOBYPASSRLS`. All API queries and connection pools operate strictly under this role.
- **`api`**: FastAPI application running on Uvicorn with asyncpg connection pooling.

---

## 2. Environment Variables Configuration (`.env`)
| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | Runtime async connection string | `postgresql+asyncpg://crm_app_user:crm_app_secret@postgres:5432/saas_crm` |
| `ADMIN_DATABASE_URL` | Administrative sync connection string | `postgresql://postgres:postgres@postgres:5432/saas_crm` |
| `JWT_SECRET_KEY` | HMAC-SHA256 signature secret | High-entropy random hex string |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | Access token TTL | `1440` (24 hours) |
| `CORS_ORIGINS` | Permitted browser origins | `["http://localhost:3000","https://crm.platform.example.kz"]` |
| `PLATFORM_ROOT_DOMAIN` | Base platform domain | `platform.example.kz` |
| `ENVIRONMENT` | Deployment environment | `production` / `staging` / `development` |

---

## 3. Database Initialization & Alembic Migrations

### 3.1 First Time Setup
```bash
# 1. Start database container
docker compose up -d postgres

# 2. Run initial database setup (creates btree_gist, crm_app_user, RLS policies & seed data)
python -m apps.api.app.infrastructure.db.init_db

# 3. Stamp Alembic head migration
alembic stamp head
```

### 3.2 Running Alembic Migrations
```bash
# Check migration status
alembic current

# Apply pending revisions
alembic upgrade head
```

---

## 4. Health Checks & Observability
- **Liveness Probe**: `GET /health/live`
  - Returns `{"status": "ok"}` when application process is responsive.
- **Readiness Probe**: `GET /health/ready`
  - Executes active ping against PostgreSQL database.
  - Returns `200 OK` when database responds, `503 Service Unavailable` if database is unreachable.
- **Request Tracing**: Every HTTP response includes `X-Request-ID` header for distributed tracing across logs.

---

## 5. Backup & Disaster Recovery Procedures

### 5.1 Logical Backup (`pg_dump`)
```bash
docker exec -t postgres pg_dump -U postgres -d saas_crm -F c -b -v -f /tmp/saas_crm_backup.dump
```

### 5.2 Restore Procedure
```bash
docker exec -i postgres pg_restore -U postgres -d saas_crm --clean --if-exists -v /tmp/saas_crm_backup.dump
```
