# Задание веб-/код-агенту — реализовать backend SaaS Booking & CRM

Ты — ведущий backend-инженер и архитектор. Твоя задача — **написать работающий backend**, миграции, API, автоматические тесты, инфраструктуру локального запуска и документацию для нашей multi-tenant SaaS-платформы онлайн-записи и CRM. Не ограничивайся рекомендациями, макетами, заглушками и «примерной архитектурой».

## Входные материалы (обязательны)

1. **`платформа саас.html`** — наш дизайн-лист из трёх продуктовых интерфейсов: публичная онлайн-запись, CRM компаний, внутренняя Platform Console. Извлеки реальные бизнес-сценарии, поля, статусы, роли, показанные состояния. **Это дизайн-прототип, а не работающий frontend.** Не путай визуальные демонстрационные цифры и тестовые данные с настоящими сущностями и правилами.
2. **`SAAS_BACKEND_ARCHITECTURE_V1.md`** — полное архитектурное ТЗ: бизнес-правила, модель данных, security, RLS, endpoint inventory, состояния, Booking Engine, тесты, этапы и критерии сдачи. **Выполнить все P0 и максимально возможные P1**. Отмечать документированно каждое обоснованное изменение архитектуры.

## Принцип продукта

У каждой компании — собственная онлайн-запись на выделенном поддомене и собственное рабочее пространство CRM. Наш сайт не является каталогом компаний или маркетплейсом. Десятки/тысячи подключённых бизнесов работают через **один экземпляр Booking frontend**, общий CRM frontend и отдельный frontend Platform Console. У нас нет отдельного сервера/сборки/базы для каждой компании.

```text
barberhouse.book.example.kz -> Booking frontend -> /api/v1/public/*
moderncut.book.example.kz  -> тот же Booking frontend, другой tenant
app.example.kz             -> Business CRM -> /api/v1/business/*
console.example.kz         -> Platform Console -> /api/v1/platform/*
api.example.kz             -> единый модульный backend
PostgreSQL                 -> shared tables, tenant_id, forced RLS
```

Все доменные имена в документах — условные примеры. Выбери конфигурацию через ENV.

## Жёсткие архитектурные решения

- Backend: Python 3.12+, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, Pydantic v2, pytest. Модульный монолит, а не микросервисы; не привязывай бизнес-логику к UI или контроллерам. OIDC для staff authentication — готовый провайдер, а не собственный JWT/login-protocol.
- Runtime PostgreSQL role не имеет `BYPASSRLS`; каждая tenant-таблица защищена `tenant_id`, RLS `USING` + `WITH CHECK`, composite foreign keys и независимыми тестами cross-tenant. Trusted tenant context выставлять транзакционно после проверки членства пользователя или подтверждённого публичного домена; никогда не доверять tenant ID от браузера.
- Booking Engine общий для публичной записи и ручного создания через CRM. `availability/search` отдельно от `bookings/create`. Мастер, рабочее расписание, перерывы, отпуска, блокировки, длительность услуг, индивидуальная цена мастера, timezone и другие записи должны быть учтены. Никакого overbooking. PostgreSQL exclusion constraint по `staff_occupancies` + транзакции + тесты одновременных запросов.
- Клиент может выбрать услугу, мастера или время первым. Есть режим «любой мастер», несколько услуг с одним мастером, подтверждение реально рассчитанных длительности и цены. После commit запись сразу `confirmed`. Публичный клиент не создаёт аккаунт CRM.
- Разделить `users` и `customers`, `tenant` и `branch`, компанию/подписку/платёж/модуль/бронь по status machines. Содержимое клиентских записей и PII не раскрывать Platform Console по умолчанию.
- Подписки MVP: trial 14 дней, grace 7 дней, после grace `expired_pending_action` и **ручная приостановка**, а не автоматический hard-block; прежние записи сохраняются, CRM read-only, новые публичные записи blocked. Реактивация и причины в аудите.
- Тарифы/лимиты и feature overrides с версионированием и сроком истечения; разделить «модуль выпущен», «разрешён планом» и «внешний провайдер подключён». SMS, WhatsApp, онлайн-платежи, виджеты для других ниш не имитировать как реально подключённые.
- CRM: календарь, записи/статусы/перенос/отмена, блокировки, клиентская база, команда/графики, услуги и цены, публикация онлайн-записи, базовые отчёты, роли/филиалы. Platform Console: компании, onboarding, роли, подписки, ручная финансовая история, модули, лимиты, домены, поддержка, аудит.
- Public site разрешает анонимно получить только опубликованное. Access к CRM и платформе защищён на каждом endpoint. Поддержка не «логинится владельцем» без явного одобрения, ограниченного scope, expiry и аудита.
- Не выводить в логи токены и PII; привязка домена проверенная; rate limits против массовых броней; безопасные invites и booking management links; outbox + retries после commit.

## Важные противоречия исходного дизайна

Не копируй противоречия в backend. Зафиксируй их в `docs/DECISIONS.md`:

