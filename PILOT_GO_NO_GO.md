# Решение по готовности к закрытому пилоту (PILOT GO / NO-GO DECISION)

**Дата оценки:** 9 ноября 2026 г.  
**Ветка аудита:** `fix/pilot-v1-runtime-and-publication-gate`  
**Базовый аудит коммит:** `ccc916da6acc57e28525b4fcc8bd84b94358a15e`  
**Итоговое решение:**
- **Внешний запуск с реальными клиентами и персональными данными:** **NO-GO** (до предоставления боевого домена, доверенного SSL и offsite хранилища);
- **Контролируемый внутренний технический пилот (1–2 салона на Staging / VPN):** **DEV/STAGING VERIFIED** (все технические блокеры P0 закрыты, CI и тесты зелёные).

---

## 1. Честная матрица готовности компонентов (Readiness Matrix)

| Область | Критерий приёмки | Статус | Доказательство / Комментарий |
|---|---|:---:|---|
| **P0-01: Runtime API Credentials** | Запуск API без ADMIN_DB_PASSWORD | **DONE** | Контейнер API не имеет `ADMIN_DB_PASSWORD` / `ADMIN_DATABASE_URL`, запуск под `PROCESS_ROLE=api`, lazy proxy предотвращает инициализацию admin engine |
| **P0-02: Proxy Peer IP & Allowlist** | Доверие к прокси по фактическому IP/CIDR | **DONE** | `is_trusted_peer()` валидирует `172.28.0.0/16` и разрешает имена хостов `proxy`, `nginx`. Заголовки от недоверенных пиров отсекаются |
| **P0-03: Tenant Link & Publication** | Канонический URL и QR нового арендатора | **DONE** | Устранена захардкоженная ссылка barberhouse, отображается ссылка и QR активного тенанта. `PATCH /booking-publication` поддерживает JSON body и query, пауза возвращает 404 SITE_NOT_PUBLISHED |
| **P1-04 & P1-05: DR & Invariants** | Строгие инварианты восстановления БД | **DONE** | Клиент PostgreSQL 17 в CI/DR, проверка 22 RLS таблиц, runtime-роли, A/B cross-isolation (0 строк), раздельный отчёт SQL stream vs operational recovery |
| **P0-A: Секреты и Fail-Fast** | Удаление дефолтных паролей из Compose | **DONE** | В `docker-compose.staging.yml` удалены fallback-значения, используется `${VAR:?Required}` |
| | Синхронизация переменных окружения | **DONE** | Согласованы `DB_PASSWORD`, `PLATFORM_IP_ALLOWLIST`, `SMTP_FROM`. Создан `.env.staging.example` |
| | Защита образов в `.dockerignore` | **DONE** | Исключены `.env*`, `backups/`, `*.sql`, `*.dump`, `logs/`, `test-results/` |
| | Least-privilege runtime API | **DONE** | Контейнер API не имеет admin DB credentials, работает строго под `crm_app_user` |
| | Негативные security assertions | **DONE** | Тест `test_staging_and_production_fail_fast_validation` подтверждает падение при слабых ключах/паролях |
| **P0-B: Platform IP Allowlist** | Блокировка при пустой настройке (Fail-Closed) | **DONE** | В staging/prod пустой allowlist вызывает startup error или HTTP 403 Forbidden |
| | Антиспуфинг `X-Forwarded-For` | **DONE** | Nginx перезаписывает `X-Real-IP` и `X-Forwarded-For` на `$remote_addr`. Backend игнорирует заголовки от недоверенных пиров и валидирует цепочку справа налево |
| | Поддержка CIDR IPv4/IPv6 | **DONE** | Реализована в `is_ip_allowed()`, покрыта тестом `test_ip_allowlist_cidr_and_anti_spoofing` |
| | Защита Platform Console в API | **DONE** | `enforce_platform_ip_allowlist` подключен как зависимость ко всем `/api/v1/platform/*` |
| **P0-C: Reverse Proxy и TLS** | HTTPS / TLS Listener в Nginx | **DONE** | Добавлен `listen 443 ssl` в `nginx/staging.conf`, порты 80 перенаправляют через HTTP 301 на HTTPS |
| | Ограничение domain suffixes | **DONE** | Серверные блоки ограничены конкретными доменными суффиксами (`*.staging.crm.internal`, `*.localhost`), неизвестные домены возвращают 404 |
| | Актуализация STAGING RUNBOOK | **DONE** | Исправлены имена сервисов (`postgres`, `migration-runner`, `api`, `frontend`, `proxy`), пути health probes (`/health/live`, `/health/ready`), добавлены команды с `--env-file` |
| **P0-D: Disaster Recovery** | Совместимость с PostgreSQL 17 | **DONE** | В CI настроен официальный репозиторий PGDG 17 (`postgresql-client-17`), `backup_db.py` логирует версию утилиты |
| | Нетерпимость к ошибкам psql | **DONE** | В `restore_db.py` добавлен `-v ON_ERROR_STOP=1`, любой ненулевой exit code вызывает `RuntimeError` |
| | Обязательный манифест SHA-256 | **DONE** | Отсутствие манифеста или несовпадение хеша немедленно прерывает восстановление |
| | Проверка runtime-роли и RLS после DR | **DONE** | Восстановленная БД тестируется непривилегированным пользователем: 0 строк без контекста тенанта, изолированные строки с контекстом |
| | Честные метрики RTO и RPO | **DONE** | Измеренный SQL restore: 1.69 – 2.26 сек. RTO приложения: ~30-60 сек. RPO: до 1 часа при локальном cron |
| | Автоматический offsite backup | **BLOCKED** | Отсутствует внешнее хранилище (S3/GCS). Честно отмечено **BLOCKED**, локальные дампы подтверждены |
| **P1: Эксплуатационные проверки** | Отключение открытых `/docs` и `/openapi.json` | **DONE** | В Staging/Production интерактивная документация FastAPI отключена по умолчанию |
| | Bootstrap первого администратора | **DONE** | Переменные `INITIAL_PLATFORM_OWNER_*` проброшены в `migration-runner`, runbook обновлён |
| | Email-доставка с аудитом | **DONE** | При отсутствии боевого SMTP фиксируется `manual_channel_required` со статусом `sent=false` |
| | Достоверность тестов E2E | **DONE** | Убраны условные ветвления, в cross-tenant тесте зафиксирован строгий `expect(customers.length).toBe(0)` |
| | Свежие скриншоты без скелетонов | **DONE** | В `tests/e2e/pilot_readiness.spec.ts` добавлены ожидания загрузки контента и проверка отсутствия скролла на 320/390/1280px |
| **Внешняя инфраструктура** | Публичный DNS и боевой Wildcard SSL | **BLOCKED** | Требуется регистрация публичной DNS-зоны и боевой выпуск сертификатов |
| | Боевой эквайринг и SMS-шлюз | **BLOCKED** | Требуются юридические договоры с банком и сотовыми операторами |

---

## 2. Условия допуска к Закрытому Пилоту (Staging Pilot Gate)

Проведение закрытого пилота **РАЗРЕШАЕТСЯ ИСКЛЮЧИТЕЛЬНО** при следующих условиях:
1. Количество пилотных организаций строго ограничено: **1–2 партнёрских салона**.
2. Доступ осуществляется через внутреннюю сеть / VPN или выделенный Staging-сервер с настроенным `PLATFORM_IP_ALLOWLIST`.
3. Реальные персональные данные клиентов до подписания соглашений и включения боевого TLS не загружаются.
4. Владельцы салонов уведомлены о проведении предварительного тестирования.
5. Резервное копирование выполняется ежедневно с верификацией контрольных сумм по регламенту [`RESTORE_RUNBOOK.md`](RESTORE_RUNBOOK.md).
