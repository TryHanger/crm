# CRM SaaS — независимый аудит Pilot Readiness V1

**Дата:** 2026-11-09  
**Репозиторий:** https://github.com/TryHanger/crm  
**Проверенный SHA:** `47f5e652e6c066ccd6b77cb3df1f150243ae2159`  
**Ветка:** `feat/pilot-readiness-v1`  
**GitHub Actions:** https://github.com/TryHanger/crm/actions/runs/42601249469 — **FAILURE**  
**Решение:** `NO-GO` для внешнего пилота с реальными данными; `CONTINUE` для контролируемой локальной DEV-проверки. Архитектуру и функциональные модули не переписывать.

## 1. Подтверждённые факты

- Коммит существует и является HEAD ветки; изменения по контейнеризации, конфигурации, Nginx, приглашениям, rate limiting, миграциям и DR действительно внесены.
- GitHub Actions: **39/39 backend pytest PASS**; `docker compose -f docker-compose.staging.yml config` PASS. Затем сбой этапа backup/restore; frontend build и Playwright E2E в этом прогоне **SKIPPED**. Утверждение «33/33 прошли в общем CI» не доказано.
- Точная причина падения: `pg_dump version 16.15` против `PostgreSQL server version 17.11`; скрипт выбрасывает `RuntimeError`.
- Локальные 7 pilot E2E используют `http://127.0.0.1:3001/3002` и `<tenant>.localhost:3000`, не проходят через защищённый Nginx/HTTPS. Вход платформенного оператора в тесте — через DEV quick-login. Это хороший функциональный тест, но не STAGING acceptance.
- Скриншот `docs/screenshots/pilot-06-crm-calendar-synced.png` показывает созданную запись в CRM; `pilot-07-mobile-320px-booking.png` содержит только скелетоны загрузки.

## 2. Обязательные исправления P0

### P0-A. Секреты STAGING и неполная защита fail-fast

**Доказательство:** `docker-compose.staging.yml` содержит публично известные дефолтные значения для `POSTGRES_PASSWORD`, `DB_PASSWORD`, `JWT_SECRET_KEY`. В `apps/api/app/core/config.py::validate_environment_security()` проверяются другие значения, поэтому эти дефолты могут пройти валидацию.

**Требования:**
- Убрать fallback для всех секретов в staging/production: использовать `${VAR:?Required}` / secrets mount, fail-fast при отсутствии или небезопасных значениях, не печатать их в логах и `docker compose config` в артефактах.
- Согласовать переменные `.env.staging` с кодом и Compose. В `STAGING_RUNBOOK.md` ошибочно указаны `APP_DB_PASSWORD`, `PLATFORM_ALLOWED_IPS`, `SMTP_FROM_EMAIL`, тогда как приложение читает `DB_PASSWORD`, `PLATFORM_IP_ALLOWLIST`, `SMTP_FROM`.
- Все команды Compose выполнять с `--env-file .env.staging`; файл `.env.staging.example` должен реально существовать и содержать только фиктивные значения.
- `.dockerignore` должен исключать `.env*` (кроме безопасных шаблонов), `backups/`, дампы, секреты, локальные логи. `Dockerfile` использует `COPY . /app`, поэтому это критично.
- Runtime API не должен получать PostgreSQL superuser/admin credentials, если они ему не нужны. Отдельный одноразовый migration runner — с отдельным ограниченным контекстом привилегий.
- Негативный тест запуска с отсутствующим или дефолтным секретом должен гарантированно завершиться ошибкой; с безопасными значениями — пройти.

### P0-B. Platform IP allowlist не должен пропускать запросы при пустой настройке

**Доказательство:** `apps/api/app/infrastructure/security/ip_filter.py`: `if not settings.PLATFORM_IP_ALLOWLIST: return`.

