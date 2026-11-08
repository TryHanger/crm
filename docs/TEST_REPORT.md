# Отчет о прохождении автоматизированного тестирования (TEST_REPORT.md)

## 1. Сводка выполнения тестов
- **Дата и время запуска**: 2026-11-08 (после реализации Gate 0, Gate 1, Booking Web Frontend и Playwright E2E)
- **Платформа**: Windows / PostgreSQL 17 Local Database (Port 5433)
- **Изолированная тестовая БД**: `saas_crm_test` (с проверкой суффикса `_test` и наименьшими привилегиями `crm_app_user`)
- **Среда выполнения Backend**: Python 3.11.6, pytest 8.3.4, pytest-asyncio 1.1.0, anyio 4.6.2, SQLAlchemy 2.0.36, asyncpg 0.30.0
- **Среда выполнения Frontend**: Vite 6.4.5, React 19, TypeScript 5.8, Playwright 1.56.1 (Chromium)
- **Всего pytest тест-кейсов**: 24 (100% PASS)
- **Всего Playwright E2E сценариев**: 3 (100% PASS)
- **Не пройдено / Ошибок**: 0

---

## 2. Результаты Playwright E2E тестирования

| № | E2E Сценарий | Устройство / Разрешение | Результат | Скриншоты и подтвержденные действия |
| :-: | :--- | :--- | :---: | :--- |
| **1** | **Desktop Booking Flow - Barber House** | Desktop (1280x800) | **PASSED (4.7s)** | Резолвинг тенанта по субдомену `barberhouse.localhost:3000`, выбор филиала Астана, выбор услуги «Комплекс: Стрижка + Борода», выбор мастера «Любой свободный мастер», выбор даты (Понедельник) и временного слота, заполнение формы контактов клиента, бронирование с подтверждением (экран успеха #BH-...). Скриншоты `01` - `06`. |
| **2** | **Mobile Booking Flow - Modern Cut** | Mobile Viewport (390x844) | **PASSED (2.7s)** | Резолвинг изолированного тенанта `moderncut.localhost:3000`, мобильная адаптивная верстка, выбор услуги «Стрижка Modern Cut», выбор мастера, выбор слота, заполнение данных клиента, подтверждение записи. Скриншоты `07` - `11`. |
| **3** | **CRM Calendar Flow - Barber House & Modern Cut** | Desktop (1280x800) | **PASSED (2.9s)** | Вход в реальный дашборд CRM `localhost:3001`, отображение сетки мастеров и часов дня, переключение между тенантами Barber House и Modern Cut с полной изоляцией записей. Скриншоты `12` и `13`. |

---

## 3. Детальная таблица Backend pytest тестов (24 кейса)

| № | Тестовый модуль и функция | Направление проверки | Результат |
| :-: | :--- | :--- | :---: |
| **1** | `test_audit_security_gates.py::test_auth_rejection_on_invalid_password` | Gate B: Auth Security & Password Hash | **PASSED** |
| **2** | `test_audit_security_gates.py::test_public_booking_rejection_on_suspended_tenant` | Gate B: Lifecycle Isolation | **PASSED** |
| **3** | `test_audit_security_gates.py::test_public_booking_rejections_past_and_too_soon` | Gate D: Authoritative Engine (Past & Lead Time) | **PASSED** |
| **4** | `test_audit_security_gates.py::test_public_booking_rejections_shift_and_breaks` | Gate D: Working Shifts & Breaks | **PASSED** |
| **5** | `test_audit_security_gates.py::test_master_role_scoping_and_object_permissions` | Gate C: Master Role Scoping & PII Masking | **PASSED** |
| **6** | `test_audit_security_gates.py::test_idempotent_replay_preserves_valid_management_link` | Gate D: Idempotency Replay Link | **PASSED** |
| **7** | `test_audit_security_gates.py::test_tariff_limits_enforced_on_branch_creation` | Gate C: Entitlement Limits Enforcement | **PASSED** |
| **8** | `test_audit_security_gates.py::test_partial_payment_does_not_mark_charge_paid` | Gate A: Billing Ledger Partial Payments | **PASSED** |
| **9** | `test_audit_security_gates.py::test_owner_invite_and_acceptance_flow` | Gate 0: Tenant Owner Invite & Activation Flow | **PASSED** |
| **10** | `test_audit_security_gates.py::test_idempotency_key_reuse_rejection_on_payload_mismatch` | Gate 1: Idempotency Key Reuse Payload Mismatch (409) | **PASSED** |
| **11** | `test_audit_security_gates.py::test_master_cannot_create_booking_for_another_master` | Gate 1: Master Booking Creation Scope | **PASSED** |
| **12** | `test_audit_security_gates.py::test_plans_catalog_api` | Gate 1: Plans Catalog API & Entitlements | **PASSED** |
| **13** | `test_booking_concurrency.py::test_multi_service_duration_and_pricing_snapshot` | Booking Multi-Service Duration & Price Snapshot | **PASSED** |
| **14** | `test_booking_concurrency.py::test_parallel_booking_concurrency_race` | PostgreSQL Exclusion Constraint Concurrency Race | **PASSED** |
| **15** | `test_booking_concurrency.py::test_price_change_returns_quote_changed` | Gate 1: Price Drift Protection (409 QUOTE_CHANGED) | **PASSED** |
| **16** | `test_booking_concurrency.py::test_reschedule_and_cancel_lifecycle` | Booking Lifecycle Machine & Occupancy Release | **PASSED** |
| **17** | `test_crm_api.py::test_crm_calendar_and_master_role_isolation` | CRM Workspace & Calendar Master Scoping | **PASSED** |
| **18** | `test_crm_api.py::test_multi_tenant_calendar_strict_isolation_between_barberhouse_and_moderncut` | Multi-Tenant Calendar Strict Isolation | **PASSED** |
| **19** | `test_platform_api.py::test_platform_console_lifecycle_and_billing` | Platform Console & Ledger | **PASSED** |
| **20** | `test_public_api.py::test_public_site_resolution_and_policies` | Public Domain Resolution & Cancellation Policies | **PASSED** |
| **21** | `test_public_api.py::test_public_booking_flow_and_management` | Public Client Flow & Management Token | **PASSED** |
| **22** | `test_roles_permissions.py::test_role_enforcement_and_permission_boundaries` | RBAC Permissions & Platform Perimeter Protection | **PASSED** |
| **23** | `test_tenant_isolation.py::test_strict_rls_tenant_isolation` | PostgreSQL Row Level Security Isolation | **PASSED** |
| **24** | `test_tenant_isolation.py::test_cross_tenant_foreign_key_prevention` | Database Relational Integrity Across Tenants | **PASSED** |

---

## 4. Фактический лог выполнения pytest
```text
============================= test session starts =============================
platform win32 -- Python 3.11.6, pytest-8.3.4, pluggy-1.6.0 -- C:\Users\Nikita\AppData\Local\Programs\Python\Python311\python.exe
cachedir: .pytest_cache
rootdir: C:\Users\Nikita\Desktop\CRM
configfile: pytest.ini
plugins: anyio-4.6.2.post1, Faker-36.1.1, asyncio-1.1.0, cov-6.0.0
asyncio: mode=Mode.AUTO, asyncio_default_fixture_loop_scope=function, asyncio_default_test_loop_scope=function
collecting ... collected 24 items

apps/api/tests/test_audit_security_gates.py::test_auth_rejection_on_invalid_password PASSED [  4%]
apps/api/tests/test_audit_security_gates.py::test_public_booking_rejection_on_suspended_tenant PASSED [  8%]
apps/api/tests/test_audit_security_gates.py::test_public_booking_rejections_past_and_too_soon PASSED [ 12%]
apps/api/tests/test_audit_security_gates.py::test_public_booking_rejections_shift_and_breaks PASSED [ 16%]
apps/api/tests/test_audit_security_gates.py::test_master_role_scoping_and_object_permissions PASSED [ 20%]
apps/api/tests/test_audit_security_gates.py::test_idempotent_replay_preserves_valid_management_link PASSED [ 25%]
apps/api/tests/test_audit_security_gates.py::test_tariff_limits_enforced_on_branch_creation PASSED [ 29%]
apps/api/tests/test_audit_security_gates.py::test_partial_payment_does_not_mark_charge_paid PASSED [ 33%]
apps/api/tests/test_audit_security_gates.py::test_owner_invite_and_acceptance_flow PASSED [ 37%]
apps/api/tests/test_audit_security_gates.py::test_idempotency_key_reuse_rejection_on_payload_mismatch PASSED [ 41%]
apps/api/tests/test_audit_security_gates.py::test_master_cannot_create_booking_for_another_master PASSED [ 45%]
apps/api/tests/test_audit_security_gates.py::test_plans_catalog_api PASSED [ 50%]
apps/api/tests/test_booking_concurrency.py::test_multi_service_duration_and_pricing_snapshot PASSED [ 54%]
apps/api/tests/test_booking_concurrency.py::test_parallel_booking_concurrency_race PASSED [ 58%]
apps/api/tests/test_booking_concurrency.py::test_price_change_returns_quote_changed PASSED [ 62%]
apps/api/tests/test_booking_concurrency.py::test_reschedule_and_cancel_lifecycle PASSED [ 66%]
apps/api/tests/test_crm_api.py::test_crm_calendar_and_master_role_isolation PASSED [ 70%]
apps/api/tests/test_crm_api.py::test_multi_tenant_calendar_strict_isolation_between_barberhouse_and_moderncut PASSED [ 75%]
apps/api/tests/test_platform_api.py::test_platform_console_lifecycle_and_billing PASSED [ 79%]
apps/api/tests/test_public_api.py::test_public_site_resolution_and_policies PASSED [ 83%]
apps/api/tests/test_public_api.py::test_public_booking_flow_and_management PASSED [ 87%]
apps/api/tests/test_roles_permissions.py::test_role_enforcement_and_permission_boundaries PASSED [ 91%]
apps/api/tests/test_tenant_isolation.py::test_strict_rls_tenant_isolation PASSED [ 95%]
apps/api/tests/test_tenant_isolation.py::test_cross_tenant_foreign_key_prevention PASSED [100%]

============================= 24 passed in 20.03s =============================
```
