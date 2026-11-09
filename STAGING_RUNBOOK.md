# Регламент развёртывания STAGING-окружения (STAGING RUNBOOK)

Данный документ устанавливает точный порядок холодного и эксплуатационного развёртывания SaaS CRM в предпроизводственном (Staging) окружении.

---

## 1. Требования к целевому окружению

Перед запуском на целевом хосте должны быть установлены:
- **Docker Engine** 24.0+
- **Docker Compose** v2.20+
- Сетевой доступ к портам `80` (HTTP для ACME / HTTPS-redirect) и `443` (HTTPS / TLS reverse proxy).
- Внутренние сервисы (`api`, `postgres`, `frontend`) изолированы во внутренней docker-сети и не публикуют порты `8000`, `3000`, `3001`, `3002` наружу.
- Настроенные DNS A-записи или записи `/etc/hosts` (для локального тестирования):
  ```text
  127.0.0.1 console.staging.crm.internal
  127.0.0.1 app.staging.crm.internal
  127.0.0.1 barberhouse.book.staging.crm.internal
  127.0.0.1 moderncut.book.staging.crm.internal
  ```

---

## 2. Конфигурация переменных окружения (`.env.staging`)

Скопируйте эталонный шаблон переменных:
```bash
cp .env.staging.example .env.staging
```

Заполните обязательные параметры безопасности (все пароли $\ge 16$ символов, JWT $\ge 32$ символов):
```ini
ENVIRONMENT=staging
DEBUG=false
ENABLE_DEMO_SEED=false

# PostgreSQL credentials
POSTGRES_DB=saas_crm_staging
POSTGRES_USER=postgres
POSTGRES_PASSWORD=strong_staging_admin_secret_never_use_default_123!
DB_USER=crm_app_user
DB_PASSWORD=strong_staging_runtime_secret_never_use_default_123!

# JWT Secret (>= 32 chars cryptographically random)
JWT_SECRET_KEY=cryptographic_random_jwt_secret_key_minimum_32_characters_long!

# Initial Platform Owner Bootstrap
INITIAL_PLATFORM_OWNER_EMAIL=admin@staging.crm.internal
INITIAL_PLATFORM_OWNER_PASSWORD=strong_platform_owner_bootstrap_password_123!
INITIAL_PLATFORM_OWNER_NAME="Platform Administrator"

# Platform IP Allowlist (Mandatory in Staging/Production: CIDR networks and IP literals)
PLATFORM_IP_ALLOWLIST=127.0.0.1,::1,10.0.0.0/8,192.168.1.0/24

# Domains configuration
BOOKING_DOMAIN_SUFFIX=.book.staging.crm.internal
CRM_DOMAIN=app.staging.crm.internal
PLATFORM_DOMAIN=console.staging.crm.internal

# SMTP Relay (если не настроен, используется transparent manual delivery)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@staging.crm.internal
```

> [!CAUTION]
> Приложение использует **Fail-Fast** валидацию. Запуск staging/production блокируется с фатальной ошибкой при:
> - Наличии известных слабых паролей (`postgrespassword`, `crm_app_secret`, `staging_admin_secret_9921`, `staging_app_secret_4412`, `password` и т.д.);
> - Длине паролей $< 16$ знаков или JWT $< 32$ знаков;
> - Пустом `PLATFORM_IP_ALLOWLIST`;
> - Включённом `ENABLE_DEMO_SEED=true`.

---

## 3. Генерация TLS-сертификатов (Staging / Private Pilot)

Для защищённого HTTPS-соединения сгенерируйте локальные / тестовые SSL-сертификаты с расширенными SAN:
```bash
python scripts/generate_staging_certs.py
```
Сертификаты сохраняются в `nginx/certs/fullchain.pem` и `nginx/certs/privkey.pem`.  
Для боевого Production сертификаты монтируются из внешнего Let's Encrypt / Certbot каталога.

---

## 4. Сборка и пошаговый запуск Docker-стека

Все команды оркестрации выполняются строго с явным указанием `--env-file .env.staging`:

### Шаг 4.1: Валидация конфигурации Compose
```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml config
```

### Шаг 4.2: Сборка образов
```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml build
```

### Шаг 4.3: Запуск сервисов
```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d
```

### Шаг 4.4: Проверка статуса контейнеров
```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
```

