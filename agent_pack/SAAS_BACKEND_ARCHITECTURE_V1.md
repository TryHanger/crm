# SaaS Booking & CRM — backend architecture and implementation contract v1.0

**Дата спецификации:** 2026-11-08  
**Основа продукта:** передаваемый заказчиком HTML-прототип `платформа саас.html`, объединяющий сценарии клиентской онлайн-записи, CRM бизнеса и Platform Console.  
**Статус:** техническое ТЗ и рекомендуемые решения для реализации; не описание уже существующего backend.  
**Область MVP:** барбершопы / парикмахерские по записи. Никакого маркетплейса компаний. Стоматология, рестораны, аренда, полноценные платежи, склад и маркетинг — НЕ MVP.

> Инструкция исполнителю: прочитай HTML полностью, извлеки и опиши экраны, сценарии и поля. Дизайн-лист — интерактивный прототип/холст, НЕ доказательство наличия готовых React SPA, API или бизнес-логики. Создать реальный backend; не выдавать статическую демонстрацию за работающий продукт. Не переписывать и не портить оригинальный HTML без прямой необходимости. Если интеграция требует преобразования макета в рабочие SPA, отделить её в явный следующий этап и предоставить API-контракты/пример интеграции. Не делать удалённых деплоев и git push без разрешения.

---

## 0. Исследование: откуда взяты архитектурные паттерны

Рассматривались реальные публичные API/репозитории и продуктовые возможности. **Не заявлять**, что знаем закрытую внутреннюю инфраструктуру Fresha, Booksy, Square, SimplyBook или Altegio: подтверждены только публичные API, продуктовые модели и официально открытый код.

| Система / источник | Что подтверждается публично | Что берём | Что не копируем |
|---|---|---|---|
| **Cal.com** — открытая кодовая база и инженерная статья | Feature-oriented / vertical-slice организация по доменам (bookings, availability, scheduling), версии API, модули | Разделение `availability`, `booking`, `scheduling`, `identity`, тонкие контроллеры, версионирование | Полный набор интеграций, большую инфраструктуру, лицензируемые куски кода |
| **Easy!Appointments** — GPL-3.0, открытый OpenAPI | Сущности providers, services, working plans, appointments, customers, blocked/unavailable intervals, REST | Явную модель услуг, работников, исключений расписания, API | Исходный код под GPL в наш коммерческий продукт без лицензионного анализа |
| **Square Bookings API** | Bookings, availability search, locations, team, catalog, customers; разные buyer/seller permissions | Отдельный `availability search`, чёткие права публичного и бизнес-API, атомарное создание | Square платёжный и marketplace-контур |
| **Altegio** — публичная API-документация | Разделённые API поверхностей public booking / business management; chains, locations, users, roles, team, resources | Компании, филиалы, роли, публичное API записи, tenant-scoping | ERP/POS/склад/лояльность в MVP |
| **SimplyBook.me** — публичные материалы | Брендированные страницы, виджеты, календари и модульность | Поддомены, будущие пользовательские домены, минимальная настройка вида | Платные пакеты, платежи, 60+ features |
| **Booksy / Fresha** — официальные продуктовые страницы | Доступность, рабочие часы, несколько услуг, команда, клиенты, no-show, многоточечность | Простые сценарии barbershop CRM и отдельную booking-page | Маркетплейс, POS, маркетинг, сложную розницу |
| **AWS SaaS PostgreSQL guidance** | Silo/Bridge/Pool, Row-Level Security для pooled model | Pool + tenant_id + RLS + тесты изоляции | AWS-специфичную зависимость архитектуры |
| **PostgreSQL docs** | Range types, exclusion constraints, RLS FORCE, роли/BYPASSRLS | БД-гарантию отсутствия пересечений времени | Только прикладную проверку конфликта |
| **OWASP API Security** | BOLA, auth, property-level authorization, business flow abuse | Zero-trust tenant isolation, allowlist полей, rate limits, аудит | Нет |

Полезные первоисточники:
- Cal.com engineering: https://next.cal.com/blog/engineering-in-2026-and-beyond
- Cal.com open repo: https://github.com/calcom/cal.com
- Easy!Appointments OpenAPI: https://github.com/alextselegidis/easyappointments/blob/main/openapi.yml
- Square Bookings: https://developer.squareup.com/docs/bookings-api/what-it-is
- Altegio public API: https://developer.alteg.io/en
- SimplyBook product: https://simplybook.me/en/add-booking-system-to-website
- Booksy booking features: https://biz.booksy.com/features/online-booking
- Fresha booking: https://www.fresha.com/for-business/features/scheduling
- AWS pooled RLS: https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html
- PostgreSQL ranges: https://www.postgresql.org/docs/current/rangetypes.html
- PostgreSQL RLS: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- OWASP API Top 10: https://api-security.owasp.org/editions/2023/en/0x11-t10/

---

## 1. Архитектурные инварианты (не нарушать)

1. **Три независимо развёртываемых frontend:** (a) публичная онлайн-запись на поддомене компании, (b) рабочая CRM по общему домену, (c) внутренняя Platform Console на отдельном домене. Один frontend записи обслуживает неограниченное число поддоменов компаний; никаких отдельных сборок для каждого бизнеса.
2. **Один backend-модульный монолит**, один экземпляр PostgreSQL на среду с логически изолированными данными арендаторов. Впоследствии возможно вертикальное масштабирование или вынос модулей, но не преждевременные микросервисы.
3. `tenant` = компания, оплачивающая SaaS. `branch` = её филиал. Данные клиентов, записей, услуг, сотрудников, графиков, настроек принадлежат tenant; филиал — дополнительное измерение.
4. Данные компаний НЕ смешиваются; глобального маркетплейса/barbershop directory не существует. URL клиента ведёт прямо к бизнесу; на неизвестном адресе показывается 404, а не выбор компании.
5. **Единая доменная операция Booking Engine** обслуживает как публичную страницу, так и внутреннюю ручную запись CRM, перенос, отмену, блокировки. Нельзя дублировать алгоритм доступности в API разных интерфейсов.
6. Цены/длительности на backend — источник истины. Frontend рассчитывает только preview. При создании backend ещё раз валидирует и подтверждает slot+price+duration; никогда не верит ценам, tenant_id, длительности и permission-claim от клиента.
7. В MVP свободная запись **подтверждается автоматически**, без ручного approval. В прототипе варианты «запрос на подтверждение» и «SMS-код» явно помечены как будущие модули и не должны включаться в MVP.
8. Одна бронь MVP = один филиал, один мастер, несколько последовательно выполняемых услуг **этого же мастера**. У каждой услуги могут быть мастер-специфичные цена и длительность; при добавлении нескольких услуг общая занятость = сумма длительностей (плюс конфигурируемые буферы). Сценарий разных мастеров внутри одной брони — future.
9. Клиентам не требуется создавать login. `users` (работники CRM) и `customers` (потребители услуг) — разные сущности. Клиенты двух разных барбершопов не образуют общую публичную CRM даже при одинаковом телефоне.
10. Platform Console видит tenant metadata, подписки, технические состояния и агрегаты; **не** получает по умолчанию персональные данные посетителей, заметки о клиентах и содержание их записей.
11. Возможность поддержать компанию ≠ автоматическое право «войти как владелец». Доступ поддержки по заявке/разрешению владельца, с минимальным сроком и отдельным audit trail; без реальной impersonation-сессии в MVP допустим только явно обозначенный безопасный режим read-only диагностики, но нельзя симулировать эскалацию прав.
12. Status компания / подписка / платёж / запись / уведомление — **отдельные конечные автоматы** и столбцы, без значений одной категории в другой.
13. Финансовые суммы услуг не являются фактической выручкой (нет кассовой интеграции); payment SaaS поначалу только ручной реестр с отметками, без фиктивных платежей.
14. Не делать `push`, production deploy, закупку облачных ресурсов, регистрацию платных внешних аккаунтов без согласия заказчика.

### 1.1 Адреса и границы доступа

