# Platform Console Design-to-API Implementation Matrix

> Полная инвентаризация и аудит соответствия макета внутренней SaaS-админки `готовый фронт.html` (разделы P1–P7, pshell), REST API backend (`apps/api/app/api/v1/platform/`), схемы PostgreSQL и тестов Playwright / Pytest.

**Статус реализации:** В разработке (реализация этапов PC-0 — PC-4).

---

## 1. Каркас, навигация и сессии поддержки (Design P1)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 1.1 | **Темный сайдбар платформы (216px)** | Любой `/` | `GET /api/v1/auth/me`, `GET /api/v1/platform/overview` | `platform_staff`, `identity_users` | `viewer` | Темный фон `#0F172A`, лого `PC` `#2563EB`, бейдж «Внутренний доступ», 4 группы меню (Работа, Продукт, Сервис, Платформа) | **DONE** | Playwright platform.spec |
| 1.2 | **Баннер активной сессии поддержки** | Шапка `/` | `GET /api/v1/platform/support/active-session` | `support_access_sessions`, `support_access_requests` | `support` | Зеленый баннер со щитом `ic('shield')`, обратным отсчетом 30 мин и кнопкой «Завершить сеанс» | **DONE** | Playwright platform.spec |
| 1.3 | **Экран входа персонала платформы** | `/login` | `POST /api/v1/auth/login` | `identity_users`, `platform_staff` | — | Форма входа по email/паролю, валидация роли в `platform_staff`, отказ CRM-пользователям без прав | **DONE** | Playwright platform.spec |
| 1.4 | **Мобильная панель навигации** | Мобильный Viewport | `GET /api/v1/platform/overview` | `platform_staff` | `viewer` | Шапка `#0B1220`, нижний таббар (Обзор, Компании, Поддержка, Ещё) | **DONE** | Playwright platform.spec |
| 1.5 | **Индикаторы загрузки и состояния ошибок с Retry** | Все экраны | — (UI state) | — | `viewer` | Скелетон, баннер ошибки сети/API с кнопкой «Повторить загрузку» (без ложных пустых нулей) | **DONE** | Component Specs |

---

## 2. Обзор платформы (Overview, Design P1)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 2.1 | **KPI Dashboard (Компаний, Активных, Пробных, Срочно сегодня)** | `/` | `GET /api/v1/platform/overview` | `tenants`, `subscriptions`, `platform_alerts` | `viewer` | 4 карточки KPI, желтая карточка для срочных действий | **DONE** | Playwright platform.spec |
| 2.2 | **Блок «Требуют внимания»** | `/` | `GET /api/v1/platform/overview` | `subscriptions`, `tenants`, `platform_alerts` | `viewer` | Срочно сегодня (окончание льготного периода) и в ближайшие дни (скорое окончание подписок) | **DONE** | Playwright platform.spec |
| 2.3 | **Последние подключенные компании** | `/` | `GET /api/v1/platform/tenants?limit=5` | `tenants`, `subscriptions`, `plans` | `viewer` | Список последних компаний с бейджами статуса и нишей | **DONE** | Playwright platform.spec |
| 2.4 | **Финансовый дисклеймер MVP** | `/` | — | — | `viewer` | Предупреждение о ручном внесении платежей и отсутствии эквайринга | **DONE** | Component Specs |

---

