# CRM Role & Permission Matrix (RBAC + Tenant Isolation)

> Архитектурная матрица разграничения доступа для многопользовательской SaaS-платформы.

## 1. Контекст ролей в системе

1. **Owner (`owner`)**:
   - Владелец зарегистрированного бизнеса (организации).
   - Обладает полным контролем над компанией: управление подпиской и тарифом, филиалами, правами управляющих, приглашением сотрудников, финансовой аналитикой и одобрением запросов технической поддержки.
2. **Admin (`admin`)**:
   - Управляющий бизнесом / администратор филиала.
   - Управляет операционной деятельностью: журнал бронирований, клиентская база, каталог услуг, графики смен специалистов, правила онлайн-записи и операционные отчеты.
3. **Master (`master`)**:
   - Мастер / специалист (барбер, стилист).
   - Имеет доступ к личному кабинету: персональный календарь, просмотр назначенных визитов, отметка прибытия и завершения визитов своих клиентов, добавление внутренних заметок к визитам, просмотр персонального графика. Чужие клиенты, финансовая отчетность компании и управление тарифами/филиалами строго запрещены (HTTP 403 Forbidden).
4. **Platform Console (`platform_admin`)**:
   - Специалисты платформы (отдельный контур `apps/platform-console`).
   - Изолированы от клиентских данных компаний; доступ к данным тенанта возможен **только** по явному временному согласию владельца (Support Consent Session, максимум 30 минут, с аудитом).

---

## 2. Матрица разрешений по модулям и операциям

| Модуль / Операция | HTTP Метод / Ресурс | Owner | Admin | Master | Тест защиты (Pytest / E2E) |
|---|---|:---:|:---:|:---:|---|
| **Календарь: просмотр визитов** | `GET /api/v1/business/calendar` | ✅ | ✅ | ✅ (свои) | Pytest `test_crm_api` |
| **Календарь: отметка статуса визита** | `PATCH /api/v1/business/bookings/{id}/status` | ✅ | ✅ | ✅ | Playwright `booking.spec.ts` |
| **Календарь: ручное создание записи** | `POST /api/v1/business/bookings` | ✅ | ✅ | ❌ | Pytest `test_roles_permissions` |
| **Календарь: перенос визита** | `POST /api/v1/business/bookings/{id}/reschedule` | ✅ | ✅ | ❌ | Pytest `test_crm_api` |
| **Календарь: отмена визита** | `POST /api/v1/business/bookings/{id}/cancel` | ✅ | ✅ | ❌ | Pytest `test_crm_api` |
| **Календарь: личный перерыв мастера** | `POST /api/v1/business/calendar/block` | ✅ | ✅ | ✅ | Pytest `test_crm_api` |
| **Клиенты: поиск и база** | `GET /api/v1/business/customers` | ✅ | ✅ | ❌ (read-only свои) | Playwright `crm_full.spec.ts` |
| **Клиенты: создание клиента** | `POST /api/v1/business/customers` | ✅ | ✅ | ❌ | Playwright `crm_full.spec.ts` |
| **Клиенты: редактирование профиля** | `PATCH /api/v1/business/customers/{id}` | ✅ | ✅ | ❌ | Pytest `test_crm_api` |
| **Клиенты: добавление приватной заметки** | `POST /api/v1/business/customers/{id}/notes` | ✅ | ✅ | ✅ | Playwright `crm_full.spec.ts` |
| **Команда: список сотрудников** | `GET /api/v1/business/staff` | ✅ | ✅ | ✅ | Playwright `crm_full.spec.ts` |
| **Команда: создание профиля мастера** | `POST /api/v1/business/staff` | ✅ | ❌ | ❌ | Pytest `test_crm_api` |
| **Команда: переопределение цен мастера** | `PUT /api/v1/business/staff/{id}/services` | ✅ | ✅ | ❌ | Playwright `crm_full.spec.ts` |
| **Команда: недельный график смен** | `PUT /api/v1/business/staff/{id}/schedule` | ✅ | ✅ | ❌ | Playwright `crm_full.spec.ts` |
| **Услуги: просмотр каталога** | `GET /api/v1/business/services` | ✅ | ✅ | ✅ | Playwright `crm_full.spec.ts` |
| **Услуги: создание / редактирование** | `POST/PATCH /api/v1/business/services` | ✅ | ✅ | ❌ | Playwright `crm_full.spec.ts` |
| **Услуги: архивация (soft delete)** | `DELETE /api/v1/business/services/{id}` | ✅ | ✅ | ❌ | Pytest `test_crm_api` |
| **Категории услуг: управление** | `POST/PATCH .../service-categories` | ✅ | ✅ | ❌ | Pytest `test_crm_api` |
| **Онлайн-запись: правила бронирования** | `PATCH /api/v1/business/booking-settings` | ✅ | ✅ | ❌ | Playwright `crm_full.spec.ts` |
| **Онлайн-запись: брендинг и тема** | `PATCH /api/v1/business/booking-theme` | ✅ | ✅ | ❌ | Playwright `crm_full.spec.ts` |
| **Онлайн-запись: публикация / пауза** | `POST .../booking-publication/publish` | ✅ | ❌ | ❌ | Playwright `crm_full.spec.ts` |
| **Отчёты: финансовая аналитика** | `GET /api/v1/business/reports/overview` | ✅ | ✅ | ❌ **(403)** | Pytest `test_audit_security_gates` (Damir 403) |
| **Филиалы: список филиалов** | `GET /api/v1/business/branches` | ✅ | ✅ | ✅ | Playwright `crm_full.spec.ts` |
| **Филиалы: добавление / ред.** | `POST/PATCH /api/v1/business/branches` | ✅ | ❌ | ❌ | Pytest `test_crm_api` |
| **Пользователи: список членов команды** | `GET /api/v1/business/users` | ✅ | ✅ | ❌ | Playwright `crm_full.spec.ts` |
| **Пользователи: отправка приглашений** | `POST /api/v1/business/invites` | ✅ | ✅ | ❌ | Pytest `test_crm_api` |
| **Поддержка: одобрение доступа support** | `POST .../access-requests/{id}/approve` | ✅ | ❌ | ❌ | Pytest `test_audit_security_gates` |

---

## 3. Гарантии изоляции на уровне БД (PostgreSQL Row Level Security)

1. Для всех 16 tenant-owned таблиц включены:
   - `ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;`
   - `ALTER TABLE <table_name> FORCE ROW LEVEL SECURITY;`
2. Политика изоляции проверяет сессионную переменную `app.current_tenant_id`:
   ```sql
   CREATE POLICY <table_name>_tenant_isolation ON <table_name>
   FOR ALL
   USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
   ```
3. Приложение подключается под не-суперпользователем `crm_app_user`, что исключает обход RLS.
4. Попытка запроса данных чужого тенанта или передача сущностей чужого тенанта блокируется как на уровне приложения (`403 Forbidden` / `404 Not Found`), так и на уровне базы данных (`test_strict_rls_tenant_isolation` и `test_cross_tenant_foreign_key_prevention`).