Примеры, все имена условные, не привязаны к купленным доменам:

```text
www.example.kz                   — наш маркетинговый сайт (не MVP backend)
app.example.kz                   — Business CRM frontend
console.example.kz               — Platform Console frontend
barberhouse.book.example.kz      — Booking frontend конкретной компании
moderncut.book.example.kz       — тот же Booking frontend, иной tenant
booking.custom-business.kz      — future: подтверждённый собственный домен
api.example.kz                   — один API (отдельные namespaces)
```

Можно использовать `barberhouse.example.kz` вместо `.book.`: зафиксировать единый канонический шаблон конфигурацией. На front side CRM разрешить только memberships действующего пользователя. На Platform Console — только platform permission, MFA/повышенная защита.

### 1.2 Разделение API

```text
/api/v1/public/*       — anonymous client booking; minimum public data
/api/v1/business/*     — authenticated tenant/branch-scoped operations
/api/v1/platform/*     — authenticated staff of SaaS, separate permissions
/api/v1/auth/*         — identity, membership switching, invitations
/health/live           — process alive
/health/ready          — db/dependency readiness
/openapi.json          — redacted/policy-controlled, versioned contract
```

На платформе отдельные access scopes, auth checks и потенциально отдельные серверные сервисные credentials. Простое разделение путей не является изоляцией. Запретить CORS `*` с credentials, настроить origin allowlist / проверяемые tenant-домены.

---

## 2. Привязка конкретного UI к backend: матрица контрактов

### 2.1 Клиентская онлайн-запись

В HTML есть сценарии: услуга→мастер→время, мастер→услуга→время по персональной ссылке, время→услуга→мастер, выбор «любой мастер», несколько услуг, изменения цены при смене мастера, занятое время, отсутствие специалистов/слотов, пустые результаты, контакты, success. Формировать backend контракты для них.

| Сценарий | Backend операция | Бизнес-правило |
|---|---|---|
| Открыть ссылку | `GET /public/site` через trusted host/site-context | Только публичная информация опубликованного tenant |
| Список филиалов/услуг/мастеров | `GET /public/branches`, `/services`, `/staff` | Только опубликованные и доступные в выбранном филиале |
| Сервис-first | `GET /public/availability?service_ids=...` | Общий список мастеров, способных выполнить ВСЕ услуги |
| Master-first | `GET /public/staff/{id}/services` | Учитывать deep-link и не давать выбрать недоступные услуги |
| Time-first | `POST /public/availability/search` | Выбранное время — предпочтение, пока не получен валидный quote |
| Любой мастер | `POST /public/availability/search` с `staff_mode=any` | Детерминированный порядок: ближайшее допустимое начало, затем минимальная цена, затем стабильный ID |
| Много услуг | Сервис quote | Общая длительность и цена считаются по конкретному мастеру |
| Контакты | `POST /public/bookings` | Только нормализованные поля, согласие с правилами, rate limit |
| Успешная запись | API возвращает immutable reference, подтверждённый временной интервал, цены и короткоживущую ссылку управления | Никакого фальшивого успеха до commit DB |
| Слот успели занять | 409 `SLOT_CONFLICT`, свежие альтернативы в отдельном ответе | Сохранить выбранные услуги и персональные данные локально, без утечки чужих bookings |
| Цена/мастер изменились | 409 `QUOTE_CHANGED`, новый quote | Нельзя молча подтверждать другие деньги/время |
| Отмена/перенос клиентом | `POST /public/manage/{token}/cancel` / `reschedule` | Криптостойкая ссылка, лимиты времени, защита от перебора |

**Важно:** прототип противоречит сам себе: CRM-настройки показывают «Отмена клиентом: за 3 часа», а публичный экран пишет «не позднее чем за 2 часа». Принять единый механизм `booking_policies.cancel_cutoff_minutes` на филиал/tenant; для стартовых seed-настроек использовать 180 минут (как в CRM), но публичный UI должен выводить значение динамически, не зашивать 120 минут. Для реального заказчика сделать это контролируемым параметром.

В CRM-макете также показано: горизонт записи 30 дней, минимальное время до визита 2 часа, шаг времени 15 мин, до 5 услуг в одной записи, перенос клиентом включён. Эти значения — стартовые configurable defaults, а не глобальные constants. Валидация на backend.

### 2.2 Business CRM

| Раздел UI | Backend объекты и операции | Особенности |
|---|---|---|
| Календарь день/неделя/список | `bookings`, `staff_occupancies`, `schedule` | Фильтр филиал/мастер, сортировка, pagination для списка |
| Создать запись вручную | тот же `booking.create` | Сотрудник с permission; возможно создать клиента, но те же проверки пересечений |
| Выбрать запись/статус | `booking.status`, `booking_events` | `confirmed / arrived / in_progress / completed / no_show / cancelled` с разрешёнными переходами |
| Перенос/drag/drop | `booking.reschedule` | Транзакционно освободить старый и занять новый interval, сохранить историю и snapshot новой цены |
| Блокировка периода | `calendar_blocks` + `staff_occupancies` | Нельзя заблокировать занятую запись без явного подтверждённого перемещения/отмены |
| Клиенты | `customers`, `customer_notes` | Данные только tenant; поиск по имени/телефону, совпадения телефона показывать оператору, не публично |
| Команда | `staff_profiles`, `staff_branches`, `staff_services` | `user` может быть сотрудником; staff может быть без login, авторизация отдельно |
| Графики | `weekly_shifts`, `shift_exceptions`, `time_off` | Внутренние часы, обед, отпуск, разный филиал по дням, master off |
| Услуги | `service_categories`, `services`, `staff_service_offers` | База + overrides price/duration у мастера, soft archive |
| Онлайн-запись | `booking_policies`, `booking_themes`, `booking_publications` | Публикация, бренд, мастерские deep links, QR/link |
| Обзор/отчёты | aggregation queries/views | Разделить запланированную стоимость и полученные деньги |
| Настройки | `tenant_settings`, `branches`, `memberships` | Назначение прав, местоположение, timezone, статус branch |

Для роли `master` — только личное расписание/доступные личные клиенты согласно политике; `owner/admin` — по разрешённым филиалам. Не выдавать полномочия по одному лишь client-provided `role`.

### 2.3 Platform Console

| Раздел UI | Объекты и сервисы |
|---|---|
| Обзор | `tenants`, `subscriptions`, `platform_alerts`, безопасные aggregate counters |
| Компании + фильтры | tenant registry, branch count, owner identity metadata, subscription status |
| Карточка / обзор | tenant metadata, aggregated usage stats; no PII by default |
| Подписка | trial, grace, renewal, effective date, discounts, manual ledger |
| Модули и лимиты | catalog release status, `plan_entitlements`, `tenant_overrides`, provisioning status |
| Доступы | owner/admin/master memberships, invite/resend, ownership transfer workflow |
| Адреса и домены | tenant domains, slug availability, DNS/TLS verification status |
| Активность | operational summaries, health checks, feature failures (not tenant client notes) |
| Поддержка | tickets, messages, internal notes, ticket statuses, request for limited assistance access |
| Аудит | append-only audited events with actor, tenant, before/after sanitized, reason |
| Роли платформы | platform staff & permissions (platform_owner, support, finance) |

---

## 3. Предлагаемый технологический стек

