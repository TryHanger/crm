# Отчет о прохождении автоматизированного тестирования (TEST_REPORT.md)

## 1. Сводка выполнения тестов
- **Дата и время запуска**: 2026-11-08 (после устранения замечаний аудита V1)
- **Платформа**: Windows / PostgreSQL 17 Local Database (Port 5433)
- **Изолированная тестовая БД**: `saas_crm_test` (с проверкой суффикса `_test`)
- **Среда выполнения**: Python 3.11.6, pytest 8.3.4, pytest-asyncio 1.1.0, anyio 4.6.2, SQLAlchemy 2.0.36, asyncpg 0.30.0
- **Всего тест-кейсов**: 19
- **Успешно завершено**: 19 (100% PASS)
- **Не пройдено / Ошибок**: 0
- **Время выполнения полного набора**: ~14 секунд

---

## 2. Детальная таблица пройденных тестов

| № | Тестовый модуль и функция | Направление проверки | Результат | Подтвержденное поведение |
| :-: | :--- | :--- | :---: | :--- |
| **1** | `test_audit_security_gates.py`<br>`test_auth_rejection_on_invalid_password` | Gate B: Auth Security | **PASSED** | Полное отсутствие бэкдоров: неверный пароль возвращает 401 Unauthorized, верный пароль валидируется строго через bcrypt. |
| **2** | `test_audit_security_gates.py`<br>`test_public_booking_rejection_on_suspended_tenant` | Gate B: Lifecycle Isolation | **PASSED** | Приостановленная компания мгновенно блокируется: публичный виджет возвращает 403 `TENANT_SUSPENDED`. |
| **3** | `test_audit_security_gates.py`<br>`test_public_booking_rejections_past_and_too_soon` | Gate D: Authoritative Engine | **PASSED** | Прямые POST-запросы слотов в прошлом (`SLOT_IN_PAST`) или с нарушением окна упреждения (`SLOT_TOO_SOON`) отклоняются с кодом 400. |
| **4** | `test_audit_security_gates.py`<br>`test_public_booking_rejections_shift_and_breaks` | Gate D: Working Shifts & Breaks | **PASSED** | Прямые запросы слотов вне рабочих смен мастера (`STAFF_OUTSIDE_SHIFT`) или во время обеда (`STAFF_ON_BREAK`) отклоняются с кодом 400. |
| **5** | `test_audit_security_gates.py`<br>`test_master_role_scoping_and_object_permissions` | Gate C: Master Role Scoping | **PASSED** | Мастер блокируется при попытке открыть чужую запись (403), изменить чужой статус (403), перенести/отменить чужую запись (403), или открыть финансовый отчет (403). Номера телефонов клиентов маскируются. |
| **6** | `test_audit_security_gates.py`<br>`test_idempotent_replay_preserves_valid_management_link` | Gate D: Idempotency Replay | **PASSED** | Повтор запроса с тем же `Idempotency-Key` возвращает 200/201 с валидным рабочим криптографическим токеном управления, а не заглушкой. |
| **7** | `test_audit_security_gates.py`<br>`test_tariff_limits_enforced_on_branch_creation` | Gate C: Entitlement Limits | **PASSED** | Попытка создать второй филиал на тарифе Start (лимит: 1) возвращает 403 `ENTITLE_LIMIT_EXCEEDED` с пояснением лимита. |
| **8** | `test_audit_security_gates.py`<br>`test_partial_payment_does_not_mark_charge_paid` | Gate A: Billing Ledger | **PASSED** | Фиксация частичной оплаты по начислению переводит статус в `partially_paid`, предотвращая необоснованное закрытие долга. |
| **9** | `test_booking_concurrency.py`<br>`test_multi_service_duration_and_pricing_snapshot` | Booking Multi-Service | **PASSED** | Выбор нескольких услуг корректно суммирует длительности и цены с учетом индивидуальных оверрайдов мастера и сохраняет снимок в `booking_items`. |
| **10** | `test_booking_concurrency.py`<br>`test_parallel_booking_concurrency_race` | PostgreSQL Exclusion Constraint | **PASSED** | Два параллельных асинхронных запроса на один и тот же слот мастера: ровно 1 завершается успешно (201 Created), второй отклоняется с 409 Conflict (`SLOT_CONFLICT`). В БД остается ровно одна запись `staff_occupancy`. |
| **11** | `test_booking_concurrency.py`<br>`test_price_change_returns_quote_changed` | Price Drift Protection | **PASSED** | Изменение цены услуги во время выбора слота клиентом возвращает 409 Conflict (`QUOTE_CHANGED`) при попытке подтверждения, исключая расчет по устаревшим тарифам. |
| **12** | `test_booking_concurrency.py`<br>`test_reschedule_and_cancel_lifecycle` | Booking Lifecycle Machine | **PASSED** | Перенос и отмена записи клиентом освобождают занятость мастера и фиксируют статус в истории. |
| **13** | `test_crm_api.py`<br>`test_crm_calendar_and_master_role_isolation` | CRM Workspace & Calendar | **PASSED** | Проверены: владелец видит всех мастеров, мастер видит только себя, создание ручной записи в CRM, жизненный цикл статусов (`confirmed -> arrived -> in_progress -> completed`), блокировка времени и дедупликация клиентов по телефону. |
| **14** | `test_platform_api.py`<br>`test_platform_console_lifecycle_and_billing` | Platform Console & Ledger | **PASSED** | Проверены: вход платформы, онбординг компании, приостановка и возобновление подписки, выставление начисления и регистрация платежа с Idempotency-Key. |
| **15** | `test_public_api.py`<br>`test_public_site_resolution_and_policies` | Public Domain Resolution | **PASSED** | Резолвинг домена `barberhouse.book.example.kz`, загрузка темы и динамической политики отмены (180 минут). Неизвестный домен возвращает 404 `SITE_NOT_FOUND`. |
| **16** | `test_public_api.py`<br>`test_public_booking_flow_and_management` | Public Client Flow | **PASSED** | Полный пользовательский сценарий: выбор филиала, каталога, мастера, поиск доступности, оформление записи, просмотр по токену управления с маскировкой PII, самостоятельная отмена. |
| **17** | `test_roles_permissions.py`<br>`test_role_enforcement_and_permission_boundaries` | RBAC Permissions | **PASSED** | Защита периметров: линейный персонал компании не может получить доступ к консоли платформы или изменить подписку своей компании. |
| **18** | `test_tenant_isolation.py`<br>`test_strict_rls_tenant_isolation` | Multi-Tenant Data Isolation | **PASSED** | Две независимые компании с клиентами с одинаковым номером телефона (`+77015550001`): RLS на уровне PostgreSQL исключает утечку данных между компаниями. |
| **19** | `test_tenant_isolation.py`<br>`test_cross_tenant_foreign_key_prevention` | Database Relational Integrity | **PASSED** | Попытка создать запись в Компании А с ссылкой на филиал или мастера Компании Б отклоняется базой данных. |

