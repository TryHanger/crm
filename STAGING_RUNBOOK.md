# Инструкция по развёртыванию STAGING-окружения (STAGING RUNBOOK)

Данный документ регламентирует порядок холодного и инкрементального развёртывания SaaS CRM в предпроизводственном (Staging) окружении.

---

## 1. Требования к окружению

Перед началом развёртывания на целевом сервере должны быть установлены:
- **Docker Engine** 24.0+
- **Docker Compose** v2.20+
- Сетевой доступ к портам `80`, `443` (для Nginx / Ingress), `8000` (API), `3000` (Booking Web), `3001` (Business CRM), `3002` (Platform Console).
- Настроенные DNS A-записи или локальный `/etc/hosts` для доменов:
  - `console.staging.crm.local`
  - `app.staging.crm.local`
  - `*.book.staging.crm.local` (wildcard запись)

---

## 2. Конфигурация переменных окружения (`.env.staging`)

Скопируйте шаблон переменных окружения:
```bash
cp .env.staging.example .env.staging
```

Убедитесь, что заполнены обязательные параметры безопасности:
```ini
ENVIRONMENT=staging
DEBUG=false
BOOKING_DOMAIN_SUFFIX=.book.staging.crm.local
CRM_DOMAIN=app.staging.crm.local
PLATFORM_DOMAIN=console.staging.crm.local

# Безопасные криптографические ключи (длина >= 32 байт)
JWT_SECRET_KEY=generate-at-least-32-chars-cryptographic-random-secret-key!

# PostgreSQL production/staging credentials
POSTGRES_DB=saas_crm_staging
POSTGRES_USER=postgres
POSTGRES_PASSWORD=strong_staging_db_password_never_use_default!
APP_DB_USER=crm_app_user
APP_DB_PASSWORD=strong_runtime_user_password!
DB_HOST=crm-staging-db
DB_PORT=5432

# SMTP Relay (при отсутствии используется transparent manual dispatch)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=real_sendgrid_secret_key
SMTP_FROM_EMAIL=noreply@staging.crm.local

# IP Allowlist для Platform Console (через запятую)
PLATFORM_ALLOWED_IPS=127.0.0.1,10.0.0.0/8,192.168.1.0/24
```

> [!CAUTION]
> Приложение использует **Fail-Fast** валидацию. Если в `.env.staging` указан стандартный дефолтный пароль или слабый `JWT_SECRET_KEY`, сервис API аварийно завершит запуск с кодом ошибки 1.

---

## 3. Пошаговое развёртывание из чистого состояния

### Шаг 3.1: Сборка и запуск контейнеров
Запустите оркестрацию сервисов с пересборкой образов:
```bash
docker compose -f docker-compose.staging.yml build --no-cache
docker compose -f docker-compose.staging.yml up -d
```

### Шаг 3.2: Проверка статуса контейнеров
Убедитесь, что все контейнеры запущены и находятся в статусе `Up (healthy)`:
```bash
docker compose -f docker-compose.staging.yml ps
```

Ожидаемый вывод:
- `crm-staging-db`: `Up (healthy)`
- `crm-staging-api`: `Up (healthy)`
- `crm-staging-booking`: `Up`
- `crm-staging-crm`: `Up`
- `crm-staging-platform`: `Up`

### Шаг 3.3: Применение миграций схемы БД
Миграции запускаются автоматически при старте контейнера API, либо могут быть вызваны вручную:
```bash
docker compose -f docker-compose.staging.yml exec crm-staging-api alembic upgrade head
```

---

## 4. Проверка готовности (Health & Readiness Probes)

Выполните HTTP-запросы для проверки доступности компонентов:

1. **Backend API Health Check**:
   ```bash
   curl -i http://localhost:8000/api/v1/health
   # HTTP/1.1 200 OK -> {"status":"ok","environment":"staging","database":"healthy"}
   ```

2. **Booking Web SPA**:
   ```bash
   curl -i -H "Host: pilot123.book.staging.crm.local" http://localhost:3000/
   # HTTP/1.1 200 OK -> HTML-страница приложения
   ```

3. **Business CRM SPA**:
   ```bash
   curl -i -H "Host: app.staging.crm.local" http://localhost:3001/
   # HTTP/1.1 200 OK -> HTML-страница входа в CRM
   ```

4. **Platform Console SPA**:
   ```bash
   curl -i -H "Host: console.staging.crm.local" http://localhost:3002/
   # HTTP/1.1 200 OK -> HTML-страница Platform Console
   ```

---

## 5. Smoke-тестирование базового сценария (Pilot Smoke Test)

1. **Создание арендатора**:
   - Войдите в `http://console.staging.crm.local:3002` под оператором платформы.
   - Запустите мастер онбординга новой компании и сгенерируйте одноразовую ссылку приглашения.
2. **Активация владельца**:
   - Откройте сгенерированную ссылку в чистом окне (`/accept-invite?token=...`).
   - Задайте надёжный пароль владельца и подтвердите активацию.
3. **Настройка филиала и услуг**:
   - Авторизуйтесь в `http://app.staging.crm.local:3001`.
   - Создайте мастера и услугу, включите онлайн-запись.
4. **Оформление онлайн-бронирования**:
   - Перейдите по адресу `http://<tenant>.book.staging.crm.local:3000`.
   - Выберите мастера, время и оформите тестовую бронь.
5. **Синхронизация в CRM**:
   - Откройте журнал записей в Business CRM и убедитесь в отображении созданной брони со статусом «Подтверждено».

---

## 6. Устранение неполадок (Troubleshooting)

### Просмотр журналов:
```bash
# Все сервисы в реальном времени
docker compose -f docker-compose.staging.yml logs -f --tail=100

# Логи API с отслеживанием Request ID
docker compose -f docker-compose.staging.yml logs -f crm-staging-api
```

### Частые проблемы и решения:
- **`502 Bad Gateway` на Reverse Proxy**:
  - Проверьте, запущен ли API контейнер: `docker compose -f docker-compose.staging.yml logs crm-staging-api`.
  - Убедитесь, что база данных прошла healthcheck и доступна для подключений.
- **`429 Too Many Requests`**:
  - Сработал скользящий rate limiter (ограничение запросов в staging/production). Подождите время, указанное в заголовке `Retry-After`.
- **`403 Forbidden` в Platform Console**:
  - IP-адрес запроса отсутствует в переменной `PLATFORM_ALLOWED_IPS`. Добавьте свой текущий IP-адрес в `.env.staging` и перезапустите API:
    `docker compose -f docker-compose.staging.yml restart crm-staging-api`.

### Откат (Rollback):
При необходимости отката на предыдущую стабильную версию:
```bash
git checkout <PREVIOUS_STABLE_SHA>
docker compose -f docker-compose.staging.yml up -d --build
```
В случае повреждения данных БД выполните аварийное восстановление по регламенту [RESTORE_RUNBOOK.md](RESTORE_RUNBOOK.md).