Выбор для реализации без дополнительных вопросов:
- Python **3.12**, **FastAPI**, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL 16+ (рекомендовано поддерживаемая актуальная версия), `psycopg`/`asyncpg` по согласованному режиму. Не смешивать sync и async ORM без причин.
- `pytest`, `pytest-asyncio` при async, `httpx`, Testcontainers/локальный PostgreSQL для настоящих интеграционных тестов; Ruff + mypy/pyright по возможности.
- OAuth2/OIDC с проверенным провайдером. Для локального MVP — Keycloak Docker как вариант (или готовый managed OIDC); не разрабатывать собственную криптографию OAuth. Backend — resource server; PII и роли в наших таблицах.
- Redis пока опционален для rate limiting/cache/фоновых задач; рабочие критичные запреты не должны зависеть от Redis. Для надежных фоновых событий `outbox_events` в PostgreSQL + простой worker/периодический polling. Не Kafka.
- S3-compatible Object Storage для логотипов/изображений с tenant-scoped keys и signed uploads; в локальном dev можно MinIO.
- Один монорепозиторий с `apps/booking-web`, `apps/business-crm`, `apps/platform-console`, `apps/api`; общие OpenAPI-типы/контракты (`packages/api-contracts`). Если прислан только HTML-холст, не изображать его React-приложением: сохранить как `/design/reference/` и реализовать backend независимо.
- Docker Compose для локальной среды: postgres, api, identity (если локальный Keycloak), optional worker, optional minio; `healthchecks`, migrations, seed demo.

### 3.1 Доменная организация backend

```text
apps/api/
  app/
    main.py
    api/
      public/v1/...
      business/v1/...
      platform/v1/...
      auth/v1/...
    modules/
      identity/              # accounts, claims, invites, memberships
      tenants/               # companies, branches, domains, themes
      catalog/               # categories, services, staff-specific offers
      staffing/              # staff, branch assignment, visibility
      scheduling/            # shifts, breaks, time off, available intervals
      bookings/              # quotes, reservation commands, events, status
      customers/             # customer base, notes, history
      subscriptions/         # plans, entitlements, lifecycle, ledger
      support/               # tickets, limited-access approvals
      analytics/             # read models and aggregated counters
      notifications/         # outbox, templates, adapters, delivery attempts
      audit/                 # append-only security-sensitive events
    infrastructure/
      db/                    # sessions, RLS context, migrations
      security/              # auth, permission, rate limits, PII masking
      domain_resolution/     # validated hostname => tenant context
      observability/         # logs, traces, metrics
      storage/               # file permissions, signed URLs
  tests/
  alembic/
packages/api-contracts/      # OpenAPI JSON and generated types
infra/
  compose/
  proxy/
  backup/
docs/
  architecture/
  decisions/
  api/
  runbooks/
```

Внутри каждого модуля: `domain/`, `service/`, `repository/`, `schemas/`, `api/`, `tests/`. Объединять лишь при обоснованном уменьшении сложности. Не делать прямые вызовы repository другого модуля из контроллеров; использовать сервисы.

### 3.2 Границы транзакций

- Команды create/reschedule/cancel выполняются атомарно; event audit и outbox записываются **в той же транзакции**.
- Отправка почты/WhatsApp/внешняя API-интеграция — после commit; ни один сетевой вызов не должен удерживать БД-транзакцию.
- Повторные запросы с `Idempotency-Key` возвращают тот же результат, не дублируют booking/ledger.
- `outbox` гарантирует возможность повторной доставки; consumer идемпотентен по event ID.

---

## 4. Подробная схема данных (предлагаемый реестр)

Требование: не ограничиться перечислением. Сгенерировать **реальные миграции**, SQLAlchemy-модели, ограничения, индексы, composite foreign keys, RLS и seeds. UUID как ID, `created_at/updated_at`, `created_by`, `row_version` где возможны конфликты. Мягкое удаление бизнес-справочников; сохранение истории записей. Все timestamp событий в `timestamptz UTC`, local wall-time + timezone для расписаний.

### 4.1 Control plane (глобальные, НЕ tenant PII tables)

1. `tenants(id, slug, display_name, vertical, lifecycle_status, timezone_default, owner_membership_id?, created_at, suspended_at?, suspension_reason?)`; `vertical=barbershop` доступный MVP.
2. `tenant_domains(id, tenant_id, hostname_normalized UNIQUE, domain_type, verification_status, tls_status, canonical, verified_at?, created_at)`; хранить историю переименований домена/redirect policy.
3. `identity_users(id, oidc_subject UNIQUE, email_normalized, email_verified_at, display_name, account_status)`: аккаунт не равен клиенту барбершопа.
4. `tenant_memberships(id, tenant_id, user_id, role, status, joined_at, revoked_at)` + `branch_role_grants`; пользователь может состоять в нескольких компаниях, но только с явным разрешением.
5. `platform_staff(user_id, platform_role, status, mfa_required)`; отделено от tenant memberships.
6. `invites(id, tenant_id?, email, invite_type, role, branch_scope, token_hash, expires_at, consumed_at, attempts, sent_at)`; одноразовые хешированные токены.
7. `plans`, `plan_versions`, `plan_entitlements(feature_key, limit_value, enabled, plan_version_id)`; версии plan immutable после применения.
8. `subscriptions(id, tenant_id, plan_version_id, lifecycle_status, period_start, period_end, trial_ends_at?, grace_ends_at?, suspended_at?, renewal_mode=manual, next_plan_version_id?, next_effective_at?)`.
9. `tenant_entitlement_overrides(id, tenant_id, feature_key, override_value, reason, valid_from, expires_at, authorized_by, created_at)`.
10. `feature_catalog(key, release_stage, configurable, description)`; отделён от entitlement tenant и connection status.
11. `tenant_integration_connections(id, tenant_id, provider, connection_state, last_error_code?, configured_at?)`.
12. `subscription_charges(id, tenant_id, subscription_id, period_start, period_end, amount_minor, currency, discount_minor, charge_status, evidence_reference?, created_by)`; не называть реальным поступлением без подтверждения.
13. `payment_records(id, charge_id, amount_minor, recorded_at, recorded_by, payment_method, evidence_reference, note)`; manual, без fee/payment gateway в MVP; сумма `amount_minor` всегда integer.
14. `subscription_decisions(id, tenant_id, decision_type, reason, actor_id, effective_at, old_state, new_state)`; историческое состояние.
15. `platform_support_tickets`, `support_messages`, `support_internal_notes`, `support_access_requests`, `support_access_sessions` с tenant, actor, approval, expiry, permitted_scope.
16. `platform_audit_events(id, actor_id, action, target_tenant_id?, object_type, object_id, before_sanitized, after_sanitized, reason, ip, request_id, occurred_at)` — append-only.
17. `platform_alerts`, `tenant_usage_daily` (только агрегаты без имён клиентов).

### 4.2 Data plane (с `tenant_id NOT NULL`, RLS)