**Требования:**
- STAGING/PRODUCTION: пустой allowlist или отсутствие явно выбранной альтернативы (VPN/ingress auth) — startup FAIL либо deny-all; для DEV локальный режим отдельно.
- Исправить цепочку доверенных прокси. `nginx/staging.conf` использует `$proxy_add_x_forwarded_for`, а `get_client_ip()` берёт первый IP из `X-Forwarded-For`. Это создаёт риск доверия подставленному клиентом заголовку; проверять настоящего peer, цепочку proxy и нормализованный IP/CIDR.
- Негативные end-to-end HTTP-тесты: отсутствие allowlist, неизвестный IP, подложный `X-Forwarded-For`, IPv4/IPv6, разрешённая сеть, обход прямым портом API. Внешний доступ к API и платформенной консоли должен быть ограничен на уровне сети/прокси, не только React.

### P0-C. HTTPS и реальное STAGING reverse-proxy развёртывание

**Доказательство:** все server-блоки `nginx/staging.conf` имеют только `listen 80`, хотя Compose публикует `443:443`. Нет фактически сконфигурированного TLS listener или автоматической выдачи сертификатов.

**Требования:**
- Определить поддерживаемую схему: TLS в ingress/Caddy/Traefik или Nginx, с явно проверенными DNS/сертификатами для `console`, `app`, `*.book`. Для частного LAN/VPN пилота оформить безопасную альтернативу, не объявлять HTTP готовым внешним HTTPS.
- Точно ограничить домены конкретным suffix, а не regex `console\..+` и `app\..+` для произвольных имён. Сохранять `Host` только после allowlist/tenant resolution.
- Запуск `docker compose --env-file .env.staging ... build`, `up -d`, `ps`, health/readiness, HTTP→HTTPS redirect, TLS chain, статика трёх frontend, API через same-origin reverse proxy — **в чистом окружении**, сохранив лог и версии контейнеров. `docker compose config` недостаточен.
- Исправить некорректные команды в `STAGING_RUNBOOK.md`: имена сервисов — `postgres`, `migration-runner`, `api`, `frontend`, `proxy`, а не `crm-staging-*`; прокси публикует 80/443, порты 3000/3001/3002 наружу Compose не публикует; путь health API — `/health/live` и `/health/ready`.

### P0-D. Backup/restore не должен давать ложный PASS

**Доказательство:** GitHub CI падает на `pg_dump 16.15` / server `17.11`; в `scripts/restore_db.py` при `proc.returncode != 0` и определённых сообщениях выполняется лишь warning; отсутствующий манифест позволяет пропустить SHA-256 проверку. `RESTORE_RUNBOOK.md` описывает несуществующие CLI-флаги `--output-dir`, `--manifest`, `--target-db`, `--verbose`. Документация утверждает RTO `0.990 с`, JSON-отчёт содержит `4.153 с`.

**Требования:**
- В CI использовать pg_dump/psql версии совместимой с PostgreSQL 17 (например `postgres:17-alpine` client или PGDG 17). Проверить точную версию в логах.
- Любой ненулевой exit code SQL restore — фатальная ошибка. Для psql добавить `-v ON_ERROR_STOP=1`, reject без манифеста / при несовпадении SHA. Проверять то, что восстановлено всё, а не только количество таблиц и наличие 22 RLS.
- Восстанавливать в изолированную чистую БД; сравнивать агрегаты, sample IDs/refs, статусы и tenant isolation до/после, включая запрос от непривилегированной runtime-роли.
- Обеспечить автоматическое расписание + внешнее хранилище копий + retention + сигнализацию о failed backup. В отсутствие внешнего хранилища явно `BLOCKED`, а не `DONE`.
- RTO = полное время от начала процедуры до восстановленного доступного приложения; RPO = реально измеренная/обоснованная потеря данных при расписании и offsite. `0.990` и `4.153` как лабораторные значения нельзя выдавать за обещание реального RTO/RPO.
- Нужна отдельная проверка испорченного дампа, неполного SQL, несовместимого клиента, неверного пароля и missing manifest: все должны приводить к FAIL.

## 3. Существенные замечания P1

