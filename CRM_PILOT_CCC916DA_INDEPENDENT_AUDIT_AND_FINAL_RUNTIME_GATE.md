# Независимый аудит Pilot Readiness V1 — commit ccc916da

**Дата оценки:** 9 ноября 2026  
**Репозиторий:** https://github.com/TryHanger/crm  
**Проверяемый SHA:** `ccc916da6acc57e28525b4fcc8bd84b94358a15e`  
**Ветка:** `fix/pilot-readiness-v1-audit-gate`  
**GitHub Actions:** https://github.com/TryHanger/crm/actions/runs/42617353784  
**Решение:** **PASS для DEV CI и локального DR; NO-GO для реальных клиентов в STAGING.** Следующий шаг — узкий *Runtime & Booking Publication Gate*, без переписывания трёх приложений.

## 1. Что непосредственно подтверждено

- SHA является HEAD ветки, отличия от `47f5e652e6c066ccd6b77cb3df1f150243ae2159` представлены одним коммитом.
- GitHub Actions **success**: **42/42 pytest**, **33/33 Playwright**, 4 workspace build, Alembic, `docker compose ... config`, создание dump, проверка SHA-256 и restore в отдельную тестовую БД.
- В CI restore проверил 47 таблиц, 22 таблицы с `FORCE RLS`, 12 tenants, 13 users, 3 branches, и положительный RLS-тест (0 строк без tenant-контекста, 1 строка при его установке).
- Исправлены требование обязательных Compose-секретов, запрет некоторых известных слабых значений, CIDR IP allowlist, Nginx TLS listener 443, проверка checksum и завершение restore при ошибке `psql`.
- Mobile 320px в новом скриншоте теперь содержит реальные услуги (не skeleton). Синхронизированная запись видна в календаре CRM.

**Важно:** это не подтверждает, что `docker compose up` отработал успешно: CI запускает только `docker compose config`, а все Playwright-тесты идут через локальные `uvicorn` и Vite HTTP-порты 8000/3000/3001/3002 с `ENVIRONMENT=development` и `ENABLE_DEMO_SEED=true`.

## 2. Блокеры, которые видны по коду

### P0-01. Runtime API без admin DB secret не проходит fail-fast

**Код:** `docker-compose.staging.yml`, сервис `api`; `apps/api/app/core/config.py` — `ADMIN_DB_PASSWORD` по умолчанию `postgres` и `validate_environment_security()` отклоняет его для staging. `api.environment` намеренно не содержит `ADMIN_DB_PASSWORD`, а `.dockerignore` исключает `.env*`.

**Следствие:** инициализация `Settings()` и вызов валидатора при импорте приложения вероятно завершится `RuntimeError` даже при корректно переданных runtime DB credentials. Удаление superuser-пароля из runtime правильное; **нельзя** возвращать его, чтобы подавить ошибку.

**Исправление:** сделать admin credentials действительно необязательными для runtime-контекста и валидировать их только для явных migration/admin процессов. Инициализация обычного API не должна строить или открывать admin engine. Можно создать отдельные конфигурации `RuntimeSettings` / `MigrationSettings` или явный `ROLE=api|migration`, с fail-fast на `ADMIN_DATABASE_URL` только в migration-runner. Обязателен тест запуска API в staging **без** любых admin credentials.

**Acceptance:** на чистой БД `migration-runner` успешно выполняет миграции и bootstrap; API запускается с `DB_USER=crm_app_user`, не получает `ADMIN_DB_PASSWORD` и `ADMIN_DATABASE_URL`, `/health/ready` = 200. Попытка runtime API подключиться как postgres невозможна.

### P0-02. IP доверенного Docker reverse proxy не совпадает с TRUSTED_PROXIES

**Код:** Compose задаёт `TRUSTED_PROXIES: 127.0.0.1,::1,proxy,nginx`; `rate_limiter.py:is_trusted_peer` сопоставляет IP соединения с этими literal strings или CIDR, но не разрешает service hostname в IP. Контейнер Nginx соединяется с FastAPI по Docker bridge IP (как правило 172.x), а `get_client_ip` игнорирует заголовки, когда direct peer не признан доверенным. По умолчанию allowlist включает `10.0.0.0/8`, `192.168.1.0/24`, loopback — не IP docker bridge.

**Следствие:** запросы администрирования через реальный Nginx могут ошибочно получить 403. Контрпример с поддельными `X-Forwarded-*` также нужно проверить через настоящий proxy. Простой whitelist `172.0.0.0/8` небезопасен.