18. `branches(id, tenant_id, name, city, address, timezone_iana, status, phone, weekly_hours)`.
19. `tenant_settings(id, tenant_id, locale, currency, business_name, branding, ... )`.
20. `booking_policies(id, tenant_id, branch_id?, book_ahead_days, min_advance_minutes, cancellation_cutoff_minutes, allow_self_reschedule, slot_step_minutes, max_services_per_booking, allow_online_booking, price_change_requires_acceptance)`.
21. `service_categories(id, tenant_id, name, sort_order, archived_at)`.
22. `services(id, tenant_id, category_id, name, description, base_price_minor, currency, base_duration_minutes, active, online_visible, archived_at, sort_order)`.
23. `staff_profiles(id, tenant_id, user_id NULLABLE, display_name, role_title, active, online_bookable, color, created_at)`.
24. `staff_branches(id, tenant_id, staff_id, branch_id, active, valid_from, valid_to?)`.
25. `staff_service_offers(id, tenant_id, staff_id, branch_id, service_id, price_override_minor?, duration_override_minutes?, active, online_visible)`; уникальный active pair per staff, branch, service.
26. `weekly_shifts(id, tenant_id, staff_id, branch_id, weekday_iso, local_start, local_end, effective_from, effective_to?)`; модель допускает несколько смен за день, без автоматически созданных пересечений между филиалами.
27. `shift_breaks(id, tenant_id, shift_id, local_start, local_end)`, `schedule_exceptions` (праздник, доп. смена, закрытие), `staff_time_off(id, tenant_id, staff_id, from_at_utc, to_at_utc, reason)`.
28. `customers(id, tenant_id, full_name, phone_e164, phone_digits_index, email?, notes_private?, created_at, archived_at, marketing_consent?, data_source)`; **не делать глобальный уникальный телефон**. Для нескольких совпадений телефона — явное разрешение дубликата, merge только с аудитом; клиентский API не раскрывает факт наличия профиля.
29. `customer_notes(id, tenant_id, customer_id, author_id, note, visibility_scope)`; tenant-only.
30. `bookings(id, tenant_id, branch_id, staff_id, customer_id, source, status, starts_at_utc, service_ends_at_utc, busy_ends_at_utc, timezone_snapshot, currency, amount_minor_snapshot, public_ref, idempotency_key?, version, created_by_user_id?, cancelled_at?, cancellation_reason?, created_at)`.
31. `booking_items(id, tenant_id, booking_id, service_id, sequence, service_name_snapshot, duration_minutes_snapshot, price_minor_snapshot, currency_snapshot)` — не пересчитывать старую запись после изменения прайса.
32. `staff_occupancies(id, tenant_id, staff_id, branch_id, booking_id NULL, block_id NULL, starts_at_utc, ends_at_utc, released_at NULL, occupancy_type)` — **источник правды о занятости**, уникальное непересекающееся время мастера. Занятость учитывает service + post-buffer; отдельные блокировки и реальные брони участвуют в одном запрете.
33. `calendar_blocks(id, tenant_id, staff_id, branch_id, start_at, end_at, block_reason, created_by)`.
34. `booking_events(id, tenant_id, booking_id, event_type, old_json_sanitized, new_json_sanitized, actor_type, actor_id?, created_at)` — история статусов и переносов.
35. `booking_quotes(id, tenant_id, branch_id, staff_id, selected_service_ids_ordered, start_at_utc, end_at_utc, amount_minor, duration_minutes, pricing_version_hash, expires_at, used_at?)` — optional persisted signed/opaque short-lived quote. Quote НЕ hold и не резервирует слот.
36. `public_management_tokens(id, tenant_id, booking_id, token_hash, scope, expires_at?, revoked_at?)` — без утечки в логи, hashed opaque random.
37. `booking_themes` и `booking_publications` (tenant/branch, colors, logo, links, published_at, is_public).
38. `outbox_events(id, tenant_id?, event_type, aggregate_id, payload_sanitized, created_at, processed_at?, retry_count, last_error)`.
39. `notification_deliveries(id, tenant_id, booking_id?, provider, channel, template, delivery_status, external_ref?, attempt_at, error_code?)`. Канал email можно подключить сейчас, SMS/WhatsApp disabled until configured.
40. `idempotency_records(scope, tenant_id?, actor_or_context_hash, idempotency_key, request_hash, response_body_redacted, response_code, created_at, expires_at)`.
41. `privacy_consents`, `privacy_access_requests` (если нормы/фактическая обработка требуют); не создавать фиктивные подтверждения без текста политики.

Это целевой реестр. Исполнитель вправе объединить технические таблицы, если сохранит правила и письменно зафиксирует причины. **Нельзя** упрощать критичные `occupancies`, `bookings`, `booking_items`, `tenant memberships`, `subscriptions`, `audit`, `outbox` до одного JSON-поля.

### 4.3 DB-инварианты

- Реляционные FK должны быть tenant-safe. Для ссылок между tenant tables использовать `(tenant_id, referenced_id) REFERENCES referenced_table(tenant_id, id)` и уникальный индекс `(tenant_id,id)` в целевых таблицах. Никакой booking компании A не должен ссылаться на staff компании B даже при искусственном обходе API.
- Индексы как минимум: `(tenant_id, branch_id, starts_at_utc)`, `(tenant_id, staff_id, starts_at_utc)`, `(tenant_id, phone_e164)`, `(tenant_id, status)`, `(tenant_id, archived_at)`, уникальные hostname и slug; отдельно индексы active rows и customer search.
- Никаких денежных `float`/`double`: все KZT в минимальных единицах; фиксировать currency ISO. Учитывать то, что для KZT nominal minor units могут быть тиын; пользовательские тенге конвертировать строго, без ошибок округления.
- Время: `timestamptz` UTC для записей, IANA timezone (`Asia/Almaty` и т.п.) для филиалов, local time для повторяющихся смен. Никакой глобальной `UTC+5` константы. Разбирать летнее время, переходы и несуществующие local timestamps для будущей международной экспансии.
- Архив/удаление услуг и мастеров не должно уничтожать прошлые bookings.
- `status` отдельный от `payment_state`, `tenant_lifecycle`, `subscription_lifecycle`.
- Составные уникальности/индексы с изменяемым `soft-delete` проектировать явно.

### 4.4 Минимальная SQL-гарантия от двойного бронирования

Базовый подход (адаптировать в реальной миграции и проверить её в PostgreSQL):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE staff_occupancies
  ADD CONSTRAINT staff_occupancy_valid_range
  CHECK (starts_at_utc < ends_at_utc);

ALTER TABLE staff_occupancies
  ADD CONSTRAINT staff_occupancy_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    staff_id WITH =,
    tstzrange(starts_at_utc, ends_at_utc, '[)') WITH &&
  ) WHERE (released_at IS NULL);
```

Подтверждённые брони и `calendar_blocks` оба создают `staff_occupancies`, поэтому нельзя провести две разные занятости на одно время. Не создавать частичный exclusion только по `bookings.status`, игнорирующий блокировки. При reschedule release старого интервала и reserve нового — атомарно, exception DB => 409, старый booking остаётся. Учитывать случаи многочасовых услуг, буферов, одновременного переноса и повторной отмены. Ключи ожидания/строковые блокировки могут дополнять constraint, но не заменять его. Для нескольких будущих ресурсов обобщить `resource_occupancies` отдельно, не реализовывать ресторанные столики в MVP.

### 4.5 RLS (tenant data only)

```sql
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;

CREATE POLICY bookings_tenant_policy ON bookings
  FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  );
```

Контекст `app.current_tenant` устанавливать **только после** проверки caller membership/public resolved site в **начале конкретной DB-транзакции** через `SET LOCAL`/`set_config(..., true)`; он автоматически пропадает при завершении транзакции. Не использовать непроверенный `X-Tenant-ID` из HTTP. Для Platform Console выполнять административные операции через явно разрешённые административные сервисы/контролируемые restricted functions/агрегатные views, а НЕ обычной runtime-ролью с `BYPASSRLS`. Отдельная migration role, runtime без SUPERUSER/BYPASSRLS/владения таблицами. При connection pool проверить, что tenant state не протекает между запросами. Протестировать `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `RETURNING`, background workers, cross-tenant FK. При отсутствии контекста — fail closed.

---

## 5. Booking Engine: алгоритм доступности и броней

### 5.1 Входы

`tenant resolved from trusted site-context`; `branch_id`; `service_ids[]` ordered; optional `staff_id`, else `staff_mode=any`; date/time window; optional requested time; `channel=public/business`; `booking_policies`, calendar exceptions, module entitlements.

### 5.2 Детерминированная доступность

1. Resolve tenant and branch; check published, business lifecycle, subscription entitlement; check branch active.
2. Check booking horizon (e.g. 30d), min advance (e.g. 2h), customer cancellation/reschedule policies as separate operations, max services (e.g. 5), time step (e.g. 15min), valid ordered service IDs without duplicates unless service actually permits repetition.
3. Filter active bookable staff assigned to branch who can perform **ALL** ordered services, with offer active and online_visible (for public).
4. For each candidate staff calculate `duration = SUM(effective_staff_service_duration) + buffers`, `price = SUM(effective_staff_service_price)`; check one currency; use Decimal/integer minor units.
5. Generate candidate slots in branch local timezone, convert to UTC, validate entire occupied interval inside working shifts and outside breaks, holidays, time off, existing bookings/blocks, across all branches of same employee. For overnight shift design deliberate support/constraint; DST reject ambiguous/nonexistent times unless explicit offset provided.
6. If specific master selected, show his available slots. If `any`, order by nearest start, then lowest total quote, then stable staff UUID (UI suggests «ближайшее время, затем цена»); no random reassignment after price confirmation.
7. Return slots + service price/time snapshot quote; attach `quote_id` short TTL (suggest 5 min) and `expires_at`. It is a quotation, **not** temporary reservation; explain in API docs.
8. In `POST booking` within DB transaction recalculate all guards, choose/check staff, lock contention/insert staff occupancy and booking/items/customer, append events/outbox, commit. Only then return `confirmed`.