Согласованные имена контейнеров и сервисов:
| Сервис Compose | Имя контейнера | Статус | Роль |
|---|---|---|---|
| `postgres` | `saas_crm_staging_pg` | `Up (healthy)` | СУБД PostgreSQL 17 |
| `migration-runner` | `saas_crm_staging_migrations` | `Exited (0)` | Одноразовый запуск миграций и bootstrap владельца |
| `api` | `saas_crm_staging_api` | `Up (healthy)` | FastAPI backend под непривилегированным runtime `crm_app_user` |
| `frontend` | `saas_crm_staging_frontend` | `Up` | Синхронизация статики 3 frontend приложений |
| `proxy` | `saas_crm_staging_proxy` | `Up` | Nginx reverse proxy (TLS 443, HTTP 80 redirect, anti-spoofing) |

---

## 5. Проверка готовности (Health & Readiness Probes)

1. **Proxy HTTP $\to$ HTTPS Redirect**:
   ```bash
   curl -I http://localhost/healthz
   # HTTP/1.1 200 OK -> healthy

   curl -I http://app.staging.crm.internal/
   # HTTP/1.1 301 Moved Permanently -> Location: https://app.staging.crm.internal/
   ```

2. **Backend API Health Check (внутри сети)**:
   ```bash
   docker compose --env-file .env.staging -f docker-compose.staging.yml exec api curl -s http://localhost:8000/health/live
   # {"status":"live"}

   docker compose --env-file .env.staging -f docker-compose.staging.yml exec api curl -s http://localhost:8000/health/ready
   # {"status":"ready","database":"healthy"}
   ```

3. **HTTPS Reverse Proxy SPAs (по доменам)**:
   ```bash
   # Platform Console
   curl -k -i -H "Host: console.staging.crm.internal" https://localhost/
   # HTTP/2 200 OK -> HTML-страница Platform Console

   # Business CRM
   curl -k -i -H "Host: app.staging.crm.internal" https://localhost/
   # HTTP/2 200 OK -> HTML-страница Business CRM

   # Booking Web (дикий поддомен арендатора)
   curl -k -i -H "Host: barberhouse.book.staging.crm.internal" https://localhost/
   # HTTP/2 200 OK -> HTML-страница Booking Web
   ```

4. **Защита от неразрешённых доменов (Default Fallback)**:
   ```bash
   curl -k -i -H "Host: unknown-hacker.com" https://localhost/
   # HTTP/2 404 Not Found -> "Domain not mapped to SaaS CRM platform"
   ```

---

## 6. Smoke-тестирование закрытого пилота

1. **Вход первого владельца платформы**:
   - Откройте `https://console.staging.crm.internal` с авторизованного IP (из `PLATFORM_IP_ALLOWLIST`).
   - Авторизуйтесь с `INITIAL_PLATFORM_OWNER_EMAIL` и `INITIAL_PLATFORM_OWNER_PASSWORD`.
2. **Онбординг первой компании (Zero Demo)**:
   - В разделе «Компании» запустите мастер добавления клиента.
   - Сформируйте одноразовую ссылку приглашения для первого партнёрского салона.
3. **Активация и настройка салона**:
   - Владелец салона переходит по ссылке `https://app.staging.crm.internal/accept-invite?token=...`, задаёт пароль.
   - Настраивает филиал, сотрудника, услугу и публикует онлайн-запись.
4. **Бронирование через защищённый Booking Web**:
   - Клиент переходит на `https://<slug>.book.staging.crm.internal`, выбирает услугу, время и оставляет контакты.
   - Запись моментально отображается в календаре Business CRM.

---

## 7. Журналирование и диагностика

```bash
# Просмотр логов всех сервисов
docker compose --env-file .env.staging -f docker-compose.staging.yml logs -f --tail=100

# Логи API с отслеживанием Request ID
docker compose --env-file .env.staging -f docker-compose.staging.yml logs -f api

# Логи Reverse Proxy
docker compose --env-file .env.staging -f docker-compose.staging.yml logs -f proxy
```

### Важные архитектурные гарантии Staging:
1. **API без администраторских привилегий (`PROCESS_ROLE=api`)**: Контейнер `api` не имеет доступа к `ADMIN_DB_PASSWORD` и подключается исключительно через роль `crm_app_user`.
2. **Строго суженное доверие к Nginx Proxy**: `TRUSTED_PROXIES` сужено до точного адреса Nginx `172.28.0.10` (а также `127.0.0.1`, `::1`, `proxy`, `nginx`). Широкая подсеть моста удалена для защиты от спуфинга заголовков из других контейнеров.
3. **Единый контракт управления онлайн-записью**: Переключение статуса публикации (`PATCH /api/v1/business/booking-publication` с `is_published: false`) немедленно отключает публичную запись, возвращая HTTP 404 `SITE_NOT_PUBLISHED`.