- **Тестовая достоверность:** `pilot_readiness.spec.ts` до сих пор условно пропускает отдельные UI-действия (`if (visible)`), а в cross-tenant тесте допускает два вида ответа. Уберите vacuous tests, фиксируйте ожидаемый HTTP status и обязательный результат; проверяйте бизнес-данные в PostgreSQL, а не только заголовки.
- **Пилот без seeded-аккаунтов:** есть `INITIAL_PLATFORM_OWNER_*` в `init_db.py`, но Compose их не передаёт, а runbook не описывает защищённый bootstrap первого владельца платформы. Проверьте старт на абсолютно новой БД при `ENABLE_DEMO_SEED=false`, затем создание реальной первой компании.
- **Email:** SMTP транспорт реализован, но тест проверяет `manual_channel_required`, а не реальную доставку. Для ручного канала нужен отдельный операторский SOP и подтверждение получения; не писать «отправлено», если `sent=false`. Для настоящего SMTP — тест с контролируемым SMTP-приёмником и проверкой токена TTL/single-use, без логирования ссылки.
- **Rate limiting:** текущий `SlidingWindowRateLimiter` — process-local в памяти и не имеет межпроцессной синхронизации; нельзя заявлять production-grade распределённую защиту. Для одного закрытого пилотного экземпляра дополнительно использовать ingress-level ограничения, для многопроцессного режима — общее хранилище или rate limiting в proxy.
- **Изоляция данных и диагностика:** runtime API получает admin DATABASE_URL/пароль в контейнере, несмотря на разделение мигратора и приложения; исключить ненужные privileged secrets. Удалить открытые схемы `/docs`, `/redoc`, `/openapi.json` из внешнего STAGING либо защитить доступом.
- **Отчётность:** матрица `PILOT_GO_NO_GO.md` пишет `CONDITIONAL GO` для 3–5 салонов, тогда как пилот заявлен на 1–2 и фактический STAGING/TLS/DR не доказан. Обновить на фактический `NO-GO` для внешних пользователей до закрытия P0.
- **Скриншоты:** сделать свежие screenshot после загрузки (никаких skeleton); на 320/390/1280 подтвердить отсутствие горизонтального скролла и способность полностью пройти booking.

## 4. Приёмочные этапы — без переписывания функциональности

| Gate | Обязательный результат | Внешняя зависимость |
|---|---|---|
| **G1 CI** | GitHub GREEN: 39/39 или больше pytest, все имеющиеся E2E, frontend builds, Docker builds и реальный DR restore | нет |
| **G2 Secure STAGING** | Контейнеры запущены на чистой БД; без default secrets, без demo seed, с рабочим bootstrap; role/RLS и IP/Host spoof негативные тесты | тестовая машина/VPN |
| **G3 Domains/TLS** | Через настоящий proxy открываются три приложения и API; проверены routing, `Host`, сертификат, HTTPS | реальный домен или безопасная частная альтернатива |
| **G4 Real owner lifecycle** | Platform owner → create tenant → invite received → first login → service/master/shift → booking → CRM; независимый second tenant | SMTP или управляемый ручной канал |
| **G5 Restore** | Реплицируемый backup в отдельное хранилище; crash/restore на чистую БД; 0 silent errors, измеренные RTO/RPO | storage / инфраструктура |
| **G6 GO/NO-GO** | Подтверждённый акт запуска 1–2 пилотных компаний с доступом, ответственным, backup и откатом | явное решение владельца проекта |

## 5. Поручение агенту

Работать в **новой** ветке `fix/pilot-readiness-v1-audit-gate` от `47f5e652e6c066ccd6b77cb3df1f150243ae2159`. Разрешены commit + push в эту ветку, без force push/merge/deploy и без реальных оплат/покупок. Исправить только перечисленные эксплуатационные блокеры, сохранить API и все три frontend. Если нет доступа к реальному домену/SMTP/offsite storage, не создавать фиктивные доказательства: сделать настройку и тестовую эмуляцию с явной меткой, а внешнее действие отметить `BLOCKED`.

В финальном пакете: SHA/branch, ссылки на полный зелёный CI, Docker build/up/health logs, тесты Host/IP/TLS, негативные security assertions, реальные локальные backup/restore с проверяемым manifest, точные команды и версии, дифф, свежие скриншоты, очищенный ZIP, обновлённые runbook и честный `PILOT_GO_NO_GO.md`. Если выполнены только G1–G2, сообщить именно `DEV/STAGING VERIFIED`, не `PILOT GO`.

**Граница приёмки:** внешних реальных пользователей и их персональные данные не подключать до явно разрешённого GO на защищённой инфраструктуре.
