# SaaS Online Booking & CRM Platform — Инфраструктурный план эксплуатационного развёртывания (Pilot V1)

**Дата фиксации:** Ноябрь 2026  
**Базовый функциональный коммит:** `6f51d7ed330557ac153fec28e9183363e0cbabf9`  
**Ветка развёртывания:** `feat/pilot-v1-operational-deployment`  
**Цель:** Подготовка инфраструктуры, автоматизации и регламентов для запуска первой реальной компании (пилотного салона) без изменений бизнес-логики и расширения UI.

---

## 1. Сводная матрица инфраструктурных компонентов и статусов

| Компонент / Требование | Техническая реализация в коде | Требуемый внешний ресурс / Решение | Статус готовности |
| :--- | :--- | :--- | :---: |
| **Генератор случайных криптосекретов** | `scripts/generate_staging_secrets.py` (длина >= 28, entropy >= 48 байт, права 0600) | Локальное/CI исполнение без хардкода | **READY** |
| **Строгая TLS SNI / Hostname валидация** | `scripts/verify_staging_deployment.py` (check_hostname=True, positive & negative probes) | Проверено на synthetic SAN/SNI | **READY** |
| **Сквозной E2E через контейнерный HTTPS** | `scripts/verify_staging_e2e_flow.py` (12 шагов: invite → CRM → publication → booking → isolation с валидным JWT) | Проверено через Nginx 443 | **READY** |
| **Non-root контейнер статики фронтенда** | `Dockerfile.frontend` (`USER 101:101`, `cp -a`, Docker HEALTHCHECK, Nginx 200 на всех SPA) | Docker 24+ / Compose v2 | **READY** |
| **Шифрованный Offsite Backup (AES-256-GCM)** | `scripts/offsite_backup.py` (сжатие GZIP + AES-256-GCM 64-hex key + SHA256 манифест) | Локальный архив готов; `local_encrypted_archive_restore_duration_seconds` = 1.73s | **LOCAL READY** |
| **Выделенный боевой сервер (Cloud VPS)** | Спецификация Docker Compose / Nginx / PostgreSQL 17 подготовлена | Покупка/аренда облачного сервера (vCPU/RAM/NVMe) | **BLOCKED** |
| **Реальный публичный домен и DNS** | Поддержка поддоменов `app.*`, `console.*`, `*.book.*` реализована | Покупка домена и делегирование в DNS (Cloudflare/Route53/Yandex) | **BLOCKED** |
| **Доверенный Wildcard TLS (Let's Encrypt)** | Nginx готов принимать `/etc/nginx/certs/fullchain.pem` | Выпуск Certbot DNS-01 через API DNS-провайдера | **BLOCKED** |
| **Удалённое облачное хранилище бэкапов (S3)** | Скрипт `scripts/offsite_backup.py` формирует зашифрованный пакет | Создание S3 бакета и IAM-ключей с версионированием | **BLOCKED** |
| **Юридический контур (ПДн, Оферта, Согласие)** | Логирование маскирует PII, в CRM разделены персональные данные | Юридическое утверждение политики конфиденциальности и договора | **BLOCKED** |

---

## 2. Спецификация серверных мощностей (Production / Staging Host)

### 2.1. Минимальные требования для 1–10 компаний (Pilot Phase)
- **CPU:** 4 vCPU (x86_64, 2.5+ GHz)
- **RAM:** 8 GB ECC RAM (4 GB PostgreSQL + 2 GB API/Nginx + 2 GB OS/Buffers)
- **Дисковая подсистема:** 80 GB NVMe SSD (IOPS >= 3000, ext4/XFS с mount `noatime`)
- **Сеть:** 100 Mbps канал, статический IPv4 (плюс IPv6 при наличии)
- **Операционная система:** Ubuntu 24.04 LTS x86_64 или Debian 12 (Bookworm)
- **Базовый стек ПО на хосте:**
  - Docker CE Engine 27.x+
  - Docker Compose v2.29+
  - PostgreSQL Client 17 (`postgresql-client-17`)
  - OpenSSL 3.x, UFW (Uncomplicated Firewall), Fail2ban

### 2.2. Сетевая безопасность хоста (Firewall)
```bash
# Разрешить loopback и исходящий трафик
ufw default deny incoming
ufw default allow outgoing
ufw allow in on lo

# SSH (рекомендуется сменить порт или ограничить IP)
ufw allow proto tcp from any to any port 22

# Публичный Web-трафик
ufw allow proto tcp from any to any port 80
ufw allow proto tcp from any to any port 443

# Порты PostgreSQL (5432) и API (8000) наружу НЕ открывать:
# Они изолированы во внутренней docker-сети (172.28.0.0/16)
ufw enable
```

---

## 3. Доменная зона, DNS и маршрутизация [BLOCKED]

> [!WARNING]
> Данный раздел требует приобретения домена и доступа к управлению DNS-зоной владельцем проекта. До получения домена статус: **BLOCKED**.

### 3.1. Архитектура поддоменов для первой компании и платформы
Предположим выбранный домен: `<domain.kz>` (например, `crm-platform.kz`):
- `console.<domain.kz>` — Platform Console (управление арендаторами, только для платформы).
- `app.<domain.kz>` — Business CRM (личный кабинет владельцев и администраторов салонов).
- `*.book.<domain.kz>` — Публичные страницы онлайн-записи арендаторов (например, `barberhouse.book.<domain.kz>`, `pilotsalon.book.<domain.kz>`).
- `<domain.kz>` (apex) — Редирект на информационный лэндинг или CRM login.

### 3.2. Требуемые DNS-записи
```dns
# A-записи на статический IPv4 сервера
@                   A       203.0.113.10
app                 A       203.0.113.10
console             A       203.0.113.10
*.book              A       203.0.113.10

# CNAME-запись для wildcard поддоменов записи клиентов
*.book.<domain.kz>. CNAME   app.<domain.kz>.
```

---

## 4. Сертификация Let's Encrypt Wildcard TLS [BLOCKED]

> [!IMPORTANT]
> Для корректной работы онлайн-записи произвольного числа салонов (`<slug>.book.<domain.kz>`) без перезапуска Nginx требуется **Wildcard SSL-сертификат** (`*.<domain.kz>` и `*.book.<domain.kz>`).
> Выпуск Wildcard Let's Encrypt возможен **исключительно** через протокол ACME DNS-01 Challenge (RFC 8555).

### 4.1. Автоматизация выпуска через Certbot DNS-01
```bash
# Установка Certbot с плагином DNS (пример для Cloudflare)
apt-get install -y certbot python3-certbot-dns-cloudflare

# Конфигурация API токена DNS-провайдера (/etc/letsencrypt/cloudflare.ini, chmod 600)
# dns_cloudflare_api_token = <API_TOKEN_WITH_ZONE_DNS_EDIT>

# Команда первичного выпуска
certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  -d "app.<domain.kz>" \
  -d "console.<domain.kz>" \
  -d "*.book.<domain.kz>" \
  --agree-tos \
  -m admin@<domain.kz> \
  --non-interactive
```

### 4.2. Скрипт автоматического обновления (Deploy Hook)
Файл `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`:
```bash
#!/bin/bash
set -e
# Копирование свежих сертификатов в каталог монтирования Nginx
cp -L /etc/letsencrypt/live/app.<domain.kz>/fullchain.pem /opt/crm/nginx/certs/fullchain.pem
cp -L /etc/letsencrypt/live/app.<domain.kz>/privkey.pem /opt/crm/nginx/certs/privkey.pem
chmod 644 /opt/crm/nginx/certs/fullchain.pem
chmod 600 /opt/crm/nginx/certs/privkey.pem

# Перезагрузка Nginx без остановки соединений
docker exec saas_crm_staging_proxy nginx -s reload
```

---

## 5. Управление секретами и процедура ротации

### 5.1. Принцип изоляции секретов
- Секреты **не хранятся в Git**, образах Docker или публичных файлах.
- В файле `.env.staging` (или `.env.production`) пароли генерируются утилитой `scripts/generate_staging_secrets.py`:
  - `POSTGRES_PASSWORD`: 28 символов случайной энтропии
  - `DB_PASSWORD`: 28 символов
  - `JWT_SECRET_KEY`: 64 символа URL-safe
  - `INITIAL_PLATFORM_OWNER_PASSWORD`: 24 символа
- При запуске приложение валидирует секреты через `validate_environment_security()`: если обнаружен любой предсказуемый шаблон или длина пароля < 16 символов (JWT < 32), контейнер немедленно падает с `RuntimeError` (Fail-Fast).

### 5.2. Регламент плановой ротации секретов (раз в 90 дней)
1. **JWT Secret:**
   - Генерация нового токена `JWT_SECRET_KEY_NEW`.
   - При ротации старые активные сессии инвалидируются; пользователи выполняют повторный вход.
2. **База данных (`DB_PASSWORD`):**
   - Шаг 1: `ALTER ROLE crm_app_user WITH PASSWORD '<NEW_PASS>';` через `psql`.
   - Шаг 2: Обновление `.env` на сервере.
   - Шаг 3: Перезапуск API контейнера (`docker compose up -d api`).

---

## 6. Аварийное восстановление (DR) и Offsite S3 бэкапы [BLOCKED]

### 6.1. Архитектура 3-2-1
- **3 копии:** Рабочая БД + локальный дамп на отдельном томе + зашифрованная копия в удалённом S3.
- **2 носителя:** Локальный NVMe диск сервера + удалённое объектное хранилище.
- **1 offsite:** Внешний дата-центр/провайдер (например, Yandex Cloud Object Storage, AWS S3 или Cloudflare R2).

### 6.2. Процесс создания и шифрования (`scripts/offsite_backup.py`)
1. Выполняется чистый дамп `pg_dump` со структурой и данными.
2. Сжатие алгоритмом GZIP (коэффициент сжатия ~8:1).
3. Симметричное аутентифицированное шифрование **AES-256-GCM** с добавлением случайного 12-байтового nonce и 16-байтового auth tag.
4. Вычисление контрольной суммы SHA-256 для каждого этапа (raw, gz, enc).
5. Формирование защищённого манифеста целостности `.offsite_manifest.json`.
6. Выгрузка в удалённый бакет по протоколу HTTPS.

### 6.3. Измеренные метрики локального восстановления архива
- **RPO (Recovery Point Objective):** Задаётся расписанием Cron (рекомендовано: каждые 2 часа в рабочее время; максимальная потенциальная потеря данных при катастрофе хоста — 2 часа).
- **Метрика `local_encrypted_archive_restore_duration_seconds`:** Измеренное время расшифровки и наката дампа:
  - Расшифровка AES-256-GCM: **< 0.01 с**
  - Распаковка GZIP: **0.01 с**
  - Восстановление 47 таблиц и 22 RLS политик в PostgreSQL: **1.13 с**
  - Полное время восстановления локального архива: **1.73 с**.
  > [!NOTE]
  > Данная метрика отражает исключительно локальную распаковку и накат дампа в PostgreSQL. Полный операционный RTO (с учётом provisioning нового сервера, DNS propagation, TLS-сертификации и развёртывания контейнеров) будет измерен в ходе отдельного disaster-recovery drill на выделенном хосте.

### 6.4. Блокирующий фактор для S3
Для включения выгрузки требуется:
- Выделение бакета `s3://crm-backups-offsite`
- Настройка Lifecycle Rule: удаление бэкапов старше 30 дней, перевод в Cold Storage через 14 дней.
- Передача переменных: `OFFSITE_S3_BUCKET`, `OFFSITE_S3_ENDPOINT`, `OFFSITE_S3_ACCESS_KEY`, `OFFSITE_S3_SECRET_KEY`.
- До выделения ресурсов статус удалённой репликации: **BLOCKED** (локальный статус: `LOCAL_ENCRYPTED_BACKUP_READY`, имитация выгрузки не производится).

---

## 7. Защита периметра и ограничение доступа к Platform Console

1. **IP Allowlist:** Доступ к управлению арендаторами (`/api/v1/platform/*`) строго ограничен на уровне Middleware и Nginx. В `.env` задаётся `PLATFORM_IP_ALLOWLIST` (по умолчанию строго ограничен `127.0.0.1,::1,172.28.0.0/16`, без чрезмерно широких подсетей вроде `10.0.0.0/8`).
2. **VPN / Bastion (Рекомендуется для боевого использования):**
   - Настройка WireGuard на сервере (`wg0`, 10.8.0.0/24).
   - `PLATFORM_IP_ALLOWLIST=10.8.0.0/24,127.0.0.1`.
   - Вход в Platform Console возможен только при активном VPN-соединении. Не исключает обязательную JWT-аутентификацию платформенного администратора.

---

## 8. Юридические требования и регламент первого салона [BLOCKED]

> [!WARNING]
> До согласования документов и подписания согласия с первой компанией статус: **BLOCKED**.
> Проведение реального пилота без согласия на обработку ПДн запрещено.

### 8.1. Требования законодательства (Закон РК «О персональных данных и их защите» / 152-ФЗ)
1. **Согласие клиента на обработку ПДн:**
   - Публичная форма записи отображает чекбокс с активной ссылкой на Политику конфиденциальности.
   - Клиент даёт согласие на хранение имени, номера телефона и истории записей для целей бронирования услуги.
2. **Роли оператора и обработчика:**
   - Платформа CRM — обработчик данных (Data Processor).
   - Салон красоты / барбершоп — оператор персональных данных (Data Controller).
   - Между платформой и салоном заключается договор (или оферта) с положением о поручении обработки данных и конфиденциальности.

### 8.2. Аварийный регламент (Failback Plan) для первого пилотного салона
Если во время пилота возникает сбой сервера, ошибка сети или непредвиденная недоступность:
1. **Экстренная деактивация онлайн-записи:**
   - Владелец салона в CRM или платформа через Console переводит `is_published=False` (занимает 1 клик, публичный сайт мгновенно возвращает 404).
   - На случай полного падения хоста: аварийная страница-заглушка на Cloudflare ("Ведутся плановые технические работы, запись по телефону: +7 7xx xxx xx xx").
2. **Дублирование расписания:**
   - В течение первой недели пилота салон ведёт синхронный журнал (экспорт из CRM в начале дня или параллельная фиксация в таблице).
   - Администратор салона подтверждает каждую входящую запись по телефону или WhatsApp до момента стабилизации доверия к сервису.
