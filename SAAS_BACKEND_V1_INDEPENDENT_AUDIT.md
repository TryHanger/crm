# SaaS Platform Backend Delivery V1 — независимый аудит исходников

**Дата:** 2026-11-08  
**Аудируемый артефакт:** `SAAS_PLATFORM_BACKEND_DELIVERY_V1.zip` (44 архивных элемента, ~550 KB распакованного содержимого).  
**Рамки:** статическая инспекция исходников, миграции, конфигурации, API и автотестов; `python -m compileall` прошёл. Полный runtime E2E/11 PostgreSQL-тестов не воспроизведён: локально отсутствуют Docker/PostgreSQL и часть заявленных Python-зависимостей. `pytest --collect-only` остановился на `ModuleNotFoundError: asyncpg`. Отчёт автора `11 passed in 21.83s` не оспаривается, но *не считается независимо верифицированным*.

## Вердикт

**GO только на исправление и перепроверку. NO-GO на production и подключение реальных клиентов.** Код содержит существенную архитектурную основу: FastAPI, 46 ORM-моделей, публичные/business/platform маршруты, единый BookingEngine, 22 RLS-политики, GiST исключение занятости и 11 integration-тестов. Однако есть подтверждённые ошибки конфигурации, безопасности и корректности бронирований, которые тесты не покрыли.

## P0 — блокеры развёртывания и безопасности

1. **Не воспроизводится Docker build.** `Dockerfile:17` копирует `pyproject.toml` и `requirements.txt*`; оба отсутствуют в ZIP. `README.md` ошибочно обещает `pyproject.toml`.
2. **Несовместимая конфигурация контейнера и Python.** `docker-compose.yml` задаёт `DATABASE_URL`, `ADMIN_DATABASE_URL`, `JWT_SECRET_KEY`, `PLATFORM_ROOT_DOMAIN`; `apps/api/app/core/config.py` фактически использует `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD`, `ADMIN_DB_*`, `JWT_SECRET`, `PLATFORM_DOMAIN` и т. д. Внутри сети Compose Postgres должен быть `postgres:5432`, но код по умолчанию целится в `127.0.0.1:5433`. Критические переменные из Compose игнорируются.
3. **Роль PostgreSQL приложения нигде не создаётся.** `init_db.py:92-102` выдаёт права `crm_app_user`, *только если она уже существует*. В предоставленном окружении её создание отсутствует. Кроме того, `alembic/env.py` берёт runtime-подключение вместо административного для DDL.
4. **Серьёзный auth bypass в демо-аккаунтах.** `infrastructure/security/jwt.py:9-11` возвращает `True` при `password_hash='dev_secret_hash'` для **любого** пароля. `init_db.py` засеивает такие записи, `platform/routes.py:189-194` создаёт так новых владельцев. Тесты демонстративно логинятся с `password: "any"`. Нельзя публично развёртывать. Требуются настоящая система приглашений, установка паролей/OIDC, запрет seed-учётных записей за пределами отдельного тестового fixture, защита platform login.
5. **Создание публичного бронирования пропускает ключевые проверки.** `modules/bookings/service.py:create_booking (316-519)` рассчитывает длительность/цену и проверяет занятость exclusion constraint, но НЕ проверяет график, перерывы, отпуск, время в прошлом, min advance, booking horizon, active/online_bookable staff, актуальную публикацию и статус подписки. Клиент может напрямую вызвать `POST /public/bookings`, минуя `/availability/search`, и получить подтверждение вне расписания, если мастер в базе предлагает услугу и нет занятого интервала.
6. **Публичные записи возможны для suspended tenant.** `domain_resolution/resolver.py` отказывает только в `archived` и непубликованном сайте; `public/routes.py:create_public_booking` не проверяет приостановку; `BookingEngine.create_booking` тоже. `check_crm_write_permitted` ограничивает CRM, но не публичные записи. Тест подписки не выполняет `POST /public/bookings` после suspend.
7. **Перенос записи обходит политики.** `BookingEngine.reschedule_booking (593-684)` не проверяет статус записи, клиентский cutoff/разрешение переноса, рабочий график, услуги нового мастера, дату в прошлом, подписку, цену/длительность при смене мастера. Защищено лишь пересечение занятости.
8. **Нарушение scope для роли мастера.** `business/routes.py:get_calendar (163-168)` при отсутствии связанного `StaffProfile` не ограничивает выборку (могут вернуться все сотрудники и записи); `get_crm_booking_card`, `get_reports_overview`, `get_customers`, `crm_cancel_booking`, `create_calendar_block` и другие используют просто `get_crm_tenant_user`, без матрицы объектных разрешений по роли. Тест `test_roles_permissions.py` проверяет запрет создания филиала и входа в Platform Console, но НЕ проверяет прямое чтение чужой записи, отчёта и отмену чужой записи.
9. **Тесты могут изменять не-тестовую базу.** `apps/api/tests/conftest.py:11` session-autouse вызывает `init_database(); seed_database()` с обычными `Settings` без выделенной test-DB и разрушительной защиты; интеграционные тесты создают реальные сущности. Запуск `pytest` против DEV/PROD запрещён.
10. **Секреты и режимы перепутаны.** `docker-compose.yml` содержит открытые пароли и JWT-secret, принудительно ставит `ENVIRONMENT=production`, CORS=`["*"]`; реальные переменные секретов в `config.py` не считываются и имеют дефолтный слабый JWT секрет. Нужны отдельные профили local/test/prod и fail-fast для prod без секретов.

