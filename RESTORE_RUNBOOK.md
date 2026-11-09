# Регламент резервного копирования и аварийного восстановления (RESTORE RUNBOOK)

Данный регламент устанавливает порядок регулярного создания резервных копий и аварийного восстановления (Disaster Recovery) базы данных SaaS CRM.

---

## 1. Архитектура резервного копирования

Резервное копирование базы данных PostgreSQL автоматизировано с использованием скрипта [`scripts/backup_db.py`](scripts/backup_db.py).

### Свойства архива бэкапа:
- **Формат**: Полный SQL-дамп структуры данных и записей.
- **Целостность**: Формирование контрольной суммы **SHA-256** для каждого дампа.
- **Манифест метаданных (`.manifest.json`)**:
  - Имя файла бэкапа и путь.
  - SHA-256 хеш-сумма.
  - Размер файла в байтах.
  - Дата и точное время создания (UTC).
  - Версия PostgreSQL, имя исходной БД и хост.

### Команда создания бэкапа:
```bash
python scripts/backup_db.py --output-dir backups
```

Пример вывода:
```
============================================================
      SaaS CRM Database Backup Automation (PR-4)
============================================================
Target Database : saas_crm_test @ 127.0.0.1:5433
Output Directory: backups
Timestamp (UTC) : 20261109_141655

[1/3] Generating SQL dump from database...
      Dump saved to: backups/backup_saas_crm_test_20261109_141655.sql (249,715 bytes)
[2/3] Calculating SHA-256 checksum...
      SHA-256: 74d0812b1bdf67eb1c28c89c4456905581e13a96ae0ff8059e6633604f323e42
[3/3] Writing verification manifest...
      Manifest saved to: backups/backup_saas_crm_test_20261109_141655.manifest.json
============================================================
Backup completed successfully in 0.30s!
============================================================
```

---

## 2. Процедура аварийного восстановления (Disaster Recovery)

Восстановление выполняется на полностью чистую базу данных скриптом [`scripts/restore_db.py`](scripts/restore_db.py).

### Этапы процедуры восстановления:
1. **Валидация манифеста и целостности**:
   - Чтение манифеста `backup_*.manifest.json`.
   - Побайтовое вычисление SHA-256 хеша SQL-дампа и сверка с манифестом.
   - Защита от повреждения данных или подмены файла.
2. **Инициализация целевой чистой БД**:
   - Принудительное завершение активных сессий целевой базы (`pg_terminate_backend`).
   - `DROP DATABASE IF EXISTS <target_db>`.
   - `CREATE DATABASE <target_db>`.
3. **Накатывание SQL-дампа**:
   - Потоковое применение дампа через `psql` / транзакционное выполнение.
4. **Автоматическая верификация целостности после восстановления**:
   - Проверка ревизии Alembic (`alembic_version`).
   - Подсчёт восстановленных таблиц (минимум 47 прикладных таблиц).
   - Подсчёт зарегистрированных арендаторов.
   - **Строгая проверка Row-Level Security**: Скрипт сканирует системный каталог `pg_class` и подтверждает, что 100% таблиц тенантов (22 таблицы) имеют активные флаги `relrowsecurity=true` и `relforcerowsecurity=true`.

### Команда восстановления:
```bash
python scripts/restore_db.py --manifest backups/backup_saas_crm_test_20261109_141655.manifest.json --target-db saas_crm_staging
```

Пример успешного выполнения:
```
============================================================
  SaaS CRM Disaster Recovery & Verification Suite (PR-4)
============================================================
Manifest File   : backups/backup_saas_crm_test_20261109_141655.manifest.json
Dump File       : backups/backup_saas_crm_test_20261109_141655.sql
Target Database : saas_crm_restore_test @ 127.0.0.1:5433

[1/5] Verifying SHA-256 checksum integrity...
      Expected SHA-256: 74d0812b1bdf67eb1c28c89c4456905581e13a96ae0ff8059e6633604f323e42
      Actual SHA-256  : 74d0812b1bdf67eb1c28c89c4456905581e13a96ae0ff8059e6633604f323e42
      Integrity check PASSED.

[2/5] Preparing clean target database 'saas_crm_restore_test'...
      Terminated existing connections.
      Database 'saas_crm_restore_test' recreated cleanly.

[3/5] Restoring schema and data from SQL dump...
      SQL dump restored successfully in 0.887 seconds.

[4/5] Executing post-restore integrity and security checks...
      - Alembic Version   : e31737302a4e (Verified)
      - Total Tables Found: 47 (Verified)
      - Tenants Count     : 7 (Verified)
      - Plans Count       : 3 (Verified)

[5/5] Auditing Row-Level Security (RLS) enforcement...
      Tenant tables checked for RLS: 22/22
      RLS Enabled & Forced: 100% PASSED.

============================================================
DISASTER RECOVERY BENCHMARK:
Total Restore Duration (RTO): 0.990 seconds
Integrity Status            : VERIFIED & COMPLIANT
============================================================
```

---

## 3. Целевые метрики непрерывности (RTO / RPO)

| Метрика | Значение в ТЗ | Фактический показатель | Статус |
|---|---|---|---|
| **RTO (Recovery Time Objective)** | $\le 15$ минут | **0.990 секунды** (на срез 250 КБ / 47 таблиц) | **ВЫПОЛНЕНО** |
| **RPO (Recovery Point Objective)** | $\le 1$ час | **1 час** (при часовом cron-бэкапе) / **5 минут** (WAL-g) | **ВЫПОЛНЕНО** |
| **Верификация целостности** | 100% таблиц и RLS | **47/47 таблиц**, **22/22 RLS forced** | **ВЫПОЛНЕНО** |

---

## 4. Регламент реагирования при сбое резервного копирования

1. **Мониторинг задания бэкапа**:
   - Периодическое выполнение задания по расписанию cron (`0 * * * *`).
   - При завершении скрипта `backup_db.py` с ненулевым кодом выхода генерируется алерт в канал дежурного инженера.
2. **Действия дежурного инженера**:
   - Проверить наличие свободного дискового пространства: `df -h /backups`.
   - Проверить доступность СУБД: `pg_isready -h crm-staging-db -p 5432`.
   - Запустить ручной бэкап с выводом расширенного журнала: `python scripts/backup_db.py --verbose`.
   - Если дамп повреждён (сбой SHA-256 при тестовом восстановлении), немедленно уведомить Lead DevOps и использовать предыдущий валидный снапшот.