**Исправление:** задать изолированную сеть/API network с однозначно идентифицированным ingress proxy, доверять **фактическому peer IP**, санировать headers на edge. Можно жёстко привязать контейнер к отдельной подсети/адресу proxy в Compose и задать `TRUSTED_PROXIES` только для этого адреса. Дополнительно ограничить доступ к Platform Console на уровне edge/VPN, не только FastAPI.

**Acceptance:** запрос с разрешённого внешнего IP через HTTPS Nginx проходит; запрещённый IP -> 403; поддельные `X-Forwarded-For`, `X-Real-IP` не обходят 403; запрос напрямую к API не может подменить адрес; тест проводится на поднятых контейнерах, не только ASGITransport.

### P0-03. Некорректная персональная ссылка и QR, а также публикация online booking

**Код:** `apps/business-crm/src/modules/online-booking/OnlineBookingModule.tsx` содержит `useState('http://barberhouse.localhost:3000')` и `useState(true)`; ожидает `res.policy`, `res.theme`, `res.publication`. Но `GET /api/v1/business/booking-settings` в `apps/api/app/api/v1/business/routes.py` возвращает только `BookingPolicy`. Поэтому объект `publication` отсутствует и ссылка по умолчанию остаётся. Новый скриншот `docs/screenshots/pilot-03-booking-settings.png` **для Pilot Studio** действительно показывает URL Barber House.

Также `packages/api-client/src/index.ts:toggleBookingPublication` посылает `{ is_published: boolean }` в JSON body, а backend `POST /business/booking-publication/publish` принимает `publish: bool = True` как query-параметр. При `POST` без `?publish=false` backend использует `True`, даже когда пользователь нажал «Приостановить», а frontend оптимистично показывает изменение.

**Следствие:** новая компания получает QR-ссылку чужого tenant; отмена публикации может быть фиктивной. Результат маскируется E2E: тест вручную формирует `http://${pilotSlug}.localhost:3000` и не сканирует/открывает показанный CRM QR.

**Исправление:** добавить единый типизированный `GET /business/online-booking/config` (или расширить существующий endpoint с договорённым DTO) с `policy`, `theme`, `publication`, `canonical_public_url`, `tenant_slug`, `domain_status` и конфигурацией. URL сервер собирает из проверенной записи `TenantDomain` / `BOOKING_DOMAIN_SUFFIX` для конкретного tenant, с учётом active custom domain. Начальные UI-значения не должны объявлять публикацию включённой до запроса. Перейти к однозначному `PATCH /business/booking-publication` с JSON DTO (или query-contract, но одинаково на обоих концах). Перед обновлением UI проверять ответ; после перезагрузки состояние должно сохраниться.

**Acceptance:** новый Pilot Studio видит ссылку **своего** tenant и QR той же ссылки; при переходе по ней отображается Pilot Studio, не Barber House. Опубликовать -> публичные записи работают. Приостановить -> backend `is_published=false`, при повторном GET остаётся false, новые слоты/создание брони заблокированы (ожидаемый согласованный HTTP статус), ранее созданные записи сохраняются. Не должно быть «условного PASS» только по подписи кнопки.

### P1-04. CI устанавливает PG17 client, но исполняемый pg_dump = 16.15

В логе CI `pg_dump --version` и `backup_db.py` показывают `16.15` при PostgreSQL server 17. Скрипт теперь успешно сделал dump 457731 B и restore с checksum (то есть текущий результат реальный), но утверждение «исполняется PG17 client» не подтверждено. Нужно указать путь `/usr/lib/postgresql/17/bin/pg_dump` или убедиться, что PATH использует клиент 17 и выполнять строгий machine-check major version.

**Acceptance:** CI печатает `pg_dump (PostgreSQL) 17.x`, `psql (PostgreSQL) 17.x` и отказывается от неожиданной major version до создания backup.

### P1-05. DR gate проходит и при некоторых неполных проверках

В `restore_db.py` флаг `runtime_role_rls_enforcement` может остаться `false` после исключения, но отчёт всё равно получает `"status":"SUCCESS"`. Аналогично `staff_occupancy_constraint_verified` записывается, но не является обязательной проверкой; `rto_metric_seconds` равен только времени SQL-stream restore, а не полному восстановлению приложения. Нет подтверждённых offsite snapshots и реального расписания: RPO = 1h остаётся **условным**, а не измеренным.