## P1 — корректность и полнота продукта

11. **Идемпотентность повторной записи ломает ссылку управления.** `BookingEngine.create_booking:343-362` при повторе возвращает строку `'IDEMPOTENT_REPLAY'` как `raw_token`; публичный endpoint строит из неё URL `/manage/IDEMPOTENT_REPLAY`. Сырой токен при этом хранится только в SHA256 и восстановить его нельзя. Нужно пересмотреть контракт replay, сохраняя безопасность и tenant/request scope; добавить тест полного ответа повторного POST.
12. **Состояние котировки не подтверждено сервером.** `/availability/search` отдаёт случайный `quote_id`, но не создаёт `booking_quotes` и `/bookings` не принимает/не проверяет quote_id; проверка drift сравнивает только цену, а не длительность/состав услуг/мастера. Требуется или честный stateless quote snapshot с подписанной версией, или persisted quote; не выводить фальшивый TTL.
13. **Временная зона жёстко зафиксирована.** `search_availability:215-230` вручную вычитает 5 часов для `Asia/Almaty`, `create_booking:415` фиксирует `timezone_snapshot='Asia/Almaty'` независимо от `Branch.timezone_iana`. День календаря строится по UTC в бизнес-API. Нужны IANA/zoneinfo, локальная дата филиала, поддержка переходов DST для иных стран, корректный end-of-day.
14. **RLS покрывает не все таблицы с tenant_id.** `TENANT_TABLES` имеет 22 таблицы, но ORM-модели содержат 36 таблиц с `tenant_id`: 14 без RLS (`tenant_domains`, `tenant_memberships`, `invites`, `subscriptions`, `tenant_entitlement_overrides`, `subscription_charges`, `payment_records`, `subscription_decisions`, `platform_support_tickets`, `support_access_requests`, `support_access_sessions`, `platform_alerts`, `outbox_events`, `idempotency_records`). Некоторые глобальные платформенные операции действительно требуют отдельного пути, но нужна документированная DB privilege/RLS-матрица, а не `GRANT ALL` на всю схему.
15. **Миграция не эквивалентна `init_db`.** `alembic/versions/001_initial_schema.py` создаёт таблицы и RLS/exclude, но не создаёт `lookup_public_management_token()` из `init_db.py:64-74`. Путь `alembic upgrade head` и путь `python -m ...init_db` дают неэквивалентное состояние БД. Отсутствует отдельный bootstrap DB role.
16. **Привязка домена потенциально доверяет клиентскому `X-Forwarded-Host`.** `resolver.py:24` принимает заголовок напрямую, не проверяя доверенный ingress/proxy. Требуется безопасная edge-очистка/канонизация host, проверка ограничений system/custom domain; тест подмены.
17. **Тарифные лимиты не применяются при изменениях.** В платформе есть PlanEntitlement `max_branches`/`max_active_staff`, но `POST /business/branches` и `/business/staff` не запрашивают effective entitlements; компания может добавить сверх лимита. Требуется атомарный enforcement и корректные ошибки лимита.
18. **Подписки, оплаты и разрешения на модули реализованы частично.** Фактически есть onboarding/suspend/reactivate/manual charge/payment и чтение overview; нет полного CRUD тарифов/версий, назначения исключений, controlled renew, домена и полноценного support flow. `record_payment` ставит `charge_status='paid'` без явного контроля равенства суммы начислению, частичных платежей или переплаты — нужно определить политику.
19. **Недостаточная проверка данных.** В схемах `service_ids` пустой допустим, времена не проверяются на timezone-aware, `from_date <= to_date`, `staff_mode` произвольная строка, email/телефон/продолжительность/цена не всегда валидируются; в `create_booking` customer создаётся с `marketing_consent=True` без согласия.
20. **Система уведомлений и роли поддержки частично скелет.** Сохраняются `outbox_events`, но в архиве нет полноценного delivery worker/retry/dead-letter; временный support access создаётся как состояние, но нет полной практики constrained acting-as, отмены и тестов предотвращения превышения scope.
21. **Расхождения документации.** `README.md` обещает multi-stage Dockerfile — он одноэтапный; `KNOWN_LIMITATIONS.md` называет таблицы `billing_charges`, `billing_payments`, `pos_transactions`, которых нет в реальной ORM-модели (используются `subscription_charges`, `payment_records`, POS отсутствует). Есть иные преувеличения готовности — синхронизировать docs с кодом.
22. **Нет всей API-поверхности, необходимой дизайну.** Не представлены достаточные endpoint-ы для CRUD рабочего расписания/перерывов/исключений, изменения услуг и профилей клиентов, управления тарифами/модулями/доменами/приглашениями и support tickets. Не нужно из-за этого добавлять универсальные модули ресторанов/стоматологии; нужно закрыть подтверждённый барбер-MVP.

