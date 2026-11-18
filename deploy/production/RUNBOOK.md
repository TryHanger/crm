# Production runbook (M16)

Один хост, Docker Compose: PostgreSQL 17, миграции, API, воркер уведомлений, статика трёх SPA, nginx и Let's Encrypt.
Файлы: [docker-compose.production.yml](docker-compose.production.yml), [nginx/default.conf.template](nginx/default.conf.template),
[.env.production.example](.env.production.example), [Dockerfile.ops](Dockerfile.ops).

Команда ниже везде сокращена до `dc`:

```bash
alias dc='docker compose -f deploy/production/docker-compose.production.yml --env-file deploy/production/.env.production'
```

## 1. DNS

| Запись | Тип | Значение | Зачем |
|---|---|---|---|
| `console.<ROOT_DOMAIN>` | A / AAAA | IP хоста | Platform Console (вход только с `PLATFORM_IP_ALLOWLIST`) |
| `app.<ROOT_DOMAIN>` | A / AAAA | IP хоста | CRM салонов |
| `api.<ROOT_DOMAIN>` | A / AAAA | IP хоста | API, `/health/*` для мониторинга |
| `*.<BOOKING_ROOT>` | A / AAAA | IP хоста | сайты записи `<slug>.<BOOKING_ROOT>` |
| `_acme-challenge.<BOOKING_ROOT>` | TXT | выдаёт certbot | DNS-01 для wildcard-сертификата |
| домен отправителя писем | TXT | SPF, DKIM, DMARC от SMTP-провайдера | письма клиентам не попадают в спам |
| CAA `<ROOT_DOMAIN>` | CAA | `0 issue "letsencrypt.org"` | сертификат выпускает только Let's Encrypt |

Свой домен салона (`zapis.salon.kz`) — CNAME на `<slug>.<BOOKING_ROOT>` и отдельный сертификат (раздел 2). Домен считается подтверждённым только после записи в `tenant_domains` с `verification_status = verified`.

Проверка: `dig +short app.<ROOT_DOMAIN>`, `dig +short test.<BOOKING_ROOT>`.

## 2. TLS

Сертификаты лежат в томе `letsencrypt`. nginx читает их только на чтение.

1. **Основной сертификат (HTTP-01)** для console/app/api. Первый выпуск выполняется до старта nginx в режиме standalone (порт 80 свободен):
   ```bash
   docker run --rm -p 80:80 -v saas_crm_prod_letsencrypt:/etc/letsencrypt certbot/certbot:v3.0.1 certonly --standalone \
     -d console.<ROOT_DOMAIN> -d app.<ROOT_DOMAIN> -d api.<ROOT_DOMAIN> --cert-name <ROOT_DOMAIN> -m <email> --agree-tos -n
   ```
   Продление: сервис `certbot` в compose делает `certbot renew --webroot` каждые 12 часов. После продления: `dc exec proxy nginx -s reload`. Добавьте это в ту же cron-задачу, что и мониторинг.
2. **Wildcard `*.<BOOKING_ROOT>` (DNS-01)** выпускается DNS-плагином провайдера или в ручном режиме:
   ```bash
   docker run --rm -it -v saas_crm_prod_letsencrypt:/etc/letsencrypt certbot/certbot:v3.0.1 certonly --manual \
     --preferred-challenges dns -d '*.<BOOKING_ROOT>' --cert-name wildcard.<BOOKING_ROOT> -m <email> --agree-tos
   ```
   Ручной режим не продлевается сам. Настройте плагин DNS-провайдера до запуска пилота или поставьте напоминание за 30 дней (мониторинг предупредит за 14).
3. Проверка: `python scripts/monitor_check.py --hosts app.<ROOT_DOMAIN>,console.<ROOT_DOMAIN>,api.<ROOT_DOMAIN>,demo.<BOOKING_ROOT> --no-db --no-backup`. Должны быть только строки `OK`. Конфигурация nginx проверяется командой `dc exec proxy nginx -t`.

## 3. Первый запуск

1. Хост: Ubuntu 24.04 LTS, Docker 27+, открыты только порты 22 (по ключу), 80 и 443. Включены автоматические обновления безопасности.
2. `cp deploy/production/.env.production.example deploy/production/.env.production && chmod 600 deploy/production/.env.production`. Заполните все переменные. Секреты генерируются командой `python scripts/generate_staging_secrets.py`, ключ бэкапа — командой `python scripts/offsite_backup.py --generate-key`. **Ключ бэкапа храните также вне хоста** (менеджер паролей владельца платформы): без него offsite-копия бесполезна.
3. `dc build && dc up -d`. Миграции выполняет сервис `migrate`, API стартует только после его успешного завершения. При пустых или слабых секретах, демо-данных, `SMTP_SECURITY=none` или пустом allowlist консоли API в production не стартует: проверьте `dc logs migrate api`.
4. `curl -fsS https://api.<ROOT_DOMAIN>/health/ready`, затем вход в консоль первым владельцем платформы (`INITIAL_PLATFORM_OWNER_*`). Пароль смените сразу.
5. Сделайте первый бэкап и сразу проведите учения восстановления (раздел 5).

