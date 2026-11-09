# Архитектура развёртывания SaaS CRM (Pilot Readiness V1)

## 1. Архитектура изоляции 4-х рабочих пространств

Проект структурирован как монорепозиторий, разделяющий Backend API и три изолированных Frontend Single Page Applications (SPA):

```
crm/
├── apps/
│   ├── api/                   # Backend: FastAPI + SQLAlchemy 2.0 + PostgreSQL + Alembic
│   ├── booking-web/           # Клиентский портал онлайн-записи (B2C SPA)
│   ├── business-crm/          # Кабинет управления бизнесом/салоном (B2B SPA)
│   └── platform-console/      # Консоль оператора SaaS-платформы (Platform Admin SPA)
├── packages/
│   ├── api-client/            # Типизированный SDK API-клиентов
│   └── shared-types/          # Единые TypeScript-типы и контракты
└── docker-compose.staging.yml # Оркестрация staging-окружения
```

### Принципы изоляции:
1. **Frontend-приложения независимы**: Каждый SPA собирается независимо через собственный `vite.config.ts`, не имеет общих сессий с другими приложениями в браузере (разные origin/cookies/localStorage).
2. **Platform Console изолирована**: Доступ к консоли платформы защищён отдельной моделью прав (`PlatformRole`), собственным префиксом роутов `/api/v1/platform/*`, обязательной проверкой IP-allowlist и отсутствием смешения контекста с тенантами.
3. **Business CRM и Booking Web изолированы**: Бизнес-пользователи работают в `/api/v1/business/*`, клиенты — в `/api/v1/booking/*`. Клиентские запросы ограничены строгими публичными контрактами без доступа к внутренним финансовым и операционным сущностям.

---

## 2. Сетевая топология и маршрутизация доменов

В staging и production развёртывании перед сервисами устанавливается Reverse Proxy (Nginx / Ingress Controller), обеспечивающий SSL-терминацию (TLS 1.3), маршрутизацию доменов и проброс доверенных заголовков.

### Схема маршрутизации доменов:

| Хост / Шаблон домена | Целевой сервис | Назначение | Порт (Staging) |
|---|---|---|---|
| `console.<DOMAIN>` | `@crm/platform-console` | Панель управления операторов SaaS-платформы | 3002 (внутр. 80) |
| `app.<DOMAIN>` | `@crm/business-crm` | Рабочее место администратора и сотрудников бизнеса | 3001 (внутр. 80) |
| `<tenant>.book.<DOMAIN>` | `@crm/booking-web` | Публичный портал онлайн-записи клиента | 3000 (внутр. 80) |
| `/api/v1/*` (любой домен) | `apps/api` | REST API Backend | 8000 |

### Автоматическое определение тенанта для Booking Web:
- При обращении к `https://salon-aurora.book.example.com` заголовок `Host` содержит `salon-aurora.book.example.com`.
- Модуль разрешения тенанта `TenantDomainResolver` на стороне API анализирует поддомен относительно конфигурации `BOOKING_DOMAIN_SUFFIX=.book.example.com` и автоматически привязывает контекст к slug `salon-aurora`.
- Запрещён доступ к чужим или неактивным тенантам.

### Обязательные заголовки Reverse Proxy:
- `Host`: оригинальный хост запроса.
- `X-Forwarded-For`: IP-адрес клиента (используется для IP allowlist и rate limiting).
- `X-Forwarded-Proto`: протокол (`https`).
- `X-Request-ID`: сквозной трассировочный идентификатор запроса (генерируется прокси или middleware).

### CORS и безопасность изоляции:
- `test` / `development`: допустимы локальные порты (`localhost:3000`, `localhost:3001`, `localhost:3002`, `127.0.0.1`).
- `staging` / `production`: разрешены **только** зарегистрированные домены из `ALLOWED_ORIGINS`. Запрещены wildcards (`*`) при `ALLOW_CREDENTIALS=true`. При попытке запуска с небезопасным CORS сервис завершает работу аварийно (Fail-Fast).

---