1. В бизнес-CRM отмена клиентом «за 3 часа», в публичном дизайне «за 2 часа»: **истина — значение из `booking_policies` конкретной компании/филиала**; seed-default 180 минут, публичный текст — динамический.
2. В Platform Console в льготном периоде упоминается выключение онлайн-записи на 8-й день, но автоприостановка в настройках выключена: **использовать `expired_pending_action` + ручной suspend** для MVP.
3. Публичный прототип содержит тестовые будущие состояния «ожидает подтверждения» и «SMS-код»: **не включать** их в основной поток MVP; автоматическое confirmed.
4. Колонка «Оплата» на экранах смешивает trial/grace/suspended/paid: **отдельные enum и таблицы**.
5. В каталогах модули в разработке иногда отмечены разрешёнными компании: не считать «активацию по тарифу» фактической готовностью интеграции.
6. Демонстрационные тарифы Start/Pro/Business и суммы являются примером, а не действующим договором. Seed fixture, не production constants.

## План выполнения (кодировать, а не только описывать)

**0. Инвентаризация**. Изучи все три дизайн-листа. Создай матрицу экран/сценарий -> API -> таблицы -> role -> tested state. Выбери архитектуру в ADR. Составь реальный план работ, но сразу приступай к реализации.

**1. Основа**. Создай backend app, Docker Compose, PostgreSQL, migrations, OIDC dev, global identities + memberships + branches + verified host resolution, strict permission layer, RLS + composite FKs. Seed 2 независимых tenant. Доказать cross-tenant запрет HTTP и SQL тестами.

**2. CRM-домен**. Модели/CRUD для мастеров, staff_service_offers (цена/длительность), категорий/услуг, филиалов, клиентов, графиков, обедов, отпусков, исключений и правил записи. Полные валидаторы, tests.

**3. Booking Engine**. Доступность, multiple services, any master, pricing snapshot, quote, create, reschedule, cancel, state transitions, booking history; SQL exclusion + atomic transactions + idempotency; conflict 409, price changed 409, capacity rules. **Гейт: 2 параллельные брони на один интервал — одна успешная, одна 409.**

**4. Public API + CRM API**. Три входных порядка записи, deep link конкретного мастера, booking management token; CRM календарь день/неделя/список, записи и staff roles. Server-side домен определяет tenant, неизвестный домен 404, нет каталога бизнеса.

**5. Platform Console API**. Создание компании и owner invitation, план/подписка, trial/grace/manual suspension, manual charges/payments ledger, versioned plan changes, override limits, non-PII aggregates, domains (future custom domain lifecycle). Сценарии suspend/reactivate должны менять и CRM, и public booking.

**6. Support/Audit/notifications**. Support tickets, limited-access request/owner approval/revoke/expiry, audit old/new/reason/actor, outbox, dev email adapter; без незаявленных внешних услуг.

**7. Проверка и сдача**. Реальный `docker compose up --build`, migrations, unit/integration/e2e tests, OpenAPI, README, ADR, security checklist, restore instructions, healthcheck, роль/permission matrix; test report с PASS/FAIL и командами.

Каждый этап закрывать только проверкой. Не писать DONE без теста. Если объём слишком велик — приоритет этапам 1–5 и P0 безопасности/Booking Engine, а недоделки зафиксировать явно вместо создания fake implementations.

## Обязательные тесты на выходе

1. Tenant A не читает/не меняет staff/customer/bookings tenant B ни через API, ни через SQL, ни подстановкой UUID или Header.
2. Один и тот же backend/Booking frontend обслуживает два разных поддомена без утечки данных.
3. Два одновременных бронирования одного мастера на один интервал: только один commit. `calendar block` тоже участвует в том же SQL constraint.
4. Цена/длительность зафиксированы в booking_items; изменение прайса не редактирует старую запись. Устаревший quote вызывает 409.
5. Две услуги у одного мастера рассчитываются последовательно; не пролезают через перерыв/смену.
6. Пробный/льготный/ручная приостановка/реактивация отражается во всех точках API.
7. CRM master/admin/owner и platform support/finance/owner permissions не дают эскалации.
8. Public API не раскрывает чужие контакты клиентов, отмена/перенос требует secure management token.
9. Retry с одним Idempotency-Key не создаёт вторую бронь или второй платёж.
10. Критичные операции оставляют audit + outbox без передачи реальных событий до commit.

## Результат

Сдай **архив реального изменённого исходного кода**, SQL migrations, compose/config without secrets, tests, OpenAPI, ADR, README, test report, схемы/таблицы, способ развёртывания, `KNOWN_LIMITATIONS.md`, список фактически сделанных endpoints и точные команды локального запуска. Сделай ZIP-пакет для независимого аудита (включая код, миграции, тестовые фикстуры, критические конфиги, не только markdown). На финале сообщи `DONE / PARTIAL / BLOCKED` по каждому этапу и результаты тестов. **Не коммить/пушить в удалённый репозиторий и не развёртывать в production без разрешения.**

Работай как исполнитель. Не отдавай мне обратно выбор основных решений, уже заданных в документе. Для реально блокирующих неоднозначностей выбери безопасный, минимальный, документированный вариант и продолжай; если вопрос затрагивает деньги, данные клиентов или отказ в доступе — не делай необратимых действий без утверждения.