## 4. Регламент обновления

Окно: будни 22:00–23:00 Алматы, не позже чем за сутки предупредить салоны. Без пятничных релизов.

1. CI ветки зелёный: pytest, smoke, e2e.
2. `dc --profile ops run --rm backup` — бэкап перед обновлением. Без статуса `UPLOADED` не продолжайте.
3. `git fetch && git checkout <tag>`, в `.env.production` задайте `RELEASE_TAG=<tag>`.
4. `dc build && dc up -d`. Миграции накатываются сервисом `migrate`. Все ревизии additive: старый код работает на новой схеме.
5. Проверка: `/health/ready`, вход в CRM, тестовая запись на сайт демо-салона, письмо дошло, `monitor_check.py` весь `OK`.
6. **Откат кода:** верните `RELEASE_TAG` на прошлый тег и выполните `dc up -d api outbox-worker frontend`. Схему не откатывайте. Downgrade финансовых ревизий запрещён, если в журнале уже есть данные (ревизия 010 откажется сама).
7. **Откат данных** — только через восстановление (раздел 5), с решением владельца платформы и записью в журнале инцидентов.

## 5. Бэкапы и восстановление

- **Расписание:** таймер хоста раз в сутки в 03:00 запускает `dc --profile ops run --rm backup`. Это `pg_dump` → gzip → AES-256-GCM → загрузка в S3-совместимое хранилище (`OFFSITE_S3_*`), подпись запросов AWS SigV4. Наружу уходят только шифртекст и манифесты; ключ хост не покидает.
- **Хранение:** lifecycle-правило бакета — 35 дней для ежедневных, 12 месяцев для копий 1-го числа. Бакет в другом ЦОД/регионе, ключ доступа только на запись и чтение этого префикса.
- **Восстановление последней копии** (в изолированную БД `*_test`, рабочую не трогает):
  ```bash
  dc --profile ops run --rm backup python scripts/offsite_backup.py --restore-latest --target-db saas_crm_restore_test
  ```
  Скрипт проверяет SHA-256 скачанного архива, расшифровывает, накатывает, проверяет ревизию Alembic, число таблиц, FORCE RLS на всех `TENANT_TABLES`, изоляцию компаний A/B и runtime-роль без контекста.
- **Учения (раз в месяц и после изменения схемы):** `--drill` выполняет бэкап, загрузку, удаление локальной копии, скачивание и восстановление. Отчёт `offsite_drill_report.json` прикладывается к журналу эксплуатации. Последний прогон: см. `docs/sprints/M16-D2.md`.
- **Полная авария хоста:** новый хост по разделу 3 → `--restore-latest` в `saas_crm_restore_test` → проверка → переименование БД (`ALTER DATABASE … RENAME`) при остановленных `api` и `outbox-worker` → `dc up -d`. Целевое RTO — 2 часа, RPO — 24 часа (суточный бэкап).

## 6. Мониторинг

`scripts/monitor_check.py` запускается cron'ом каждые 5 минут (код выхода 0 / 1 / 2 → алерт в Telegram или на почту дежурного):

```bash
*/5 * * * * cd /opt/crm && dc --profile ops run --rm backup python scripts/monitor_check.py --api https://api.<ROOT_DOMAIN> --hosts "$MONITOR_HOSTS" || notify
```

| Проверка | WARN | CRIT |
|---|---|---|
| `api_ready` (`/health/ready`, база) | — | не 200 |
| `tls:<host>` | < 14 дней | < 7 дней или сертификат недействителен |
| `outbox_backlog` (письма старше 15 мин) | > 0 | > 50 |
| `outbox_failed` за 24 ч | > 0 | — |
| `backup_age` (последний offsite) | — | > 26 ч или бэкапов нет |

Дополнительно внешний uptime-сервис раз в минуту проверяет `https://api.<ROOT_DOMAIN>/health/live` и `https://app.<ROOT_DOMAIN>/`. Логи: `dc logs --since 1h api outbox-worker`. В логах нет паролей, токенов и полных адресов клиентов (M15).

## 7. Инциденты

1. Зафиксировать время, симптом и затронутые компании.
2. Письма не уходят (`outbox_backlog`): `dc logs outbox-worker`. Если провайдер недоступен, события ждут в очереди и уйдут сами. Временно отключить письма: `EMAIL_NOTIFICATIONS_ENABLED=false` и `dc up -d outbox-worker`.
3. Подозрение на утечку: сменить `JWT_SECRET_KEY` (все выйдут из системы), пароли БД и SMTP, ключи S3. Сообщить владельцам салонов в течение 24 часов. Юридические сроки уведомления — по чек-листу `docs/legal/LEGAL_CHECKLIST.md`.
4. Разбор инцидента в течение 3 рабочих дней: причина, что изменили в регламенте.
