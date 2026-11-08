# SaaS CRM — независимый статический аудит ветки и техническое задание на интеграцию frontend

Дата: 2026-11-08. Репозиторий: https://github.com/TryHanger/crm
Ветка: `fix/backend-v1-audit`
HEAD: `5cc1b6ac34147c8fba2abba8eb89837d70c1d57d`
Основная поставка кода: `ace69e16f2cb88d5e3a9bb017adb9cae98cd7d66`

## Объём проверки и оговорки
Исходники, Git diff, дерево и отчёт о тестах прочитаны через подключённый GitHub. Последний коммит меняет только `scripts/package_submission.py` (6 строк добавлено, 3 удалено). В GitHub Actions для этой ветки найдено 0 прогонов, combined commit statuses пуст. Локально выполнить `git clone`, `pytest` и Docker не удалось: окружение не разрешает сетевые DNS-запросы к github.com. Поэтому никаких независимых runtime PASS не заявляется; `19 passed in 13.98s` — отчёт самого исполнителя.

### Что подтверждено кодом
- `apps/api/app/infrastructure/security/jwt.py`: удалён обход `dev_secret_hash`; есть проверка bcrypt.
- `apps/api/app/modules/bookings/service.py`: единая проверка смен, перерывов, отпусков, занятости при create/reschedule; ограничения GiST на занятость.
- `apps/api/app/api/v1/public/routes.py`: маршруты site/branches/services/staff/availability/bookings/manage.
- `apps/api/app/api/v1/business/routes.py`: календарь, записи и статусы, клиенты, команда, услуги, блокировки, обзор.
- `apps/api/app/api/v1/platform/routes.py`: tenants, lifecycle, charges/payments, audit и access requests.
- `готовый фронт.html` (~525 KB) — интерактивный дизайн-лист, а НЕ три production frontend приложения.

## Gate 0: блокеры перед публичной функциональностью записи (P0)
1. **Демонстрационные пользователи при каждом Compose-старте.** `docker-compose.yml`: API вызывает `python -m apps.api.app.infrastructure.db.init_db && alembic upgrade head`. `init_db.py` всегда вызывает `seed_database` с фиксированным демонстрационным паролем. Разделить создание схемы (только Alembic), начальную системную инициализацию и явно включаемый demo seed для локальной среды. Полный запрет demo seed в production/public DEV.
2. **Фиксированный пароль роли БД и избыточные привилегии.** `alembic/versions/001_initial_schema.py` и `init_db.py` создают `crm_app_user` с хардкодом и делают `GRANT ALL PRIVILEGES ON ALL TABLES`. Изменить provisioning роли на безопасную ENV/secret-driven процедуру. Runtime-роль не должна управлять схемой; минимальные SQL-права на нужные таблицы, функции и последовательности. Проверить подключение при изменённом `DB_PASSWORD` в Compose.
3. **Противоречие transaction-scoped RLS.** `infrastructure/db/session.py`: `set_config('app.current_tenant', :tenant_id, false)` задаёт session scope вместо требуемого transaction-local (`true`). Использовать `SET LOCAL`/`set_config(..., true)` и управлять транзакцией на жизненном цикле запроса; проверить отсутствие перетекания tenants при reuse соединения/пуле и при exceptions/commit/rollback.
4. **Тестовый DSN не гарантированно безопасен.** `tests/conftest.py` изменяет `settings.DB_NAME`, но `config.py` предпочитает `DATABASE_URL` и `ADMIN_DATABASE_URL`. Тестовые init/seed могут попасть не в `_test`, если заданы URL к другой БД. Перед Любым DROP/CREATE/seed проверить через активное подключение `SELECT current_database(), current_user, inet_server_addr()` и fail closed, запрет PROD и реальных имён. В test fixtures выставить *обе* test DSN явно, запретить удаление любой non-test базы.
5. **Host header trust.** `domain_resolution/resolver.py` безусловно предпочитает `X-Forwarded-Host`, а локальный bypass допускает `demo_slug` по строковому совпадению `localhost` в hostname. Принимать forwarded host только от доверенного edge/proxy; все недоверенные forwarded headers удалять на ingress. Demo slug — только в dev/test и не в public production; host validate IDNA/port/allowlist.
6. **Онбординг владельца.** `platform/routes.py` создаёт нового активного owner с неизвестным ему случайным паролем, не выдаёт рабочее приглашение. Спроектировать обязательное invite acceptance (hashed token, TTL, one-time, scope), установку пароля, email verification (для отсутствующей почтовой интеграции — безопасный dev link только в DEV) и статус `invited` до активации. Никакого silently-active владельца без возможности логина.

