# Чеклист блокеров промышленного развёртывания (CRM_PRODUCTION_BLOCKERS.md)

> Официальный реестр блокеров и обязательных проверок перед переводом платформы из стадии PILOT-CANDIDATE в PRODUCTION.
> Актуализирован по итогам аудита поставки Business CRM V1 (`fix/crm-full-v1-audit-gate`).

---

## 0. Закрытые блокеры аудита Business CRM V1 (ЗАКРЫТО В fix/crm-full-v1-audit-gate)

1. **[ЗАКРЫТО] P0-01: CI Regression & Playwright E2E Failures**:
   - Восстановлены и успешно пройдены все 13 Playwright E2E тестов (7 Booking Web + 6 CRM Full Business) и 31 pytest backend-тест.
   - Устранены strict mode violations, исправлены селекторы и асинхронные ожидания.
2. **[ЗАКРЫТО] P0-02: Tenant-Role Privacy Bypass in Customer Card & Notes**:
   - `POST /customers`: ограничен ролями `owner` и `admin`.
   - `GET /customers/{customer_id}`: для роли `master` доступ разрешен **только** к клиентам, у которых есть хотя бы одна бронь с данным мастером. При этом телефон маскируется (`+7 701 *** ** 08`), поля `email` и `notes_private` обнуляются, а история визитов и заметок фильтруется строго по броням этого мастера. Запрос чужого клиента мастером возвращает HTTP 403 Forbidden.
   - `POST /customers/{customer_id}/notes`: мастер может оставлять заметки только к своим клиентам.
3. **[ЗАКРЫТО] P0-03: Invite Token Hash Storage & Single-Use Redemption**:
   - В PostgreSQL сохраняется SHA-256 хэш токена приглашения (`token_hash = sha256(raw_token)`).
   - Сырой токен возвращается клиенту ровно один раз при создании ссылки.
   - Эндпоинт `/auth/accept-invite` принимает сырой токен, хэширует через SHA-256 и валидирует хеш в базе данных, предотвращая кражу токенов из дампа БД.
4. **[ЗАКРЫТО] P0-04: Timezone Conversions in Calendar Operations**:
   - Устранено ложное добавление суффикса `:00Z` к локальному времени.
   - Реализована функция корректного перевода локального времени филиала в UTC (`localToUtcIso`) с использованием смещения часового пояса филиала (`Intl.DateTimeFormat`).
5. **[ЗАКРЫТО] P1-01: Multi-Branch Staff Schedule Data Loss**:
   - Удаление старых смен мастера в `PUT /staff/{staff_id}/schedule` теперь ограничено строго выбранным `branch_id`. Смены мастера в других филиалах сохраняются без потерь.
   - `GET /staff/{staff_id}/schedule` поддерживает фильтрацию по query-параметру `branch_id`.
6. **[ЗАКРЫТО] P1-02: Branch-Specific Staff Service Pricing Overrides**:
   - Персональные цены мастера привязаны к конкретному филиалу сети (`branch_id`).
   - В интерфейсе `StaffModule` добавлен выбор филиала при настройке прайс-листа и графика сотрудника.
7. **[ЗАКРЫТО] P1-03: Branch DTO Field Aliases**:
   - Добавлены алиасы для полей филиала в Pydantic (`phone`/`phone_number`, `timezone`/`timezone_iana`), обеспечивая полную совместимость с API и формами настроек.
8. **[ЗАКРЫТО] P1-04: Report Metrics & Workload Calculation**:
   - Факт-выручка рассчитывается строго по визитам в статусе `completed`.
   - Загрузка мастеров рассчитывается от реальной продолжительности рабочих смен из таблицы `WeeklyShift`.
9. **[ЗАКРЫТО] P1-05: Real Scannable QR Code**:
   - В модуле онлайн-записи заглушка заменена на генератор настоящего считываемого QR-кода на базе библиотеки `qrcode` с возможностью скачивания PNG.

---

## 1. Блокеры безопасности и аутентификации перед Production (P0)

1. **Ротация JWT секретов и хранилище ключей (KMS / Vault)**:
   - В DEV/PILOT используется переменная `JWT_SECRET_KEY`.
   - Для Production: перенос секретов в AWS Secrets Manager / HashiCorp Vault с автоматической периодической ротацией и поддержкой нескольких валидных ключей в период ротации (Key Rotation Window).
2. **Внешний транспорт одноразовых ссылок и кодов (SMS/SMTP)**:
   - Приглашения сотрудников и клиентские подтверждения требуют интеграции с промышленным провайдером транзакционных сообщений (SMSC/Twilio/Postmark) со строгим контролем лимитов отправок (Anti-Spam Throttling).
3. **CORS и Origin Protection**:
   - Строгая привязка `CORS_ORIGINS` к боевым доменам компаний и Platform Console; запрет wildcard `*`.

---

## 2. Инфраструктурные блокеры (P1)

1. **Production Docker Build & Registry**:
   - Пайплайн CI протестировал приложение в среде Node 20 / Python 3.11.
   - Для развертывания в кластере (Kubernetes / ECS / Nomad): сборка двухстадийного non-root Docker-образа с урезанием прав (`USER 10001:10001`) и публикация в защищенный Container Registry.
2. **PostgreSQL Backup & Disaster Recovery (DR)**:
   - Настройка непрерывного архивирования WAL (pgBackRest / WAL-G) в объектное хранилище S3 с регулярными учениями по восстановлению на контрольную точку времени (Point-in-Time Recovery, PITR).
3. **Фоновая очистка котировок (Quote Garbage Collection)**:
   - Перевод очистки просроченных `booking_quotes` на регулярный фоновый воркер (pg_cron или Celery/Redis) для снижения нагрузки на основной цикл транзакций Booking Engine.

---

## 3. Производительность и устойчивость под нагрузкой (P1)

1. **Rate Limiting на публичных эндпоинтах**:
   - Публичные эндпоинты `/api/v1/public/availability` и `/api/v1/public/bookings` требуют ограничения числа запросов по IP (Token Bucket Rate Limiter) для защиты от DoS-атак и сканирования слотов конкурентами.
2. **Нагрузочное тестирование (Stress & Concurrency)**:
   - Проведение стресс-тестирования сценариев 1 000+ одновременных запросов на один и тот же временной слот мастера для подтверждения надежности PostgreSQL Exclusion Constraints под высокой конкурентной нагрузкой.