### 5.3 При ошибке

- `409 SLOT_CONFLICT`: someone else booked; no booking created, return fresh preview/alternatives on next availability call.
- `409 QUOTE_CHANGED`: changed price/duration/staff/time; return new quote requiring explicit user acceptance; never silently charge another price.
- `422 INVALID_SELECTION`: incompatible services, too many services, invalid date/time.
- `403 BOOKING_DISABLED`: company or entitlement restricts new bookings, show tenant-safe message.
- `429 RATE_LIMITED`: anti-spam; never show sensitive tenant data.
- `404 SITE_NOT_FOUND` / `404 RESOURCE_NOT_FOUND`: distinguish unknown host from missing public objects without leaking private identifiers.

### 5.4 Состояния бронирования

Start as `confirmed`; allowed state flow:

```text
confirmed -> arrived -> in_progress -> completed
confirmed -> no_show
confirmed -> cancelled
arrived/in_progress -> cancelled only via explicit privileged override, reason/audit
completed/no_show/cancelled -> immutable final for regular staff; correction via separately audited admin operation
```

Reschedule retains a stable `booking_id` and increments `version`, appends `booking_events` with before/after; update `booking_items` snapshots as needed; **no duplicate booking**. If price changes on reschedule, require confirmation of new terms. Cancel releases occupancy at commit and preserves customer/booking history. Different source `public` vs `admin_manual` for analytics and permissions. Avoid pretending payment transaction completed on `completed` status.

### 5.5 Конкурентные сценарии (обязательные интеграционные тесты)

- Two simultaneous public requests same master/interval: exactly one `201`, one `409`, one active `staff_occupancy`.
- CRM user vs public client same slot: exactly one succeeds.
- Same idempotency key retried 5 times: one booking and same result each time; changed payload on same key => conflict.
- Simultaneous reschedule and new booking of old slot: no overlaps, history consistent.
- Staff across two branches cannot be simultaneously booked.
- Time block vs booking conflict in either order.
- Cancellation then re-book frees slot; cancellation repeated does not duplicate event.
- Price changes between quote and create returns QUOTE_CHANGED.
- Same user two tenant memberships cannot book/get bookings in unauthorized tenant by swapping identifiers.
- Block spanning staff break; long multi-service booking crossing break rejected.
- Timezone DST days and local midnight: no phantom or duplicate slots.

---

## 6. SaaS subscription lifecycle and permissions

### 6.1 Separate states

`tenant.lifecycle_status`: `provisioning | active | pending_suspension | suspended | archived`.

`subscription.lifecycle_status`: `trial | active | grace | expired_pending_action | suspended | canceled`.

`charge.status`: `draft | issued | partially_paid | paid | void`.

`integration.status`: `not_configured | configuring | active | error`.

`feature.release_stage`: `planned | internal_test | beta | available | retired`.

`entitlement`: enabled/disabled + explicit numeric limit and source (plan/override).

Не смешивать эти значения на одной карточке в поле «Оплата».

### 6.2 MVP политика жизненного цикла (одно решение вместо противоречий прототипа)

1. Trial: срок по умолчанию 14 дней (configurable), всё разрешённое планом работает. Trial завершился — grace 7 дней (configurable).
2. Active оплаченная/продлённая вручную подписка, automatic payments disabled.
3. Expiring: напоминания при 7d/3d/1d, сама работа не ограничивается.
4. Grace: booking+CRM продолжает работать; предупреждение на бизнес-стороне и запись в Platform Console.
5. День после grace: `expired_pending_action` + alert нашей команде. **Без автоматической жёсткой приостановки в MVP**, чтобы совпасть с переключателем «Автоматическая приостановка выключена» в прототипе.
6. Platform owner (или специально уполномоченная роль) после проверки причины выполняет `Suspend` вручную, с записанным actor/reason. При suspension: новые публичные bookings заблокированы, предыдущие не удалены, CRM read-only, платформа может восстановить доступ.
7. `Reactivate` — отдельная транзакционная команда, с reason + effective period/plan, восстановлением write permissions и обновлением публичного статуса. Смена статуса платёжной записи не должна сама по себе создавать фиктивную оплату.
8. Support role не может самостоятельно проставить «платёж получен»; finance role не может менять catalog modules и owner account.

**Смена тарифов:** версионировать план; existing subscribers остаются на прежней версии до явного изменения/оговорённой даты. Записать `old/new`, apply_at, proration policy (MVP без автоматической пропорциональной доплаты), подтверждение изменения лимитов. Если новые лимиты ниже текущего использования, **не удалять** филиалы/сотрудников; запретить новое расширение и показать over_limit, с явным next action.

### 6.3 Effective entitlements

Вычислять `effective = feature_release_available AND (plan_enabled OR valid_override) AND tenant_not_suspended`, с отдельным `integration_connection_ready` там, где требуется внешний провайдер. Учитывать, что функция может присутствовать в тарифе, но быть `planned`/`internal_test`, следовательно недоступна клиентам до выпуска. Для override обязательны actor, reason, expiry, audit. Не включать SMS/WhatsApp функционально только потому, что в дизайне есть тумблер «Включено для теста».

Лимиты: `max_branches`, `max_active_staff`, `custom_domain`, `advanced_reports`, будущие модули. В MVP нельзя считать «без ограничений» как буквальное бесконечное число в базе; используйте `NULL` как unlimited с документированным правилом.

---

## 7. Identity, роли и безопасность

### 7.1 Роли CRM

| Операция | owner | admin | master |
|---|---:|---:|---:|
| Мои записи/расписание | да | да | да (только свои) |
| Все записи филиала | да | да по назначенным филиалам | нет |
| Создать/изменить запись | да | да | свои, в пределах политики |
| Клиенты и история | да | да | только клиентов своих записей, минимум полей |
| Сотрудники/услуги/цены | да | по разрешению | нет |
| Доступы, филиалы, тарифные settings | да | ограниченно | нет |

### 7.2 Роли Platform Console

| Операция | platform_owner | support | finance |
|---|---:|---:|---:|
| Просматривать tenant metadata | да | да | да, без излишней PII |
| Создать компанию/повторить приглашение | да | да (по разрешению) | нет |
| Редактировать тарифы/модули глобально | да | нет | нет |
| Инициировать/подтвердить suspension | да | только отдельный grant | нет |
| Продлевать подписку / заносить ручные поступления | да | нет | да |
| Передача владельца компании | да, с подтверждением | нет | нет |
| Поддержка, диагностика | да | да | нет |
| Запросить ограниченный доступ | да | да, при согласовании с owner | нет |
| Просмотр platform audit | да | свои действия и обращения | финансовые события |

### 7.3 Безопасность авторизации

- OIDC JWT: проверять issuer/audience/signature/expiry/not-before, key rotation; отдельно `permissions` из доверенных серверных таблиц, а не из self-proclaimed headers. В CRM выбранный tenant только из `tenant_memberships` с active status.
- BFF/cookie auth может использовать HttpOnly Secure SameSite cookies и защиту CSRF. Не хранить access/refresh tokens в localStorage. `console` может использовать независимую сессию/MFA и короткие TTL.
- OAuth/password reset/invite tokens только hashed в БД, TTL + one-time + rate limiting; impersonation без чужого пароля.
- `support_access_request`: запрашиваем tenant и scope/причину; owner/явный уполномоченный пользователь принимает или отклоняет; после подтверждения действуют scope/time (макс. 30 минут для design MVP), можно revoke; красная/отличимая banner-сессия; audit каждого чувствительного обращения.
- Если владелец не одобрил — доступ к customer data и writes запрещён. «Уведомление владельцу» НЕ считается согласием.
- PII минимизация, safe logger, отсутствие номеров телефонов/токенов в HTTP logs, customer notes; encryption in transit, at-rest средствами провайдера, backups, экспорт/удаление по подтверждённой политике сохранения.
- Upload: проверки Content-Type + реальные magic bytes, лимиты, tenant prefixes, нет публичного list API, antivirus по мере необходимости; signed URL с TTL и tenant permission check.
- Public site endpoint не отдаёт внутренний tenant metadata, admin email, пользователей/клиентские телефоны, всю занятость мастеров или подробные причины занятых слотов.
- Rate limits: public availability per IP/domain, public booking per IP/phone/site, login, invite resend, management token; captcha only on risk triggers, не мешать обычной записи. Non-PII telemetry для спама.
- Все backend dependencies с pinned/locked versions, secret management `.env.example` без настоящих секретов, TLS, default deny auth, secure headers, no open redirects.