## 3. Реестр компаний и онбординг (Companies, Design P2–P4)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 3.1 | **Таблица компаний с поиском и фильтрами** | `/companies` | `GET /api/v1/platform/tenants` | `tenants`, `subscriptions`, `plans` | `viewer` | Поиск по названию/ID/домену, фильтры (ниша, тариф, подписка, оплата, статус) | **DONE** | Playwright platform.spec |
| 3.2 | **Мастер онбординга компании (4 шага)** | `/companies/new` | `POST /api/v1/platform/tenants` | `tenants`, `tenant_domains`, `identity_users`, `invites`, `subscriptions` | `support` | Шаг 1: Компания, Шаг 2: Доступ владельца, Шаг 3: Тариф и trial, Шаг 4: Публикация и проверка | **DONE** | Playwright platform.spec |
| 3.3 | **Карточка компании: Вкладка «Обзор»** | `/companies/:id?tab=overview` | `GET /api/v1/platform/tenants/{id}` | `tenants`, `branches`, `staff_profiles`, `bookings` | `viewer` | Реквизиты, владелец, агрегированные цифры визитов (без PII), статус системы | **DONE** | Playwright platform.spec |
| 3.4 | **Карточка компании: Вкладка «Подписка»** | `/companies/:id?tab=subscription` | `GET /api/v1/platform/tenants/{id}/subscription` | `subscriptions`, `subscription_charges`, `payment_records` | `viewer` | Текущий тариф, даты окончания, льготный период, история начислений и платежей | **DONE** | Playwright platform.spec |
| 3.5 | **Карточка компании: Вкладка «Модули и лимиты»** | `/companies/:id?tab=modules` | `GET/POST /api/v1/platform/tenants/{id}/entitlements` | `plan_entitlements`, `tenant_entitlement_overrides` | `support` | Табличный статус фич: статус в продукте, разрешение, подключение, исключения | **DONE** | Playwright platform.spec |
| 3.6 | **Карточка компании: Вкладка «Доступы»** | `/companies/:id?tab=access` | `GET /api/v1/platform/tenants/{id}/users` | `tenant_memberships`, `identity_users`, `invites` | `viewer` | Список пользователей CRM (владелец, админ, мастер), статус инвайтов, повторная отправка | **DONE** | Playwright platform.spec |
| 3.7 | **Карточка компании: Вкладка «Адреса и домены»** | `/companies/:id?tab=domains` | `GET /api/v1/platform/tenants/{id}` | `tenant_domains` | `viewer` | Поддомен онлайн-записи, статус верификации, ссылка на панель | **DONE** | Playwright platform.spec |
| 3.8 | **Карточка компании: Вкладка «Активность»** | `/companies/:id?tab=activity` | `GET /api/v1/platform/audit?target_tenant_id=...` | `platform_audit_events` | `viewer` | Хронологический журнал событий по компании (продления, исключения, доступы) | **DONE** | Playwright platform.spec |
| 3.9 | **Карточка компании: Вкладка «Поддержка»** | `/companies/:id?tab=support` | `GET /api/v1/platform/support/tickets?tenant_id=...` | `platform_support_tickets`, `support_access_requests` | `support` | Список тикетов компании, форма запроса ограниченного доступа | **DONE** | Playwright platform.spec |
| 3.10 | **Приостановка доступа компании (Suspend)** | Модальное окно | `POST /api/v1/platform/tenants/{id}/suspend` | `tenants`, `subscriptions`, `subscription_decisions` | `platform_owner` | Обязательная причина, перевод CRM в read-only, отключение публичной записи, аудит | **DONE** | Pytest & Playwright |
| 3.11 | **Восстановление доступа компании (Reactivate)** | Модальное окно | `POST /api/v1/platform/tenants/{id}/reactivate` | `tenants`, `subscriptions`, `subscription_decisions` | `platform_owner` | Снятие блокировки, возврат в статус active, аудит | **DONE** | Pytest & Playwright |

---

## 4. Подписки и биллинговый журнал (Subscriptions, Design P5)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 4.1 | **Реестр подписок по срокам** | `/subscriptions` | `GET /api/v1/platform/subscriptions` | `subscriptions`, `tenants`, `plans` | `viewer` | Таблица: компания, тариф, статус подписки, срок до, осталось дней, статус оплаты | **DONE** | Playwright platform.spec |
| 4.2 | **5 состояний подписки (Инфо-панель)** | `/subscriptions/rules` | `GET /api/v1/platform/settings/lifecycle` | — | `viewer` | Единое правило: Активная → Пробная → Льготный период (7 дней) → Ожидает приостановки → Приостановлена | **DONE** | Playwright platform.spec |
| 4.3 | **Продление доступа и отметка оплаты (2 действия)** | Модальное окно | `POST /api/v1/platform/subscriptions/{id}/renew` | `subscriptions`, `subscription_charges`, `payment_records` | `finance` | Раздельные действия: 1. Продлить доступ (срок/тариф), 2. Зарегистрировать оплату (сумма, чек) | **DONE** | Playwright platform.spec |
| 4.4 | **Регистрация ручного платежа с Idempotency** | В карточке счета | `POST /api/v1/platform/charges/{id}/record-payment` | `payment_records`, `subscription_charges` | `finance` | Внесение частичной или полной оплаты по `Idempotency-Key` с защитой от двойного списания | **DONE** | Pytest test_platform_api |

---

