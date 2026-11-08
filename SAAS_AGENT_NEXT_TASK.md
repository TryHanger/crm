# Задание агенту — исправление и доведение backend после независимого аудита

Вход: `SAAS_PLATFORM_BACKEND_DELIVERY_V1.zip`, исходный HTML `платформа саас.html`, `SAAS_BACKEND_V1_INDEPENDENT_AUDIT.md`; git-репозиторий `https://github.com/TryHanger/crm.git`.

Ты уже написал основу FastAPI, но независимый аудит выявил P0-блокеры. **Не объявляй работу завершённой, не начинай с косметических endpoint-ов, не переписывай монолит с нуля.** Исправляй существующую реализацию по gate-ам ниже и проверяй каждый реальными тестами.

## Gate A: воспроизводимость

- Проверить git remote и текущую ветку, не затирать исходный frontend; работать в `fix/backend-v1-audit`, разрешён push этой ветки, без force push.
- Вернуть `pyproject.toml` с pinned reproducible dependencies (или lock), исправить Dockerfile, docker-compose (DB_HOST=postgres, DB_PORT=5432, секреты только через .env), `.gitignore`, dev/test/prod profiles.
- Автоматизировать безопасное создание роли `crm_app_user` и минимальных grants; для Alembic отдельный admin migration DSN.
- Оставить ОДИН путь изменения схемы — Alembic. Перенести в миграции функцию lookup_public_management_token, exclusion, RLS, permissions; проверить повторный `upgrade head` и чистую БД. Не применять `Base.metadata.create_all` как альтернативу production migrations.
- Отдельная test-DB, fail-fast fixture при имени DB без суффикса `_test` и при ENV production, никаких тестовых seed-аккаунтов с универсальными паролями в non-test окружении.

## Gate B: безопасность

- Полностью устранить `dev_secret_hash => True` и onboarding нового owner с mock password. Реализовать безопасный invite/setup-password/token verification либо корректный OIDC adapter.
- Вынести JWT и DB credentials из кода; fail-fast production без сильных значений, ограниченный CORS, безопасные cookie/token storage и auth rate limits.
- Реализовать матрицу объектного доступа для ролей owner/admin/master (master только собственные записи и доступные действия). Проверить прямое GET чужого booking_id, чужого customer_id, отмену чужого booking и доступ к reports.
- Разделить platform DB privileges и tenant DB privileges; изучить 14 tenant_id таблиц без RLS, применить изоляцию/политику на каждую, сохранив работу нужных platform операций. Снять `GRANT ALL` по умолчанию. Обеспечить отказ закрытых методов при отсутствии tenant-context.
- Убрать доверие к произвольному `X-Forwarded-Host`, разграничить verified host/custom domain, tenant и границы доступа. Избавиться от implicit marketing_consent=True.

## Gate C: Booking Engine — единый путь проверки

- Вынести единый проверяющий сервис для `GET availability`, `POST public/bookings`, `POST business/bookings` и любых переносов, используемый транзакционно перед записью в БД.
- Строго проверять: tenant+branch, subscription/suspended, публикацию/feature, active staff и оффер, минимум одну услугу, duration/price >0 и валюту, график и перерывы, отпуска и блокировки, local IANA timezone, запись в прошлом, мин. интервал до записи, горизонты, разрешение self-reschedule/cutoff, валидные статусы, master permission. Возвращать стабильные коды ошибок.
- При смене мастера пересчитать пригодность услуг, цену и длительность; либо потребовать новое согласие клиента, либо запретить несовместимый перенос. Оставить PostgreSQL EXCLUDE constraint окончательной защитой от гонки.
- Сделать честный quote/price drift protocol: quote_id должен существовать и проверяться ИЛИ убрать его и ввести stateless signed quote; не сообщать выдуманное TTL. Исправить idempotency replay: нельзя возвращать `IDEMPOTENT_REPLAY` в management URL. Проверить tenant/scope/request hash.

## Gate D: тесты и приёмка

1. Чистый Docker build + health + миграции на PostgreSQL 17; лог версии.
2. Попытка входа demo account любым паролем запрещена; платформа требует реального auth.
3. Tenant A/B: прямые чужие ID, membership, support, billing и RLS. Роли owner/admin/master.
4. Публичный POST с занятым временем, ночью, в перерыве, в отпуске, в прошлом, с незапланированным мастером, в другом филиале, с пустой услугой и после suspension — ошибка, записей в БД нет.
5. Перенос после cutoff, после завершения, к неподходящему мастеру и в его отпуск — отказ, исходная запись цела.
6. Параллельная гонка 20–50 попыток: ровно 1 success; существующие брони не затронуты.
7. Повторный POST с тем же Idempotency-Key — стабильный ответ без испорченной management URL; другой payload под тем же key — 409.
8. Смена цены/длительности между quote и submit даёт чёткий конфликт, без создания записи.
9. Финансовая операция с суммой отличной от начисления не может молча маркировать весь счёт как paid.
10. Проверить локальный день филиала и границу суток при IANA timezones, UTC сохранение, корректность календаря.
11. Клиент из домена Tenant A никогда не получает детали Tenant B даже при подмене Host/X-Forwarded-Host; проверка неизвестного домена.
12. По крайней мере один E2E из реального frontend после интеграции (если frontend пока только HTML-макет — явно указать это как ограничение).

## Gate E: после P0

- Закрыть недостающие MVP CRUD: смены/перерывы/отпуска, редактирование услуг/категорий/клиентов/мастеров, тарифные лимиты, renewal/plan change, домены, приглашения, support request approval/rejection, audit.
- Реализовать worker с outbox + retry, если email/уведомления реально заявлены; иначе честно пометить Deferred.
- Сверить все endpoints с экранами HTML-дизайна, сделать Coverage Matrix: экран/действие -> API -> статус (Implemented, Partial, Missing), без искусственного PASS для статических макетов.
- По завершении — подключить три настоящих frontend-проекта, оставляя дизайн неизменным. Если это отдельно утверждаемый этап, предоставь контракт интеграции вместо фиктивной демонстрации.

## Отчётность и публикация

После каждого gate — код, миграции, зависимости, команды, версии, test log, git diff/status, что действительно запускалось. Итоговый ZIP должен содержать полный актуальный проект + `AUDIT_FIXES.md`, `SECURITY_GATES.md`, `COVERAGE_MATRIX.md`, `KNOWN_LIMITATIONS.md`. Запушить в `TryHanger/crm` в feature branch `fix/backend-v1-audit` (разрешение пользователя есть), указать ссылку и полный commit SHA. Не выдавай LOCAL за PUSHED, тестовый лог без запуска — за PASS, мок — за реализованный production flow. Не публикуй секреты.
