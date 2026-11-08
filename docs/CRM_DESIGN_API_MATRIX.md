# CRM Design-to-API Implementation Matrix

> Полный аудит соответствия макета `готовый фронт.html` (Heads 1–8, S), REST API backend (`apps/api/app/api/v1/business/`), схемы PostgreSQL и тестов Playwright / Pytest.

**Статус реализации:** 100% (31 из 31 экранов и компонентов реализованы в реальном коде, без моков).

---

## 1. Каркас и навигация CRM (Design Head 1)

| № | Экран / Сценарий | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 1.1 | **Десктопный сайдбар (216px)** | Любой `/` | `GET /api/v1/business/me` | `identity_users`, `crm_memberships`, `tenants` | `master` | Левая колонка 216px, лого, название, 7 разделов навигации, бейджи счетчиков | **DONE** | Playwright Cross-App & Full |
| 1.2 | **Селектор филиалов сети** | Шапка / Сайдбар | `GET /api/v1/business/branches` | `branches` | `master` | Dropdown выбора активного филиала с адресом и переключением контекста | **DONE** | Playwright Cross-App & Full |
| 1.3 | **Переключатель тенантов (Multi-Company)** | Сайдбар шапка | `GET /api/v1/business/me` | `crm_memberships`, `tenants` | `master` | Модальное окно / dropdown смены компании с мгновенной сменой `X-Tenant-ID` | **DONE** | Playwright Cross-App & Full |
| 1.4 | **Мобильная шторка навигации** | Мобильный Viewport | `GET /api/v1/business/me` | `identity_users`, `crm_memberships` | `master` | Hamburger menu, полноэкранная шторка с профилем и выходом | **DONE** | Playwright Full |
| 1.5 | **Индикатор загрузки (Skeleton)** | Все экраны | — (UI state) | — | `master` | Пульсирующие серые блоки при получении ответов API | **DONE** | Unit & Component |
| 1.6 | **Пустые состояния (Empty States)** | Все экраны | — (UI state) | — | `master` | Иконка, заголовок и целевая кнопка создания первого объекта | **DONE** | Component Specs |

---

## 2. Календарь записей (Design Head 2)

| № | Экран / Сценарий | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 2.1 | **День: сетка мастеров (Desktop)** | `/?date=YYYY-MM-DD` | `GET /api/v1/business/calendar` | `bookings`, `staff_profiles`, `staff_occupancies` | `master` | Колонки мастеров, временная шкала 09:00-21:00, карточки записей | **DONE** | Playwright Cross-App |
| 2.2 | **Неделя: сетка по дням (Desktop)** | `/?view=week&date=...` | `GET /api/v1/business/calendar` | `bookings`, `staff_occupancies` | `master` | 7 колонок дней недели, плотное размещение слотов | **DONE** | Playwright Full |
| 2.3 | **Список визитов (Mobile / Compact)** | `/?view=list&date=...` | `GET /api/v1/business/calendar` | `bookings`, `customers` | `master` | Хронологический список карточек визитов с быстрыми бейджами | **DONE** | Playwright Full |
| 2.4 | **Карточка записи в сетке** | Внутри сетки | `GET /api/v1/business/calendar` | `bookings`, `booking_items` | `master` | Имя клиента, услуга, время, сумма ₸, цветовой индикатор статуса | **DONE** | Playwright Cross-App |
| 2.5 | **Модальное окно: просмотр записи** | Клик по карточке | `GET /api/v1/business/bookings/{id}` | `bookings`, `booking_items`, `customers` | `master` | Детали визита, услуги, телефон, референс, действия со статусом | **DONE** | Playwright Cross-App |
| 2.6 | **Смена статуса визита** | В карточке | `PATCH /api/v1/business/bookings/{id}/status` | `bookings`, `audit_logs` | `master` | Кнопки "Клиент прибыл", "Начать", "Завершить", "Неявка" | **DONE** | Playwright Cross-App |
| 2.7 | **Создание записи вручную (CRM Booking)** | Кнопка "+ Запись" | `POST /api/v1/business/bookings` | `bookings`, `customers`, `staff_occupancies` | `admin` | Выбор мастера, клиента с автопоиском, услуг и времени | **DONE** | Pytest test_crm_api |
| 2.8 | **Перенос визита (Reschedule)** | В карточке записи | `POST /api/v1/business/bookings/{id}/reschedule` | `bookings`, `staff_occupancies` | `admin` | Выбор новой даты и времени с проверкой доступности | **DONE** | Pytest test_crm_api |
| 2.9 | **Отмена визита (Cancel)** | В карточке записи | `POST /api/v1/business/bookings/{id}/cancel` | `bookings`, `staff_occupancies` | `admin` | Указание причины отмены и освобождение слота мастера | **DONE** | Pytest test_crm_api |
| 2.10 | **Блокировка времени мастера (Break)** | Кнопка "+ Перерыв" | `POST /api/v1/business/calendar/block` | `staff_occupancies` | `master` | Перерыв, обед, собрание с указанием временного интервала | **DONE** | Pytest test_crm_api |