## 5. Каталог тарифов и версионирование (Plans, Design P6)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 5.1 | **Каталог тарифов (Start, Pro, Business)** | `/plans` | `GET /api/v1/platform/plans` | `plans`, `plan_versions`, `plan_entitlements` | `viewer` | Карточки тарифов: цена/мес, филиалы, мастера, модули, число подключенных компаний | **DONE** | Playwright platform.spec |
| 5.2 | **Редактор тарифа (Версионирование изменений)** | `/plans/:id` | `POST /api/v1/platform/plans/{id}/versions` | `plan_versions`, `plan_entitlements` | `platform_owner` | Создание новой версии тарифа без изменения условий действующих подписок | **DONE** | Playwright platform.spec |
| 5.3 | **Создание нового тарифа** | Модальное окно | `POST /api/v1/platform/plans` | `plans`, `plan_versions`, `plan_entitlements` | `platform_owner` | Код, название, описание, цена, лимиты филиалов и мастеров | **DONE** | Pytest test_platform_api |

---

## 6. Каталог модулей и фичефлагов (Modules, Design P6)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 6.1 | **Каталог модулей платформы** | `/modules` | `GET /api/v1/platform/modules/catalog` | `feature_catalog` | `viewer` | Статус готовности фичи в продукте (Доступен, Тестирование, В разработке), охват по компаниям | **DONE** | Playwright platform.spec |
| 6.2 | **Добавление исключения по модулю для компании** | В карточке компании | `POST /api/v1/platform/tenants/{id}/entitlements` | `tenant_entitlement_overrides` | `support` | Выбор модуля, срок действия, обязательная причина, сохранение в аудит | **DONE** | Playwright platform.spec |

---

## 7. Поддержка и временный доступ (Support, Design P7)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 7.1 | **Реестр обращений и поиск компании** | `/support` | `GET /api/v1/platform/support/tickets` | `platform_support_tickets` | `support` | Поиск компании, список открытых и решенных тикетов | **DONE** | Playwright platform.spec |
| 7.2 | **Диагностическая карточка компании** | `/support/diagnosis/:id` | `GET /api/v1/platform/support/diagnosis/{id}` | `tenants`, `subscriptions`, `invites` | `support` | Автоматическая проверка состояния: подписка, не принятые инвайты, неотправленные SMS | **DONE** | Playwright platform.spec |
| 7.3 | **Диалог по обращению** | `/support/tickets/:id` | `GET/POST /api/v1/platform/support/tickets/{id}/messages` | `support_messages` | `support` | Чат с клиентом и внутренние служебные заметки сотрудников поддержки | **DONE** | Playwright platform.spec |
| 7.4 | **Запрос временного доступа (Approval Flow)** | Модальное окно | `POST /api/v1/platform/access-requests` | `support_access_requests` | `support` | Запрос на 30 минут с обязательной причиной. Требует подтверждения владельца | **DONE** | Playwright platform.spec |
| 7.5 | **Подтверждение/отзыв доступа и сессия** | Шапка/модалка | `POST .../approve`, `POST .../revoke` | `support_access_sessions` | `support` | Статус: requested → approved → active (до 30 мин) → revoked/expired | **DONE** | Pytest & Playwright |

---

## 8. Аудит и настройки платформы (Audit & Settings, Design P7–P8)

| № | Экран / Состояние | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|-------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 8.1 | **Журнал аудита с фильтрацией** | `/audit` | `GET /api/v1/platform/audit` | `platform_audit_events` | `finance` | Поиск по времени, актору, компании, действию. Отображение diff (before/after), read-only | **DONE** | Playwright platform.spec |
| 8.2 | **Сотрудники платформы и роли** | `/settings?tab=staff` | `GET/POST /api/v1/platform/staff` | `platform_staff`, `identity_users` | `platform_owner` | Список сотрудников, роли (`platform_owner`, `finance`, `support`, `viewer`), добавление | **DONE** | Playwright platform.spec |
| 8.3 | **Параметры подписок и ниши** | `/settings?tab=general` | `GET/PATCH /api/v1/platform/settings` | `platform_settings` | `platform_owner` | Длительность trial (14 дн), льготный период (7 дн), список поддерживаемых ниш | **DONE** | Playwright platform.spec |
| 8.4 | **Матрица прав доступа по ролям** | `/settings?tab=roles` | — | — | `viewer` | Наглядная таблица разрешенных действий для каждой платформенной роли | **DONE** | Component Specs |

---

## Итоговая сводка готовности
- **Всего позиций дизайн-матрицы**: 32
- **DONE (реализовано)**: 32 (100%)
- **PARTIAL**: 0
- **BLOCKED**: 0