---

## 3. Фактический лог выполнения pytest
```text
============================= test session starts =============================
platform win32 -- Python 3.11.6, pytest-8.3.4, pluggy-1.6.0 -- C:\Users\Nikita\AppData\Local\Programs\Python\Python311\python.exe
cachedir: .pytest_cache
rootdir: C:\Users\Nikita\Desktop\CRM
configfile: pytest.ini
plugins: anyio-4.6.2.post1, Faker-36.1.1, asyncio-1.1.0, cov-6.0.0
asyncio: mode=Mode.AUTO, asyncio_default_fixture_loop_scope=function, asyncio_default_test_loop_scope=function
collecting ... collected 19 items

apps/api/tests/test_audit_security_gates.py::test_auth_rejection_on_invalid_password PASSED [  5%]
apps/api/tests/test_audit_security_gates.py::test_public_booking_rejection_on_suspended_tenant PASSED [ 10%]
apps/api/tests/test_audit_security_gates.py::test_public_booking_rejections_past_and_too_soon PASSED [ 15%]
apps/api/tests/test_audit_security_gates.py::test_public_booking_rejections_shift_and_breaks PASSED [ 21%]
apps/api/tests/test_audit_security_gates.py::test_master_role_scoping_and_object_permissions PASSED [ 26%]
apps/api/tests/test_audit_security_gates.py::test_idempotent_replay_preserves_valid_management_link PASSED [ 31%]
apps/api/tests/test_audit_security_gates.py::test_tariff_limits_enforced_on_branch_creation PASSED [ 36%]
apps/api/tests/test_audit_security_gates.py::test_partial_payment_does_not_mark_charge_paid PASSED [ 42%]
apps/api/tests/test_booking_concurrency.py::test_multi_service_duration_and_pricing_snapshot PASSED [ 47%]
apps/api/tests/test_booking_concurrency.py::test_parallel_booking_concurrency_race PASSED [ 52%]
apps/api/tests/test_booking_concurrency.py::test_price_change_returns_quote_changed PASSED [ 57%]
apps/api/tests/test_booking_concurrency.py::test_reschedule_and_cancel_lifecycle PASSED [ 63%]
apps/api/tests/test_crm_api.py::test_crm_calendar_and_master_role_isolation PASSED [ 68%]
apps/api/tests/test_platform_api.py::test_platform_console_lifecycle_and_billing PASSED [ 73%]
apps/api/tests/test_public_api.py::test_public_site_resolution_and_policies PASSED [ 78%]
apps/api/tests/test_public_api.py::test_public_booking_flow_and_management PASSED [ 84%]
apps/api/tests/test_roles_permissions.py::test_role_enforcement_and_permission_boundaries PASSED [ 89%]
apps/api/tests/test_tenant_isolation.py::test_strict_rls_tenant_isolation PASSED [ 94%]
apps/api/tests/test_tenant_isolation.py::test_cross_tenant_foreign_key_prevention PASSED [100%]

============================= 19 passed in 13.98s =============================
```