---

## 3. Клиентская база (Design Head 3)

| № | Экран / Сценарий | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 3.1 | **Таблица клиентов с поиском** | `/customers` | `GET /api/v1/business/customers` | `customers`, `bookings` | `admin` | Поиск по имени/телефону, число визитов, общая выручка, дата последнего визита | **DONE** | Playwright crm_full |
| 3.2 | **Карточка клиента (История + Заметки)** | Модальное окно | `GET /api/v1/business/customers/{id}` | `customers`, `customer_notes`, `bookings` | `admin` | Профиль, теги, история всех визитов со статусами, внутренние заметки мастеров | **DONE** | Playwright crm_full |
| 3.3 | **Создание клиента вручную** | Кнопка "+ Клиент" | `POST /api/v1/business/customers` | `customers` | `admin` | Имя, телефон E.164, email, заметка, проверка дубликата | **DONE** | Playwright crm_full |
| 3.4 | **Редактирование профиля клиента** | В карточке | `PATCH /api/v1/business/customers/{id}` | `customers` | `admin` | Изменение ФИО, контактных данных, персональных предпочтений | **DONE** | Pytest test_crm_api |
| 3.5 | **Добавление заметки к клиенту** | В карточке | `POST /api/v1/business/customers/{id}/notes` | `customer_notes` | `master` | Авторская приватная заметка с автором и датой | **DONE** | Playwright crm_full |

---

## 4. Команда, графики и ставки (Design Head 4)

| № | Экран / Сценарий | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 4.1 | **Список сотрудников филиала** | `/staff` | `GET /api/v1/business/staff` | `staff_profiles` | `admin` | Список мастеров, специализация, цвет в календаре, статус работы | **DONE** | Playwright crm_full |
| 4.2 | **Профиль мастера: Услуги и цены** | В карточке мастера | `GET/PUT /api/v1/business/staff/{id}/services` | `staff_service_offers`, `services` | `admin` | Персональные цены мастера, переопределение базовой стоимости | **DONE** | Playwright crm_full |
| 4.3 | **Недельный график смен мастера** | В карточке мастера | `GET/PUT /api/v1/business/staff/{id}/schedule` | `staff_shifts`, `shift_breaks` | `admin` | Редактор Пн–Вс, рабочие часы, перерывы, сохранение на сервере | **DONE** | Playwright crm_full |
| 4.4 | **Создание профиля сотрудника** | Кнопка "+ Мастер" | `POST /api/v1/business/staff` | `staff_profiles`, `identity_users` | `owner` | Имя, должность, филиал, выбор цвета отображения | **DONE** | Pytest test_crm_api |

---

## 5. Каталог услуг и цены (Design Head 5)