### 7.4 Domain resolver / public booking security

- Hostname normalizer: lowercase, IDNA/punycode, strip port/trailing dot; reject malformed host, verify against `tenant_domains` confirmed and allowed statuses. Не доверять `X-Forwarded-Host` из интернета — только от доверенного edge proxy с очисткой входных forwarding headers.
- Для браузерного SPA запросов к `api.example.kz` backend получает opaque `site_context` (подписанный/хранимый и привязанный к проверенному hostname, tenant_id, branch/publication и сроку). Его выдаёт trusted booking BFF / edge after host resolution; публичный payload не позволяет объявить произвольный `tenant_id`. Альтернатива: безопасный server-side reverse proxy `/api` same-origin, где проверяется Host. Зафиксировать одну модель в ADR.
- Custom domain: добавлять в `pending_verification`, проверять владение DNS, подтверждать TLS, только потом publish. No blind host-to-tenant mapping, no wildcard into external CNAME without ownership check.
- Смена slug/домена: reason, audit, collision policy; желательно канонический redirect старого проверенного адреса с ограниченным сроком вместо внезапного разрыва QR, но бизнес-правило фиксировать отдельно.

---

## 8. API спецификация v1 (минимальный перечень для реализации)

Версионирование `/api/v1`, OpenAPI JSON + human docs, стандартные `{code,message,details,request_id}` для ошибок, cursor pagination (или page/page_size с индексами). Все списки бизнес-API автоматически scoped to authenticated tenant; `tenant_id` в request body запрещён там, где он не нужен.

### 8.1 Публичные endpoints

```text
GET  /api/v1/public/site
GET  /api/v1/public/branches
GET  /api/v1/public/services?branch_id=...
GET  /api/v1/public/staff?branch_id=...&service_ids=...
GET  /api/v1/public/staff/{staff_id}/services
POST /api/v1/public/availability/search
POST /api/v1/public/bookings              (Idempotency-Key required)
GET  /api/v1/public/manage/{opaque_token}
POST /api/v1/public/manage/{opaque_token}/cancel
POST /api/v1/public/manage/{opaque_token}/reschedule
```

Public `availability/search` **не** должен сообщать имена клиентов из занятого времени. Public booking create returns `booking_reference`, assigned staff, displayable service snapshots/amount, date/time, masked customer contact, management link only to booking creator, current cancellation policy.

### 8.2 CRM endpoints

```text
GET    /api/v1/business/me
GET    /api/v1/business/memberships
POST   /api/v1/business/select-tenant
GET    /api/v1/business/dashboard
GET    /api/v1/business/branches
POST   /api/v1/business/branches
PATCH  /api/v1/business/branches/{id}
GET    /api/v1/business/calendar?start=...&end=...&branch_id=...&staff_id=...
POST   /api/v1/business/bookings             (Idempotency-Key required)
GET    /api/v1/business/bookings/{id}
PATCH  /api/v1/business/bookings/{id}/status
POST   /api/v1/business/bookings/{id}/reschedule
POST   /api/v1/business/bookings/{id}/cancel
GET    /api/v1/business/bookings/{id}/events
POST   /api/v1/business/calendar-blocks
DELETE /api/v1/business/calendar-blocks/{id}
GET    /api/v1/business/customers
POST   /api/v1/business/customers
GET    /api/v1/business/customers/{id}
PATCH  /api/v1/business/customers/{id}
GET    /api/v1/business/customers/{id}/bookings
POST   /api/v1/business/customers/{id}/notes
GET    /api/v1/business/staff
POST   /api/v1/business/staff
PATCH  /api/v1/business/staff/{id}
PUT    /api/v1/business/staff/{id}/services
GET    /api/v1/business/staff/{id}/schedule
PUT    /api/v1/business/staff/{id}/schedule
POST   /api/v1/business/staff/{id}/time-off
GET    /api/v1/business/service-categories
POST   /api/v1/business/service-categories
GET    /api/v1/business/services
POST   /api/v1/business/services
PATCH  /api/v1/business/services/{id}
POST   /api/v1/business/services/{id}/archive
GET    /api/v1/business/booking-settings
PATCH  /api/v1/business/booking-settings
GET    /api/v1/business/booking-branding
PATCH  /api/v1/business/booking-branding
POST   /api/v1/business/booking-publication/publish
GET    /api/v1/business/booking-links
GET    /api/v1/business/reports/overview?from=...&to=...&branch_id=...
GET    /api/v1/business/reports/bookings?...
GET    /api/v1/business/members
POST   /api/v1/business/invitations
PATCH  /api/v1/business/members/{id}/permissions
```

### 8.3 Platform Console endpoints

```text
GET    /api/v1/platform/overview
GET    /api/v1/platform/tenants?query=...&vertical=...&status=...
POST   /api/v1/platform/tenants                  (idempotent creation)
GET    /api/v1/platform/tenants/{id}
PATCH  /api/v1/platform/tenants/{id}
GET    /api/v1/platform/tenants/{id}/usage
GET    /api/v1/platform/tenants/{id}/entitlements
POST   /api/v1/platform/tenants/{id}/overrides
POST   /api/v1/platform/tenants/{id}/suspend
POST   /api/v1/platform/tenants/{id}/reactivate
GET    /api/v1/platform/tenants/{id}/domains
POST   /api/v1/platform/tenants/{id}/domains
POST   /api/v1/platform/tenants/{id}/domains/{domain_id}/verify
GET    /api/v1/platform/tenants/{id}/members
POST   /api/v1/platform/tenants/{id}/invite-owner
POST   /api/v1/platform/tenants/{id}/transfer-ownership/request
POST   /api/v1/platform/tenants/{id}/transfer-ownership/confirm
GET    /api/v1/platform/plans
POST   /api/v1/platform/plans
POST   /api/v1/platform/plans/{id}/versions
GET    /api/v1/platform/features
GET    /api/v1/platform/subscriptions
GET    /api/v1/platform/subscriptions/{id}
POST   /api/v1/platform/subscriptions/{id}/renew
POST   /api/v1/platform/subscriptions/{id}/change-plan
GET    /api/v1/platform/subscriptions/{id}/charges
POST   /api/v1/platform/subscriptions/{id}/charges
POST   /api/v1/platform/charges/{id}/record-payment
GET    /api/v1/platform/tickets
POST   /api/v1/platform/tickets
GET    /api/v1/platform/tickets/{id}
POST   /api/v1/platform/tickets/{id}/messages
POST   /api/v1/platform/access-requests
POST   /api/v1/platform/access-requests/{id}/approve
POST   /api/v1/platform/access-requests/{id}/deny
POST   /api/v1/platform/access-sessions/{id}/revoke
GET    /api/v1/platform/audit?...
GET    /api/v1/platform/staff
POST   /api/v1/platform/staff/invitations
GET    /api/v1/platform/settings
PATCH  /api/v1/platform/settings
```

Owner approval должен происходить через разрешённый business endpoint, а не потому, что platform staff сам вызвал `/approve`; конечный маршрут уточнить при проектировании security flows. Приведённые paths — **контракт для кодирования**, допускаются изменения naming с обновлением OpenAPI и ADR, но ни одна из групп операций не должна пропасть.

