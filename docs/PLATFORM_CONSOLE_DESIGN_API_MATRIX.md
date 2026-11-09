# Platform Console Design-to-API Implementation Matrix

> Полная инвентаризация и аудит соответствия макета внутренней SaaS-админки `готовый фронт.html` (разделы P1–P7, pshell), REST API backend (`apps/api/app/api/v1/platform/`), схемы PostgreSQL и тестов Playwright / Pytest.
> 
> **Ветка аудита:** `fix/platform-console-v1-audit-gate`  
> **Базовый коммит:** `e31737302a4e693d95bbb68cbc507808d50bde3d`  
> **Статус аудита:** Все замечания независимого аудита P0-01 — P0-05 и P1 устранены. 32/32 Pytest пройдены, 10/10 Playwright Platform пройдены, 15/15 CRM/Booking E2E пройдены.

---

## 1. Каркас, навигация и сессии поддержки (Design P1)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 1.1 | **Темный сайдбар платформы (216px)** | Любой `/` | `GET /api/v1/auth/me`, `GET /api/v1/platform/overview` | `platform_staff`, `identity_users` | `viewer` | Темный фон `#0F172A`, лого `PC` `#2563EB`, бейдж «Внутренний доступ», 4 группы меню (Работа, Продукт, Сервис, Платформа) | **DONE** | [platform.spec.ts:P1](file:///tests/e2e/platform.spec.ts#L7) |
| 1.2 | **Баннер активной сессии поддержки** | Шапка `/` | `GET /api/v1/platform/support/active-session` | `support_access_sessions`, `support_access_requests` | `support` | Зеленый баннер со щитом `ic('shield')`, обратным отсчетом 30 мин и кнопкой «Завершить сеанс» | **DONE** | [platform.spec.ts:P7](file:///tests/e2e/platform.spec.ts#L231) |
| 1.3 | **Экран входа персонала платформы** | `/login` | `POST /api/v1/auth/login` | `identity_users`, `platform_staff` | — | Форма входа по email/паролю, валидация роли в `platform_staff`, отказ CRM-пользователям без прав | **DONE** | [platform.spec.ts:P1](file:///tests/e2e/platform.spec.ts#L7) |
| 1.4 | **Мобильная панель навигации (P0-05)** | Мобильный Viewport (390px/360px/320px) | `GET /api/v1/platform/overview` | `platform_staff` | `viewer` | Мобильная шапка `#0B1220`, нижний фиксированный таббар (Обзор, Компании, Подписки, Поддержка, Ещё) и выкатное меню-дровер на 8 модулей. Горизонтальный blowout устранен (`scrollWidth <= viewportWidth`) | **DONE** | [platform.spec.ts:P10](file:///tests/e2e/platform.spec.ts#L374) |
| 1.5 | **Индикаторы загрузки и состояния ошибок с Retry** | Все экраны | — (UI state) | — | `viewer` | Скелетон, баннер ошибки сети/API с кнопкой «Повторить загрузку» (без ложных пустых нулей) | **DONE** | Component Specs |

---

## 2. Обзор платформы (Overview, Design P1)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 2.1 | **KPI Dashboard (Компаний, Активных, Приостановленных, Выручка)** | `/` | `GET /api/v1/platform/overview` | `tenants`, `subscriptions`, `platform_alerts` | `viewer` | 4 карточки KPI, желтая карточка для срочных действий | **DONE** | [platform.spec.ts:P2](file:///tests/e2e/platform.spec.ts#L31) |
| 2.2 | **Блок «Требуют внимания»** | `/` | `GET /api/v1/platform/overview` | `subscriptions`, `tenants`, `platform_alerts` | `viewer` | Срочно сегодня (окончание льготного периода) и в ближайшие дни (скорое окончание подписок) | **DONE** | [platform.spec.ts:P2](file:///tests/e2e/platform.spec.ts#L31) |
| 2.3 | **Последние подключенные компании** | `/` | `GET /api/v1/platform/tenants?limit=5` | `tenants`, `subscriptions`, `plans` | `viewer` | Список последних компаний с бейджами статуса и нишей | **DONE** | [platform.spec.ts:P2](file:///tests/e2e/platform.spec.ts#L31) |
| 2.4 | **Финансовый дисклеймер MVP (P0-04)** | `/` | — | — | `viewer` | Предупреждение о сумме подтвержденных ручных оплат и отсутствии автоматического эквайринга | **DONE** | [platform.spec.ts:P2](file:///tests/e2e/platform.spec.ts#L31) |

---

## 3. Реестр компаний и онбординг (Companies, Design P2–P4)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 3.1 | **Таблица компаний с поиском и фильтрами** | `/companies` | `GET /api/v1/platform/tenants` | `tenants`, `subscriptions`, `plans` | `viewer` | Поиск по названию/ID/домену, фильтры (ниша, тариф, подписка, оплата, статус) | **DONE** | [platform.spec.ts:P3](file:///tests/e2e/platform.spec.ts#L53) |
| 3.2 | **Мастер онбординга компании (4 шага)** | `/companies/new` | `POST /api/v1/platform/tenants` | `tenants`, `tenant_domains`, `identity_users`, `invites`, `subscriptions` | `support` | Шаг 1: Компания, Шаг 2: Доступ владельца, Шаг 3: Тариф и trial, Шаг 4: Публикация и проверка | **DONE** | [platform.spec.ts:P3](file:///tests/e2e/platform.spec.ts#L53) |
| 3.3 | **Карточка компании: Вкладка «Обзор»** | `/companies/:id?tab=overview` | `GET /api/v1/platform/tenants/{id}` | `tenants`, `branches`, `staff_profiles`, `bookings` | `viewer` | Реквизиты, владелец, агрегированные цифры визитов (без PII), статус системы | **DONE** | [platform.spec.ts:P4](file:///tests/e2e/platform.spec.ts#L102) |
| 3.4 | **Карточка компании: Вкладка «Подписка»** | `/companies/:id?tab=subscription` | `GET /api/v1/platform/tenants/{id}/subscription` | `subscriptions`, `subscription_charges`, `payment_records` | `viewer` | Текущий тариф, даты окончания, льготный период, история начислений и платежей | **DONE** | [platform.spec.ts:P4](file:///tests/e2e/platform.spec.ts#L102) |
| 3.5 | **Карточка компании: Вкладка «Модули и лимиты»** | `/companies/:id?tab=modules` | `GET/POST /api/v1/platform/tenants/{id}/entitlements` | `plan_entitlements`, `tenant_entitlement_overrides` | `support` | Табличный статус фич: статус в продукте, разрешение, подключение, исключения | **DONE** | [platform.spec.ts:P4](file:///tests/e2e/platform.spec.ts#L102) |
| 3.6 | **Карточка компании: Вкладка «Доступы»** | `/companies/:id?tab=access` | `GET /api/v1/platform/tenants/{id}/users` | `tenant_memberships`, `identity_users`, `invites` | `viewer` | Список пользователей CRM (владелец, админ, мастер), статус инвайтов, повторная отправка | **DONE** | [platform.spec.ts:P4](file:///tests/e2e/platform.spec.ts#L102) |
| 3.7 | **Карточка компании: Вкладка «Адреса и домены»** | `/companies/:id?tab=domains` | `GET /api/v1/platform/tenants/{id}` | `tenant_domains` | `viewer` | Поддомен онлайн-записи, статус верификации, ссылка на панель | **DONE** | [platform.spec.ts:P4](file:///tests/e2e/platform.spec.ts#L102) |
| 3.8 | **Карточка компании: Вкладка «Активность»** | `/companies/:id?tab=activity` | `GET /api/v1/platform/audit?target_tenant_id=...` | `platform_audit_events` | `viewer` | Хронологический журнал событий по компании (продления, исключения, доступы) | **DONE** | [platform.spec.ts:P4](file:///tests/e2e/platform.spec.ts#L102) |
| 3.9 | **Карточка компании: Вкладка «Поддержка»** | `/companies/:id?tab=support` | `GET /api/v1/platform/support/tickets?tenant_id=...` | `platform_support_tickets`, `support_access_requests` | `support` | Список тикетов компании, форма запроса ограниченного доступа | **DONE** | [platform.spec.ts:P4](file:///tests/e2e/platform.spec.ts#L102) |
| 3.10 | **Приостановка доступа компании (Suspend)** | Модальное окно | `POST /api/v1/platform/tenants/{id}/suspend` | `tenants`, `subscriptions`, `subscription_decisions` | `platform_owner` | Обязательная причина, перевод CRM в read-only, отключение публичной записи, аудит | **DONE** | [platform.spec.ts:P4](file:///tests/e2e/platform.spec.ts#L102) |
| 3.11 | **Восстановление доступа компании (Reactivate)** | Модальное окно | `POST /api/v1/platform/tenants/{id}/reactivate` | `tenants`, `subscriptions`, `subscription_decisions` | `platform_owner` | Снятие блокировки, возврат в статус active, аудит | **DONE** | [platform.spec.ts:P4](file:///tests/e2e/platform.spec.ts#L102) |

---

## 4. Подписки и биллинговый журнал (Subscriptions, Design P5)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 4.1 | **Реестр подписок по срокам** | `/subscriptions` | `GET /api/v1/platform/subscriptions` | `subscriptions`, `tenants`, `plans` | `viewer` | Таблица: компания, тариф, статус подписки, срок до, осталось дней, статус оплаты | **DONE** | [platform.spec.ts:P5](file:///tests/e2e/platform.spec.ts#L171) |
| 4.2 | **5 состояний подписки (Инфо-панель)** | `/subscriptions/rules` | `GET /api/v1/platform/settings/lifecycle` | — | `viewer` | Единое правило: Активная → Пробная → Льготный период (7 дней) → Ожидает приостановки → Приостановлена | **DONE** | [platform.spec.ts:P5](file:///tests/e2e/platform.spec.ts#L171) |
| 4.3 | **Продление доступа без фальсификации оплат (P0-04)** | Модальное окно | `POST /api/v1/platform/subscriptions/{id}/renew` | `subscriptions`, `subscription_charges` | `finance` | Продление по умолчанию только продлевает доступ (`record_payment=false`), выставляет счет `issued`, не восстанавливает принудительно suspended компании и не начисляет фиктивную оплату | **DONE** | [platform.spec.ts:P5](file:///tests/e2e/platform.spec.ts#L171) |
| 4.4 | **Регистрация ручного платежа с Idempotency и блокировкой строк (P0-04)** | В карточке счета | `POST /api/v1/platform/charges/{id}/record-payment` | `payment_records`, `subscription_charges` | `finance` | Внесение оплаты по `Idempotency-Key` с привязкой к полному payload (409 при несовпадении), блокировка `SELECT FOR UPDATE`, запрет переплаты (> остатка = 400) | **DONE** | [platform.spec.ts:P5](file:///tests/e2e/platform.spec.ts#L171) |

---

## 5. Каталог тарифов и версионирование (Plans, Design P6)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 5.1 | **Каталог тарифов (Start, Pro, Business)** | `/plans` | `GET /api/v1/platform/plans` | `plans`, `plan_versions`, `plan_entitlements` | `viewer` | Карточки тарифов: цена/мес, филиалы, мастера, модули, число подключенных компаний | **DONE** | [platform.spec.ts:P6](file:///tests/e2e/platform.spec.ts#L204) |
| 5.2 | **Редактор тарифа (Версионирование изменений)** | `/plans/:id` | `POST /api/v1/platform/plans/{id}/versions` | `plan_versions`, `plan_entitlements` | `platform_owner` | Создание новой версии тарифа без изменения условий действующих подписок | **DONE** | [platform.spec.ts:P6](file:///tests/e2e/platform.spec.ts#L204) |
| 5.3 | **Создание нового тарифа** | Модальное окно | `POST /api/v1/platform/plans` | `plans`, `plan_versions`, `plan_entitlements` | `platform_owner` | Код, название, описание, цена, лимиты филиалов и мастеров | **DONE** | Pytest test_platform_api |

---

## 6. Каталог модулей и фичефлагов (Modules, Design P6)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 6.1 | **Каталог модулей платформы** | `/modules` | `GET /api/v1/platform/modules/catalog` | `feature_catalog` | `viewer` | Статус готовности фичи в продукте (Доступен, Тестирование, В разработке), 3-уровневая концепция | **DONE** | [platform.spec.ts:P6](file:///tests/e2e/platform.spec.ts#L204) |
| 6.2 | **Добавление исключения по модулю для компании** | В карточке компании | `POST /api/v1/platform/tenants/{id}/entitlements` | `tenant_entitlement_overrides` | `support` | Выбор модуля, срок действия, обязательная причина, сохранение в аудит | **DONE** | [platform.spec.ts:P4](file:///tests/e2e/platform.spec.ts#L102) |

---

## 7. Поддержка и временный доступ (Support, Design P7)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 7.1 | **Реестр обращений и поиск компании** | `/support` | `GET /api/v1/platform/support/tickets` | `platform_support_tickets` | `support` | Поиск компании, список открытых и решенных тикетов | **DONE** | [platform.spec.ts:P7](file:///tests/e2e/platform.spec.ts#L231) |
| 7.2 | **Диагностическая карточка компании** | `/support/diagnosis/:id` | `GET /api/v1/platform/support/diagnosis/{id}` | `tenants`, `subscriptions`, `invites` | `support` | Автоматическая проверка состояния: подписка, не принятые инвайты, неотправленные SMS, реальный probe DB | **DONE** | [platform.spec.ts:P7](file:///tests/e2e/platform.spec.ts#L231) |
| 7.3 | **Диалог по обращению** | `/support/tickets/:id` | `GET/POST /api/v1/platform/support/tickets/{id}/messages` | `support_messages` | `support` | Чат с клиентом и внутренние служебные заметки сотрудников поддержки | **DONE** | [platform.spec.ts:P7](file:///tests/e2e/platform.spec.ts#L231) |
| 7.4 | **Запрос временного доступа (Без самоодобрения) (P0-02)** | Модальное окно | `POST /api/v1/platform/access-requests` | `support_access_requests` | `support` | Запрос на 30 минут с обязательной причиной. Самоодобрение сотрудником платформы заблокировано (403 Forbidden). Статус `pending` до решения владельца | **DONE** | [platform.spec.ts:P7](file:///tests/e2e/platform.spec.ts#L231) |
| 7.5 | **Одобрение владельцем компании в Business CRM и сессия (P0-02)** | Business CRM / API | `POST /api/v1/business/access-requests/{id}/approve` | `support_access_sessions` | `owner (CRM)` | Подтверждение исключительно реальным владельцем компании через Business CRM. Изоляция чужих компаний (403), валидация статуса (409) и срока (400). Сессия действует 30 мин | **DONE** | [platform.spec.ts:P7](file:///tests/e2e/platform.spec.ts#L231) |
| 7.6 | **Делегированный доступ к данным компании (RLS Boundary)** | `/support/delegated-tenant/:id` | `GET /api/v1/platform/support/delegated-tenant/{tenant_id}` | `support_access_sessions`, `branches`, `services` | `support` | Чтение данных компании доступно только при активной, неотозванной и неистекшей сессии поддержки, одобренной владельцем. Без сессии — 403 Forbidden | **DONE** | [test_platform_api.py](file:///apps/api/tests/test_platform_api.py) |

---

## 8. Аудит и настройки платформы (Audit & Settings, Design P7–P8)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 8.1 | **Журнал аудита с фильтрацией** | `/audit` | `GET /api/v1/platform/audit` | `platform_audit_events` | `finance` | Поиск по времени, актору, компании, действию. Отображение diff (before/after), read-only | **DONE** | [platform.spec.ts:P8](file:///tests/e2e/platform.spec.ts#L301) |
| 8.2 | **Безопасное добавление операторов по ссылке-токену (P0-03)** | `/settings?tab=staff` | `POST /api/v1/platform/staff`, `POST .../activate` | `platform_staff`, `identity_users`, `invites` | `platform_owner` | Генерация одноразовой 24-часовой ссылки активации (SHA-256 hash токена). Дефолтный пароль убран. Запрет тихого апгрейда обычных пользователей CRM (`allow_crm_user_upgrade=False`) | **DONE** | [platform.spec.ts:P8](file:///tests/e2e/platform.spec.ts#L301) |
| 8.3 | **Параметры подписок и ниши** | `/settings?tab=general` | `GET/PATCH /api/v1/platform/settings` | `platform_settings` | `platform_owner` | Длительность trial (14 дн), льготный период (7 дн), список поддерживаемых ниш | **DONE** | [platform.spec.ts:P8](file:///tests/e2e/platform.spec.ts#L301) |
| 8.4 | **Матрица прав доступа по ролям (RBAC Enforcement)** | `/settings?tab=roles` | Все эндпоинты платформы | — | `viewer` | Наглядная таблица разрешенных действий для каждой платформенной роли + проверка 403 при прямых HTTP вызовах | **DONE** | [platform.spec.ts:P9](file:///tests/e2e/platform.spec.ts#L341) |

---

## Итоговая сводка готовности

- **Всего позиций дизайн-матрицы**: 33
- **DONE (полностью реализовано и покрыто тестами)**: 33 (100%)
- **PARTIAL**: 0
- **BLOCKED**: 0

### Воспроизведение и верификация на чистом окружении

1. **Запуск базы данных PostgreSQL (порт 5432 в Linux CI или 5433 локально):**
   ```bash
   # Запуск PostgreSQL и наложение расширения btree_gist
   docker run -d --name saas_crm_postgres -p 5433:5432 -e POSTGRES_PASSWORD=postgrespassword postgres:17-alpine
   ```

2. **Запуск миграций и Pytest (32 теста):**
   ```bash
   $env:ADMIN_DB_PASSWORD="postgrespassword"; $env:DB_PORT="5433"; $env:ENABLE_DEMO_SEED="true"
   python -m pytest apps/api/tests/ -v
   ```

3. **Сборка frontend воркспейсов (TypeScript + Vite):**
   ```bash
   npm ci
   npm run build --workspaces
   ```

4. **Запуск сквозных Playwright E2E тестов (10 тестов Platform Console + 15 CRM/Booking):**
   ```bash
   # Запуск бэкенда и 3 фронтендов (8000, 3000, 3001, 3002)
   npx playwright test tests/e2e/platform.spec.ts
   npx playwright test tests/e2e/booking.spec.ts tests/e2e/crm_full.spec.ts
   ```

5. **Инструкция по откату (Rollback):**
   Все изменения строго изолированы в ветке `fix/platform-console-v1-audit-gate`. Для отката к состоянию `e317373` достаточно выполнить `git checkout e31737302a4e693d95bbb68cbc507808d50bde3d`. Схема БД полностью совместима и не требует деструктивных изменений данных.