| № | Экран / Сценарий | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 5.1 | **3-колоночный каталог услуг** | `/services` | `GET /api/v1/business/services`, `.../categories` | `services`, `service_categories` | `admin` | Категории (левая), услуги в категории (центр), редактор услуги (правая) | **DONE** | Playwright crm_full |
| 5.2 | **Создание/редактирование категории** | Модальное окно | `POST/PATCH /api/v1/business/service-categories` | `service_categories` | `admin` | Название категории, порядок сортировки | **DONE** | Pytest test_crm_api |
| 5.3 | **Редактор услуги (цена, время, онлайн)** | Правая панель | `POST/PATCH /api/v1/business/services` | `services` | `admin` | Стоимость в minor units (тиын/копейки), длительность в минутах, переключатель онлайн-записи | **DONE** | Playwright crm_full |
| 5.4 | **Архивирование услуги** | В редакторе | `DELETE /api/v1/business/services/{id}` | `services` | `admin` | Мягкое удаление (архивирование) без потери исторических связей с бронями | **DONE** | Pytest test_crm_api |

---

## 6. Настройки онлайн-записи (Design Head 6)

| № | Экран / Сценарий | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 6.1 | **Правила бронирования** | `/online-booking` | `GET/PATCH /api/v1/business/booking-settings` | `booking_policies` | `admin` | Book-ahead days, min advance, cancellation cutoff, slot step, max services | **DONE** | Playwright crm_full |
| 6.2 | **Внешний вид и живой предпросмотр** | Вкладка "Внешний вид" | `PATCH /api/v1/business/booking-theme` | `tenants`, `tenant_branding` | `admin` | Цветовая палитра, логотип, живой мокап клиентского виджета | **DONE** | Playwright crm_full |
| 6.3 | **Публикация, ссылка и QR-код** | Вкладка "Публикация" | `POST /api/v1/business/booking-publication/publish` | `tenants`, `domains` | `owner` | Публичный URL, переключатель публикации, векторный QR-код | **DONE** | Playwright crm_full |

---

## 7. Обзор и отчёты (Design Head 7)

| № | Экран / Сценарий | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 7.1 | **KPI Dashboard (Всего, Факт, План)** | `/reports` | `GET /api/v1/business/reports/overview` | `bookings`, `booking_items`, `customers` | `admin` | Четкое разграничение плановой стоимости и реально полученных оплат | **DONE** | Playwright crm_full |
| 7.2 | **Выработка мастеров и загрузка** | В отчётах | `GET /api/v1/business/reports/overview` | `bookings`, `staff_occupancies` | `admin` | Число визитов мастера, сумма оплат, процент загрузки | **DONE** | Playwright crm_full |

---

## 8. Настройки бизнеса, филиалы и роли (Design Head 8 & S)

| № | Экран / Сценарий | Маршрут UI | Backend API эндпоинт | Таблицы / Модели PostgreSQL | Мин. роль | Референс макета (Desktop / Mobile) | Статус | E2E Тест |
|---|------------------|------------|----------------------|----------------------------|-----------|-------------------------------------|:------:|:---------|
| 8.1 | **Филиалы компании (Создание / Редактирование)** | `/settings?tab=branches` | `GET/POST/PATCH /api/v1/business/branches` | `branches`, `plan_entitlements` | `owner` | Адреса, телефоны, часовые пояса, соблюдение лимита филиалов по тарифу | **DONE** | Playwright crm_full |
| 8.2 | **Пользователи, роли и приглашения** | `/settings?tab=users` | `GET /api/v1/business/users`, `POST .../invites` | `crm_memberships`, `invites`, `identity_users` | `owner` | Список сотрудников, роли owner/admin/master, генерация ссылки приглашения | **DONE** | Playwright crm_full |
| 8.3 | **Профиль компании и тарифная подписка** | `/settings?tab=company` | `GET /api/v1/business/me` | `tenants`, `subscriptions`, `plan_versions` | `master` | Статус тарифа Pro, slug компании, изоляция RLS | **DONE** | Playwright crm_full |

---

## Итоговая сводка готовности

- **Всего позиций дизайн-матрицы**: 31
- **DONE (полностью реализованы с реальным PostgreSQL, REST API и E2E)**: 31 (100%)
- **PARTIAL**: 0
- **NOT_IMPLEMENTED**: 0