### 8.4 Примеры данных

**Поиск доступности (illustrative):**

```json
{
  "branch_id": "UUID",
  "service_ids": ["service-uuid-1", "service-uuid-2"],
  "staff_mode": "any",
  "from": "2026-11-11T00:00:00+05:00",
  "to": "2026-11-12T00:00:00+05:00",
  "preferred_start": null
}
```

**Ответ (illustrative):**

```json
{
  "timezone": "Asia/Almaty",
  "slots": [{
    "staff_id": "uuid-assigned-by-server",
    "starts_at": "2026-11-11T13:00:00+05:00",
    "service_ends_at": "2026-11-11T14:30:00+05:00",
    "duration_minutes": 90,
    "price_minor": 1050000,
    "currency": "KZT",
    "quote_id": "opaque-token-or-uuid",
    "quote_expires_at": "2026-11-08T16:00:00+05:00"
  }]
}
```

Сумма выше — демонстрационный пример, `price_minor` подразумевает 2 дробных разряда; это должно быть явно указано в общем денежном контракте. Реальная сумма/длительность обязана высчитываться из БД для мастерских offer overrides. В Booking Create отправлять `quote_id`, customer name/phone, booking consent, request id + `Idempotency-Key`, но **не** цену/tenant_id как источник истины.

---

## 9. Агрегаты и отчёты (не придумывать revenue)

- Today's bookings, upcoming, completed, cancelled, no_show; фильтры date/branch/staff/source/status. Счётчики выводить по определённым правилам, не складывать отменённые в занятое время.
- Utilization = booked occupied minutes / available work minutes в выбранном диапазоне, исключая breaks/time off и с документированным статус-фильтром. Не делить на суммарные часы всех сотрудников без учёта выходных.
- Planned service value = сумма snapshots по соответствующим будущим/неотменённым bookings, не фактически полученная выручка.
- Popular services по `booking_items` и заданному диапазону дат, без двойного подсчёта при reschedule.
- Tenant usage stats для Platform Console агрегированные и безопасные: `booking_count_30d`, branch count, active staff, public share, cancellation rate. Поддержке — диагностические коды без payload клиента.
- Набор расчётных определений держать в `docs/analytics/metric_definitions.md` + SQL/integration tests на test fixtures.

---

## 10. Уведомления и фоновые задачи

Минимальный MVP:
- `booking.created`, `booking.cancelled`, `booking.rescheduled`, `invitation.created`, `subscription.expiring`, `suspension.changed` пишутся в outbox.
- Локальный mail adapter (Mailpit/SMTP в dev) для приглашений; в прод только если предоставлен SMTP. No fake "отправлено", если email не был доставлен или помещён в отправку — statuses `queued/sent/failed`.
- Будущие SMS/WhatsApp adapters под интерфейс `NotificationProvider`, но disabled по умолчанию. Нельзя использовать реальные сторонние ключи без согласия.
- Worker может быть отдельным процессом того же кода, не отдельным микросервисом. Нужны retry/backoff/dead-letter status, уникальный event consumption id.
- Scheduled grace/expiry/override expiration jobs идемпотентны; платформа не должна уйти в wrong state после рестарта.

---

## 11. Локальный запуск, CI, наблюдаемость, backup

1. `docker compose up --build` создаёт Postgres, API, IAM/dev mail при необходимости; migrations выполняются отдельно/однократно и fail-fast при ошибке.
2. `.env.example`, seed: 2 tenant (`barberhouse`, `moderncut`) с одинаковыми тестовыми customer names/phones, отдельными staff/services/branches, 3 платформенные роли. Seeds только dev.
3. Swagger/OpenAPI, `README.md`, `make dev`, `make migrate`, `make seed`, `make test`, `make test-integration` (или эквивалент), `docker compose down` без удаления volumes по умолчанию.
4. Logs structured JSON с `request_id`, `actor_id`, `tenant_id` (для внутренних logs) и no PII; separate HTTP access logs safe, redaction (Authorization, phone, tokens). Basic metrics error rate, booking latency, 409 rate, quote conflict, worker failures, RLS denials, webhook retries.
5. Readiness/liveness; migrations backward compatible; request timeouts, DB pool limits, pagination caps, security headers, base rate limit per endpoint.
6. Backups: периодический pg_dump/base backups plus PITR strategy for prod; документировать retention, restore procedure и **провести restore test в изолированной test БД**. Не писать «backup есть» если он не настроен.
7. CI: lint, static typing, unit, integration against real PostgreSQL, migration up/down or forward-compat gate, security negative tests, API schema diff, dependency audit. No secrets in repos.
8. README инструкции по TLS, wildcard DNS, custom domains (future), CORS and trusted proxies, OIDC settings, production compose sample, secrets, logs and upgrade.
9. Базовый тест нагрузки: 2 tenant, 100 staff, 10k historical bookings each, поиск слотов за один день, p95 measurements; значения performance не обещать до измерения.

---

## 12. Проверки и критерии приёмки (DONE только с доказательствами)

### P0 security

- [ ] Anonymous cannot read business booking list/customer data.
- [ ] Business owner tenant A cannot read/write/iterate tenant B by swapping URL IDs/body fields/headers.
- [ ] Platform support cannot see tenant client PII by default.
- [ ] Master cannot view another master's complete calendar/client notes.
- [ ] Runtime DB role has no BYPASSRLS or table ownership bypass; RLS forced on tenant tables.
- [ ] PostgreSQL RLS and composite FK tests demonstrably run on real PostgreSQL.
- [ ] Tenant context isolated between pooled DB connections and worker tasks.
- [ ] Direct API calls cannot escalate owner/admin/platform permissions.
- [ ] Invite/booking/manage tokens are unguessable, stored hashed, TTL, revoked on transfer and retried.
- [ ] Known Host/X-Forwarded-Host forgery and unverified custom domain cannot map to other tenant.

### P0 Booking Engine

- [ ] Public and CRM create use same service and same capacity restrictions.
- [ ] 2 parallel clients cannot double-book one staff interval; proof via concurrency tests.
- [ ] Working shifts/breaks/leave/calendar blocks/other branch commitments honored.
- [ ] Multi-service price/duration calculated per staff, order preserved, snapshots immutable.
- [ ] `any master` reproducible; confirm actual staff+price before commit.
- [ ] 409 slot conflict and quote change implemented, no silent rebooking.
- [ ] Reschedule rollback retains original booking when target slot conflicts.
- [ ] Status events and cancellation preserve history; cancelled appointments free capacity.
- [ ] Time zone, midnight, DST tested.
- [ ] Idempotency repeated requests do not duplicate bookings.

### P0 Platform & CRM

- [ ] Onboard company, invite owner, create branch/services/staff, publish, book by public domain, see booking in that tenant CRM.
- [ ] Same web booking code works for second tenant and cannot reveal first tenant.
- [ ] Platform can filter tenant list, view non-PII stats, change subscription, set expiring override, suspend and reactivate.
- [ ] Trial/grace/manual suspend coherent, both CRM and booking enforce state; no fake automatic payment.
- [ ] Roles and support consent/revocation obey acceptance rules.
- [ ] KPI derived from stored bookings and expected fixtures, not hardcoded demo constants.
- [ ] DB migrations reversible where feasible; seed never runs in production by accident.
- [ ] OpenAPI exports cover all implemented endpoints with examples/error codes.

### P1 quality

- [ ] Validation and API error responses documented.
- [ ] Customer duplication handling: same phone at different companies never causes global merge.
- [ ] Outbox email invite and retry demonstrate delivered/failed states.
- [ ] Audit captures actor, target, old/new, reason without tokens/PII leaks.
- [ ] Healthchecks, Docker Compose, test instructions, backup restore note.
- [ ] Permission matrix covered by tests for 3 business roles and 3 platform roles.

---

## 13. План разработки исполнителя с обязательными gates