## 3. Разделение прав доступа PostgreSQL и Multi-Tenant изоляция

База данных построена на принципе абсолютной изоляции данных компаний на уровне СУБД:

```
[Client / Staff Request]
         │
         ▼
[FastAPI Middleware / Dependency]
         │
         ▼ (SET LOCAL app.current_tenant = '...')
[PostgreSQL Connection Session]
         │
         ▼
[PostgreSQL Engine (RLS Policies Applied)]
 ├── tenant = A (Visible)
 └── tenant = B (Invisible / Rejected by RLS)
```

### Роли PostgreSQL:
1. **Пользователь миграций (`postgres` / `crm_migration_user`)**:
   - Используется исключительно во время шага применения миграций Alembic (`alembic upgrade head`).
   - Имеет права DDL на схему `public` (`CREATE TABLE`, `ALTER TABLE`, `CREATE POLICY`).
   - Не используется для runtime API запросов.
2. **Пользователь Runtime API (`crm_app_user`)**:
   - Используется сервисом FastAPI во время обычной работы.
   - **Не имеет** флага `SUPERUSER`.
   - **Не имеет** привилегии `BYPASSRLS`.
   - Имеет только права DML (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) на прикладные таблицы.
   - Не имеет права отключать RLS (`DISABLE ROW LEVEL SECURITY`).
3. **Строгая изоляция Row-Level Security (RLS)**:
   - Включена и принудительно активирована (`FORCE ROW LEVEL SECURITY`) на всех 22 мультиарендных таблицах.
   - Политика изоляции: `tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid`.
   - При отсутствии установленной сессионной переменной ни одна строка тенанта не возвращается и не модифицируется.

---

## 4. Безопасность секретов и Fail-Fast валидация окружения

В модуле `apps/api/app/core/config.py` реализована функция `validate_environment_security()`, которая проверяет параметры конфигурации при старте приложения:

| Проверяемый параметр | test | development | staging | production |
|---|---|---|---|---|
| Длина `JWT_SECRET_KEY` | $\ge 32$ символов | $\ge 32$ символов | $\ge 32$ символов | $\ge 32$ символов |
| Запрет дефолтного JWT ключа | Предупреждение | Предупреждение | **FAIL-FAST** | **FAIL-FAST** |
| Запрет дефолтных паролей БД | Разрешено | Разрешено | **FAIL-FAST** | **FAIL-FAST** |
| Запрет `ENABLE_DEMO_SEED=true` | Разрешено | Разрешено | **FAIL-FAST** | **FAIL-FAST** |
| Запрет wildcard CORS (`*`) | Разрешено | Разрешено | **FAIL-FAST** | **FAIL-FAST** |
| Скользящий Rate Limiting | Опционально | Опционально | **ВКЛЮЧЕН** | **ВКЛЮЧЕН** |

При нарушении хотя бы одного правила в окружениях `staging` или `production` процесс API немедленно завершает работу с исключением `RuntimeError` до открытия сетевого сокета.

---

## 5. Контейнеризация и оркестрация (Docker & Docker Compose)

### Dockerfile (Backend API):
- Базовый образ: `python:3.12-slim`.
- Сборка: multi-stage (виртуальное окружение собирается в builder, копируется в production образ).
- Безопасность: непривилегированный пользователь `appuser:appgroup` (UID 10001, non-root).
- Удаление кешей компиляции и временных файлов (`rm -rf /root/.cache/pip`).

### Dockerfile.frontend (3 Frontend SPAs):
- Multi-stage сборка: Node.js 20 Alpine builder -> Nginx 1.25 Alpine runtime.
- Сборка трёх артефактов (`apps/booking-web/dist`, `apps/business-crm/dist`, `apps/platform-console/dist`).
- Контейнеры запускаются под пользователем `nginx` (non-root).

### Оркестрация `docker-compose.staging.yml`:
- Сеть: изолированный docker bridge `crm-staging-network`.
- Порядок старта: Health checks на PostgreSQL перед запуском сервиса миграций и API.
- Персистентность: Docker volume `crm_staging_pgdata` для PostgreSQL.