**Acceptance:** обязательные инварианты (`runtime_role_rls_enforcement`, constraint, expected tables, source/restore row counts, tenant A/B isolation) должны вызывать nonzero exit при FAIL; отдельный отчёт полного recovery с запуском API, healthcheck и переключением трафика; назвать SQL duration отдельно. Для реальных клиентских данных — автоматический backup с отправкой во внешний изолированный storage и проверенным восстановлением.

### P1-06. В CI нет запуска контейнерного HTTPS-стека

CI делает `docker compose config` и `npm run build`, но **не** `docker compose up --build`, не проверяет реальный `https://.../api` через Nginx и не испытывает `POST /auth/login` / tenant routing в `ENVIRONMENT=staging`. Self-signed cert — технический HTTPS для внутреннего теста, не доверенный сертификат для внешних пользователей.

**Acceptance:** специальный job с synthetic secrets, non-demo bootstrap, `docker compose --env-file .env.staging ... up -d --build`, проверкой всех контейнеров, health/readiness, `curl --resolve ... --cacert ...`, HTTP->HTTPS редиректа, 404 для unknown host, входом owner, публикацией/QR, booking и auth через HTTPS. Запись `docker compose ps`/logs приложить. Для тестового self-signed cert явно доверить выданному сертификату только внутри E2E; без `ignoreHTTPSErrors` во внешнем пилоте.

### P2. Оставшийся технический долг

- In-memory rate limiter подходит лишь для одного процесса и ограниченного внутреннего пилота; при нескольких репликах/рестартах использовать shared store или надёжный edge limiter.
- Убедиться в отсутствии демонстрационных/тестовых токенов и персональных данных в коммитнутых скриншотах/журналах; привести `.dockerignore` и маскирование URL к одному контракту.
- Проверить готовность статических frontend assets до старта proxy, чтобы ранний запрос не возвращал пустую страницу.

## 3. Режим допуска и порядок исполнения

1. **DEV/CI Gate — PASS.** Разрешена дальнейшая разработка и испытания только с синтетическими данными.
2. **Local HTTPS Docker STAGING Gate — BLOCKED/PARTIAL** до исправления P0-01, P0-02, P0-03 и запуска контейнерного E2E.
3. **Внутренний тестовый пилот с синтетическими данными — допустим после Runtime Gate.** Это не то же самое, что размещение для клиентов.
4. **Закрытый внешний пилот с реальными клиентскими данными — NO-GO** до защищённого публичного DNS/TLS, реального доступа с разрешённых IP/VPN, доставляемых приглашений или контролируемой безопасной передачи, offsite backup, проверенного восстановления и оформленного решения владельца. Эквайринг и SMS не обязательно подключать при честном ручном биллинге и отсутствии SMS-обещаний.

## 4. Инструкция исполнителю

- Создать `fix/pilot-v1-runtime-and-publication-gate` **от** `ccc916da6acc57e28525b4fcc8bd84b94358a15e`.
- Не переписывать Booking Web, Business CRM и Platform Console; только минимальные исправления P0/P1 из данного аудита.
- Разрешены commit и push только в новую ветку; **не** merge в `main`, **не** force-push, **не** production deploy, **не** подключать настоящие персональные данные и не покупать инфраструктуру без явного поручения.
- Сначала воспроизвести текущие P0 на чистом Compose (зафиксировать точный лог/ошибку), затем исправить и повторить. Если у исполнителя нет Docker или инфраструктуры, честно пометить `BLOCKED` вместо имитации.
- Добавить regressions: staging runtime no-admin; proxy allowlist/IP spoof; new tenant public URL/QR; genuine publication off/on persisted; end-to-end booking through the shown QR URL; backup restore invariant failures.
- Финальная поставка: Git SHA, ссылка на зелёный CI, docker build/run logs, `docker compose ps`, HTTPS smoke outputs, Playwright traces, санитизированные screenshots, result DONE/PARTIAL/BLOCKED, `PILOT_GO_NO_GO.md`, ZIP с полным изменённым кодом/lockfiles/миграциями/хэшами, без секретов.

**Stop rule:** после этого гейта не продолжать автоматическую разработку новых фич; нужен реальный выбор владельца инфраструктуры и условий пилота. Решение GO/NO-GO принимает владелец проекта на основе подтверждённых доказательств.