## Gate 1: корректность бронирования и контракты (P1, до оформления реальной записи)
7. **Quote ID не настоящий.** `BookingEngine.search_availability` генерирует `uuid.uuid4()` для каждого слота, но в create endpoint `quote_id` не принимается; `expected_price_minor` необязателен и можно не передавать. Реализовать подтверждаемый серверный quote с TTL, привязкой к tenant, branch, staff, service_ids, start, price, duration, версии прайса; при mismatch 409 с новыми условиями. Не принимать бронь по устаревшей цене/длительности.
8. **Идемпотентность.** Повторный `Idempotency-Key` сейчас не проверяет `request_hash` против нового payload, а выдаёт новый management token. Требование: ключ уникален в scope tenant + actor/context + operation, равный payload возвращает стабильный результат, иной payload — 409 `IDEMPOTENCY_KEY_REUSED`. Хеш запроса включает весь существенный payload; ограничить TTL и хранение токенов без риска повторной выдачи.
9. **Time-first.** В `AvailabilitySearchRequest` всегда `service_ids`, но `search_availability` с пустым списком создаёт слоты с длительностью 0 и ценой 0. Запретить такие "подтверждённые" слоты. Поддержать time-first как предпочтение времени (не проверенная бронь); после выбора услуг и мастера пересчитать доступность и стоимость. Услуги и duration всегда необходимы для финального бронирования.
10. **Авторизация мастера на создание записи.** `business/routes.py crm_create_booking` использует только `get_crm_tenant_user` и позволяет роли master указать чужой staff_id. Утвердить policy: мастер создаёт записи только себе или создание полностью запрещено ему. Добавить негативный тест.
11. **Дата и часовой пояс.** `search_availability` / CRM calendar берут границы `date` в UTC, а день в UI относится к timezone филиала. Строить UTC-диапазон из местного дня филиала, покрыть +05:00, пересечение полуночи и DST в других регионах.
12. **API документация не совпадает с кодом.** В `COVERAGE_MATRIX.md` указан `POST /api/v1/public/availability`, фактически маршрут `POST /api/v1/public/availability/search`. Матрица заявляет `GET/POST /api/v1/platform/plans` полностью реализованным, но маршрутов в platform/routes.py нет; заявляет полноценное управление сменами при наличии только staff CRUD. Автоматически сверить реальный OpenAPI и матрицу: Implemented/Partial/Missing.

## Gate 2: frontend — по одному сквозному сценарию
**Ветка:** `feat/booking-frontend-integration`, от зафиксированного SHA `fix/backend-v1-audit` после Gate 0. Никакого изменения main и force-push.

### Архитектура frontend
- Три независимых проекта: `apps/booking-web`, `apps/business-crm`, `apps/platform-console`; общий `packages/api-client` со сгенерированными типами из актуального OpenAPI.
- `готовый фронт.html` сохранить неизменным как дизайн-эталон в `design/reference/` (или существующем корне), не выдавать HTML-сценарный холст за готовый SPA.
- Сохранить визуальный язык и desktop/mobile состояния. На первом шаге реализовать рабочие страницы только Booking Web, затем минимальную календарную вертикаль Business CRM.
- Маршрутизация: `barberhouse.<base-domain>` и `moderncut.<base-domain>` используют одну сборку booking-web, но серверно резолвятся на разные tenants. Без каталога компаний и выбора всех компаний.
- **Same-origin public API:** браузер вызывает `https://barberhouse.<base-domain>/api/v1/public/*`; доверенный reverse proxy передаёт валидированный исходный hostname в API. Никакого выставления `X-Forwarded-Host`/tenant_id из JS клиента; не направлять frontend напрямую в `api.<base-domain>` с Host=api.
- Для разработки предусмотреть локальные hostname / прокси и 2 тестовые компании; custom domains — позже.

### Первые рабочие эндпоинты
- `GET /api/v1/public/site`, `GET /api/v1/public/branches`, `GET /api/v1/public/services`, `GET /api/v1/public/staff`, `GET /api/v1/public/staff/{id}/services`.
- `POST /api/v1/public/availability/search` (пока read-only, до Gate 1), затем `POST /api/v1/public/bookings`, `GET/POST /api/v1/public/manage/{token}` с проверкой фактического маршрута в OpenAPI.
- CRM после P0/Gate 1: `/api/v1/auth/login`, `/api/v1/auth/me`, `GET /api/v1/business/calendar`, `GET /api/v1/business/bookings/{id}` с auth и подтверждённым `X-Tenant-ID`.

### UX и поведение
- Три входа: service-first, master-first, time-first. Время при time-first считается предпочтением до проверки полного набора услуг/мастера.
- Индивидуальные цены и длительности мастеров, мультисервисная запись, вариант `any master`, филиалы.
- Реальная загрузка / empty / 404 неизвестный домен / 403 suspended / 409 slot conflict / 409 quote changed / 401 session expiry / network retry / success. Не показывать цену или подтверждение без серверного подтверждения.
- Phone +7, автоподтверждение (без ручного approve), реальные даты и часовой пояс, доступность и стоимость из API.

### Приёмка
1. В чистом клоне Docker build + `alembic upgrade head` + readiness; демонстрационные пользователи только явным seed на DEV.
2. `pytest` независимо в *фактически проверенной* тестовой БД, no coverage claims without logs; GitHub Actions с PostgreSQL.
3. Два tenants с разными филиалами и услугами; Host routing; никаких утечек.
4. Клиент из Barber House создаёт запись; она появляется в CRM Barber House и не появляется в Modern Cut.
5. Два клиента одновременно бронируют одно время: 1 успех, 1 409, без двойных записей.
6. Отмена/перенос из публичного управления и из CRM, цены и права, блокировка suspended.
7. Desktop + mobile Playwright E2E со скриншотами и сравнением макетов.
8. Коммит/Push feature-ветки и отчёт: точный SHA, test logs, API coverage matrix, screenshots, docker logs, known limitations. Ни одного изменения prod, основного main или удаления дизайн-оригинала.

### Готовность
- **GO** на проектирование API-client, UI из дизайн-эталона и read-only интеграцию под локальным dev.
- **NO-GO** на открытие публичной записи для настоящих клиентов, production, главную ветку и утверждение `production-ready` до Gate 0 и независимых тестов Gate 1.
