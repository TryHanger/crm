# Матрица соответствия экранов HTML-прототипа и API Backend (COVERAGE_MATRIX.md)

В данном документе приведено сопоставление всех 18 ключевых экранов и блоков интерактивного прототипа `платформа саас.html` с реализованными REST API эндпоинтами, моделями данных и статусом готовности backend.

---

### 1. Клиентская онлайн-запись (Public Booking Widget)

| № | Экран прототипа | Метод и URI эндпоинта | Модели данных | Статус Backend |
|---|---|---|---|---|
| **P1** | Шапка и брендинг филиала (Логотип, цвета, адрес, телефон) | `GET /api/v1/public/site` | `TenantDomain`, `TenantSettings`, `BookingTheme`, `BookingPolicy` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **P2** | Выбор филиала компании | `GET /api/v1/public/branches` | `Branch` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **P3** | Каталог услуг по категориям и корзина | `GET /api/v1/public/services` | `ServiceCategory`, `Service` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **P4** | Выбор мастера (с фильтрацией по корзине услуг) | `GET /api/v1/public/staff` | `StaffProfile`, `StaffBranch`, `StaffServiceOffer` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **P5** | Поиск свободных слотов и расчет стоимости | `POST /api/v1/public/availability` | `BookingEngine`, `WeeklyShift`, `ShiftBreak`, `StaffOccupancy` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **P6** | Оформление записи (контакты клиента, Idempotency) | `POST /api/v1/public/bookings` | `Booking`, `BookingItem`, `StaffOccupancy`, `Customer` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **P7** | Экран управления бронированием (по opaque-токену) | `GET /api/v1/public/bookings/manage/{token}` | `PublicManagementToken`, `Booking`, `Customer` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **P8** | Перенос времени записи клиентом | `POST /api/v1/public/bookings/manage/{token}/reschedule` | `Booking`, `StaffOccupancy`, `BookingPolicy` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **P9** | Самостоятельная отмена записи клиентом | `POST /api/v1/public/bookings/manage/{token}/cancel` | `Booking`, `StaffOccupancy`, `BookingEvent` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |

---

### 2. CRM компании (Business CRM Dashboard)

| № | Экран прототипа | Метод и URI эндпоинта | Модели данных | Статус Backend |
|---|---|---|---|---|
| **C1** | Авторизация сотрудника компании | `POST /api/v1/auth/login` | `IdentityUser`, `TenantMembership` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C2** | Интерактивный календарь записей (сетка дня/мастеров) | `GET /api/v1/business/calendar` | `Booking`, `StaffProfile`, `WeeklyShift`, `CalendarBlock` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C3** | Карточка записи (детали, услуги, история статусов) | `GET /api/v1/business/bookings/{id}` | `Booking`, `BookingItem`, `Customer`, `BookingEvent` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C4** | Быстрое изменение статуса (визит, в работе, завершен) | `PATCH /api/v1/business/bookings/{id}/status` | `Booking`, `StaffOccupancy`, `BookingEvent` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C5** | Создание ручной записи сотрудником | `POST /api/v1/business/bookings` | `BookingEngine`, `Customer`, `StaffOccupancy` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C6** | Перенос и отмена записи из CRM | `POST /api/v1/business/bookings/{id}/reschedule`, `.../cancel` | `BookingEngine`, `BookingPolicy` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C7** | Блокировка времени мастера (перерыв/личные дела) | `POST /api/v1/business/calendar-blocks`, `DELETE .../{id}` | `CalendarBlock`, `StaffOccupancy` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C8** | База клиентов и история визитов | `GET /api/v1/business/customers` | `Customer`, `Booking` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C9** | Управление филиалами (с проверкой лимита тарифа) | `GET/POST /api/v1/business/branches` | `Branch`, `PlanEntitlement` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C10** | Управление каталогом услуг и цен | `GET/POST /api/v1/business/services` | `Service`, `ServiceCategory` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C11** | Управление командой и графиками смен | `GET/POST /api/v1/business/staff` | `StaffProfile`, `StaffBranch`, `WeeklyShift`, `ShiftBreak` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **C12** | Аналитика и финансовый отчет компании | `GET /api/v1/business/reports/overview` | `Booking`, `PaymentRecord` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |

---

### 3. Консоль платформы (Platform Console)

| № | Экран прототипа | Метод и URI эндпоинта | Модели данных | Статус Backend |
|---|---|---|---|---|
| **A1** | Сводный дашборд платформы (MRR, тенанты, визиты) | `GET /api/v1/platform/overview` | `Tenant`, `Subscription`, `Booking` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **A2** | Список компаний и онбординг новой компании | `GET/POST /api/v1/platform/tenants` | `Tenant`, `TenantDomain`, `Subscription`, `TenantMembership` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **A3** | Детальная карточка тенанта и управление подпиской | `GET /api/v1/platform/tenants/{id}` | `Tenant`, `Subscription`, `PlanVersion` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **A4** | Приостановка и возобновление доступа компании | `POST /api/v1/platform/tenants/{id}/suspend`, `.../reactivate` | `Tenant`, `Subscription`, `SubscriptionDecision` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **A5** | Каталог тарифных планов и лимитов | `GET/POST /api/v1/platform/plans` | `Plan`, `PlanVersion`, `PlanEntitlement` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **A6** | Выставление начислений за подписку (Charges) | `POST /api/v1/platform/subscriptions/{id}/charges` | `SubscriptionCharge` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **A7** | Ручная фиксация оплаты по безналу (Payments) | `POST /api/v1/platform/charges/{id}/record-payment` | `PaymentRecord`, `SubscriptionCharge` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
| **A8** | Аудит действий администраторов платформы | `GET /api/v1/platform/audit` | `PlatformAuditEvent` | **ПОЛНОСТЬЮ РЕАЛИЗОВАНО** |