**Этап 0. Инвентаризация и решения.** Изучить HTML, создать `docs/design_inventory.md` (каждый экран -> функция -> API -> таблица, что future). Создать `docs/decisions/ADR-001..` про stack, tenancy, RLS, domain resolution, booking conflict, pricing, subscription lifecycle, auth, cancellation policy. Отдельно записать противоречия демонстрационных макетов и выбранные единые правила. Не переписывать UI-макеты произвольно.

**Этап 1. Инфраструктура.** Repo skeleton, PG, migrations, FastAPI, OIDC dev, scoped auth, tenant tables, RLS/composite FK, platform roles. Gate: 2 tenants isolated even with direct HTTP/SQL tests.

**Этап 2. Домен CRM.** Branches, staff, services, offers, customers, working hours, exceptions, blocks, settings, policies. Gate: CRUD permissions and rules, no cross-tenant access.

**Этап 3. Booking Engine.** Availability search, quotes, create, conflict exclusion, idempotency, cancellation, reschedule, events, snapshot. Gate: parallel booking stress plus all scheduling tests.

**Этап 4. Public API.** Tenant by verified hostname/site context, service/master/time scenarios and deep-links, status success/conflict, management links. Gate: e2e tenant A/tenant B on same code, no public PII.

**Этап 5. SaaS control plane.** Onboarding, trials/plans/subscriptions/manual ledger/overrides, suspension/reactivation, domain registry, platform non-PII dashboard. Gate: entitlement transitions end-to-end in both CRM and booking.

**Этап 6. Support & audit, outbox.** Tickets, roles, approvals, audited temporary access, event history, email invites, local worker. Gate: no support PII before explicit owner consent, notifications with correct retry states.

**Этап 7. Operational hardening.** reports, backup/restore, CI, OpenAPI, doc examples, security regression, load test. Gate: runnable with documented commands and independent evidence.

**Этап 8. Frontend integration (если разрешено).** Создать API clients/adapters, сгенерировать types, подключить конкретные приложения. Если прислан только HTML-дизайн-лист — честно завершить backend + API demo; конвертацию листа в SPA вынести в отдельную задачу, не заявлять end-to-end UI интеграцию без рабочего frontend.

Если срок ограничен, **не скрывать невыполненные этапы**. Готовность обозначать `DONE/TESTED/PARTIAL/BLOCKED/FUTURE`; фиксировать точные пройденные тесты и реальные ограничения. Минимум для demo: завершить этапы 1–5 с полноценными P0 тестами, а не создавать заглушки по всем endpoint.

---

## 14. Что исполнитель должен сдать

1. **Реальные исходники backend**, миграции, backend tests, Compose, no secrets; не только архитектурный README.
2. `docs/design_inventory.md` — соответствие трёх UI-листов таблицам, эндпоинтам и feature gates.
3. `docs/architecture.md` — компонентная схема, lifecycle diagrams, multi-tenant boundaries, threat model.
4. `docs/db_schema.md` и/или ERD Mermaid + актуальные миграции, список RLS policies and indexes.
5. `docs/booking_engine.md` — расчёт интервалов, спорные cases, concurrency strategy, price snapshots.
6. `docs/auth_roles.md` — матрица ролей, ограниченный доступ поддержки и approval flow.
7. `docs/subscriptions.md` — статус-машина trial/grace/expired-pending/suspended, manual billing, plan versions, overrides.
8. `openapi.json` + `docs/api_samples/` c реальными success/error examples и curl/http collection.
9. `docs/deployment.md` и `docs/runbooks/` — dev/prod configuration, migrations, backup/restore, recovery, logs.
10. `docs/TEST_REPORT.md` с командами, числом PASS/FAIL, доказательствами параллельного бронирования, RLS cross-tenant tests, сценариями двух компаний.
11. `docs/DECISIONS.md` — решения и отклонения от HTML, unresolved blockers, future features.
12. `docs/KNOWN_LIMITATIONS.md` — честные отсутствующие части, включая frontend integration status, SMS/WhatsApp/payments/custom domains.
13. Полный **ZIP для независимого аудита** (весь изменённый код, миграции, фикстуры без секретов, критические конфиги, отчёты и инструкции); не ссылку на несуществующий локальный путь. Локальный путь/файл должен реально существовать. Git commit/push только по разрешению владельца.

---

## 15. Product decisions / unresolved questions (не подменять фантазиями)

**Зафиксировано как предлагаемое MVP-решение:** barbershop only; 3 frontends, 1 API, shared PG + RLS; instant confirmed public bookings; one staff for all selected services; manual SaaS billing; consent-based support access; 14d trial and 7d grace; manual suspension on explicit action; 30d horizon, 2h minimum before booking, 15-min step, max 5 services, 3h cancellation cutoff **как стартовые настройки из CRM-макета**, а не законодательная норма. Booking frontend должен показывать реальные настройки.

**Подлежит отдельному утверждению при коммерческом запуске:** правила SMS/email client reminders, self-management booking link security/expiry, сохранение персональных данных и тексты согласий, ответственность за домены/DNS/TLS, способ финансовых подтверждений, точные стартовые тарифы/лимиты, политика переноса записи менее чем за cutoff, договоры/оферта, реальное подключение платёжного провайдера, резервирование времени на этапе контактов (в MVP НЕ hold), обходные действия админов при forced overbooking (в MVP запрещены).

**Явно не MVP:** customer global login, public marketplace, manual appointment approval, OTP mandatory, online consumer payments, salary/payroll, POS, inventory, marketing automation, room/table/doctor availability, cross-staff sequential appointments, true multi-resource allocation, global recurring booking, franchise revenue accounting, large-scale BI, AI, Kafka, Kubernetes, separate DB per tenant, automatic site builder, native apps, public API keys for third-party integrators, webhooks to external partners. Можно предусмотреть интерфейсы расширения, не создавать фиктивные реализации.

---

## 16. Типовые демонстрационные E2E-сценарии, обязательные на сдаче

**E2E A.** Platform owner создаёт barbershop A и выдаёт owner invitation -> owner активирует membership -> создаёт филиал, 3 мастеров, 4 услуги и master-specific price/duration -> публикует subdomain -> anonymous клиент выбирает 2 услуги, видит ближайшие 3 слота «любой мастер» -> подтверждает бронь -> появляется в CRM A с правильной длительностью/ценой -> отменяет по secure link с cutoff -> слот освобождается.

**E2E B.** Barbershop B имеет такой же номер клиента, но свой staff / каталог. Владелец A не видит запись B через таблицы, API, прямые UUID и cross-FK. Host B не выдаёт А данные/бренд. Отчёты A не включают B.

**E2E C.** Одновременно два клиента на один слот: только одна бронь 201, другая 409 с безобидной альтернативой. Никакого дубля в базе. CRM manual block vs public booking same result.

**E2E D.** Компания A вошла в grace -> предупреждение, запись работает -> после grace `expired_pending_action`, alert platform -> platform owner вручную suspend -> anonymous booking disabled, existing bookings сохранены, CRM read-only -> Reactivate restores correct permissions; audit показывает причину и актёра.

**E2E E.** Support staff открывает компанию A: доступ к metadata и агрегатам есть, customer names/notes запрещены -> запрашивает temporary tenant assistance -> владелец одобряет -> строго ограниченный доступ с баннером/TTL -> истечение/revoke закрывает доступ -> все sensitive actions аудитятся.

**E2E F.** Finance records manual payment receipt for one charge -> subscription renewal separately controls period -> reporting distinguishes paid/unpaid ledger and estimated service value; повторная отправка того же платежа по idempotency key не удваивает сумму.

**E2E G.** Смена базовой стоимости услуги после уже созданной записи не меняет её `booking_items` snapshots; новая запись получает актуальную цену, quote change correctly returns 409 when stale.

**Финальный критерий:** систему можно запустить из чистого checkout, создать две независимые компании, получить две рабочие URL-записи и две логически изолированные CRM через API, управлять ими отдельно из Platform Console, воспроизвести гонку бронирования и наблюдать корректный отказ, сдать код+тесты+лог решений. Не считать тестом один красиво открытый статический HTML-холст.