## Что действительно стоит сохранить

- Трёхзонную модель API (`/api/v1/public`, `/business`, `/platform`) и единую модель tenant.
- PostgreSQL GiST exclusion для физической защиты пересечения занятости, при корректной проверке остальной доступности.
- Снимки цен/длительности `booking_items` при создании.
- Разделение `IdentityUser` и tenant-scoped `Customer`.
- Историю действий и outbox-паттерн (довести до worker).
- Модульный монолит и независимые frontend-границы; не начинать сейчас микросервисы/Kafka/Kubernetes.

## Последовательность исправлений

**Gate A — воспроизводимость**: корректный manifest зависимостей + lock, compose + локальный test PostgreSQL + bootstrap role, единый settings contract, чистая миграция Alembic, docs/runbook; сборка/запуск в пустом окружении.

**Gate B — P0 безопасность**: убрать обход пароля, безопасный onboarding/invites, реальный auth/role policy, жёсткий per-tenant/per-master scope, DB grants/RLS, safe proxy header, rate limits, default marketing consent false, isolated test DB.

**Gate C — Booking invariants**: единая authoritative validation для availability + create + reschedule + CRM create; проверка timezone, shift, breaks, time off, horizon, advance, publication, subscription, plan, price/duration, status, roles; сохранить exclusion constraint.

**Gate D — сквозные тесты**: 2 независимых tenants; 3 роли; прямые POST вне графика, при past slot, suspended, другой tenant/branch; race 20–50 запросов; replay idempotency; перенос на другого мастера; failed quote; payment amount; zero services; local day; mutations after suspend.

**Gate E — функциональные пробелы UI**: мастерские графики/выходные, редактирование услуг/клиентов, тарифы/модули/доступы/домены, support requests/owner approvals, интеграционные контракты для 3 frontend.

**Gate F — интеграция**: работающие три фронтенда на разных локальных hostname/портах, регистрация/приглашение, два барбершопа, создание/перенос/отмена и их отображение в CRM, приостановка/восстановление в Console, Playwright E2E, CI, миграции, бэкапы.

## Минимальный выпускной критерий

Новый чистый clone -> отдельные тестовые credentials -> `docker compose up --build` -> `alembic upgrade head` -> bootstrap только через явный dev seed -> 2 tenants -> 1 общий backend и 3 frontend -> end-to-end booking -> прошедшие tenant-isolation/security/concurrency тесты. Нет мок-паролей, production-secret defaults или случайных переходов между tenant. Только после этого разрешать production.

## GitHub

Репозиторий назначения (от пользователя): `https://github.com/TryHanger/crm.git`. Текущий ZIP не содержит `.git`; факт коммита/push и состояние удалённой ветки данным архивом не подтверждаются. Работать в ветке `fix/backend-v1-audit`, не переписывать main, не force-push, опубликовать SHA и ссылку на PR, тестовые логи и воспроизводимый ZIP. Разрешение пользователя на push уже дано ранее в переписке.
