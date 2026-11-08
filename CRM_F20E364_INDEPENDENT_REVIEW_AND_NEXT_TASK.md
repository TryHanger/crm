# TryHanger/crm — независимый review ветки feat/booking-frontend-integration

**Аудируемый commit:** `f20e364c34c1641175a987baf1bb5d39dc77c6e9` (2026-11-08)  
**Репозиторий:** https://github.com/TryHanger/crm  
**GitHub Actions:** https://github.com/TryHanger/crm/actions/runs/42489335694  
**Статус:** HOLD для merge / публичного пилота, GO для точечных исправлений и дальнейшей DEV-интеграции.

## 0. Область проверки и честное разграничение доказательств

- Прочитаны фактические файлы GitHub: CI workflow, тесты Playwright, приложение Booking Web, приложение Business CRM, общий API-клиент, backend-маршруты и Booking Engine, код приглашений и конфигурация. Проверена ветка и точный SHA.
- GitHub Actions выполнялся на этом SHA и завершился **failure**. Миграции прошли; сбор pytest остановился на 5 ImportError из-за отсутствия `email-validator`, который нужен Pydantic `EmailStr`.
- Отчёт агента содержит 24 PASS backend и 3 PASS Playwright локально. Это **заявленные результаты**, пока не воспроизведённые CI. Frontend build/Playwright отсутствуют в CI вообще.
- Независимо запустить приложения и просмотреть бинарные PNG через GitHub connector не удалось. Поэтому pixel-perfect сходство с `готовый фронт.html` не подтверждено.
- Ссылка `/pull/new/feat/booking-frontend-integration` — форма создания PR, а не готовый PR. В поиске PR для ветки результатов нет.

## 1. Подтверждённый объём реализации

- `apps/booking-web/` — React/TypeScript/Vite, выбор услуг/мастера/даты, API слотов и броней, экран успеха, `.ics`, заготовка управления бронью.
- `apps/business-crm/` — минимальный календарь и модальное окно статуса, но не полная CRM из дизайн-холста.
- `packages/api-client/` — ручной API-клиент с TS-типами (есть несоответствия контракту).
- `tests/e2e/booking.spec.ts` — 3 локально заявленных сценария; в третьем тесте переключается демонстрационный аккаунт и проверяется заголовок, а не реальная межсистемная синхронизация.
- На уровне backend есть подтверждённые изменения в проверке tenant и quote, RLS-контексте, приглашениях и календаре.
- В `apps/booking-web/package.json` и `apps/business-crm/package.json` указан React `^18.3.1`, а отчёт ошибочно называет React 19.

## 2. P0 — безопасность и воспроизводимость (сделать сначала)

### P0-A. GitHub CI красный

**Наблюдение:** Job `Backend Test Suite (PostgreSQL 17 + Python 3.11)` на SHA f20e364c падает на `pytest` collection с `ImportError: email-validator is not installed` (5 ошибок).  
**Действие:** синхронно добавить обязательную зависимость в `requirements.txt` и `pyproject.toml`, обновить lock, запустить чистую сборку и добиться `green CI` на нужном SHA. В CI добавить `npm ci`, `npm run build --workspaces` и Playwright E2E с поднимаемым API, seeded isolated Postgres и двумя Vite dev/preview servers.

### P0-B. Приглашение позволяет сбросить пароль существующего пользователя

**Файлы:** `apps/api/app/api/v1/auth/routes.py::accept_invite`, `apps/api/app/api/v1/platform/routes.py::create_tenant`.  
**Наблюдение:** токен приглашения разрешает для уже существующей `IdentityUser` заменить `user.password_hash` без входа этим пользователем. В DEV роль support может создать компанию с owner_email существующей учётной записи и получить raw invite token в ответе. Это потенциальная компрометация идентичности, включая аккаунты сотрудников платформы.  
**Действие:** при существующей учётной записи требовать её обычную аутентификацию и проверить совпадение invite email с пользователем; пароль не менять. Новый пользователь создаётся/активируется только по валидному, одноразовому, адресованному ему приглашению. Добавить тест на невозможность захватить чужую существующую учётную запись через invite. Прекратить выдавать raw token сотруднику поддержки за пределами строго изолированных тестовых fixture. Реальная отправка приглашений в production пока не реализована, не считать её DONE.

### P0-C. Frontend CRM не получает tenant context

**Файлы:** `apps/business-crm/src/App.tsx`, `apps/api/app/api/v1/auth/routes.py`.  
**Наблюдение:** frontend берёт `const activeTenantId = me.tenant_id`, но `/auth/me` возвращает `crm_memberships: [{tenant_id,...}]`; tenantId будет undefined.  
**Действие:** реализовать нормальный login form, получение memberships, выбор только разрешённой организации, проверку членства на сервере; убрать автологин и email/password из клиентского bundle. В тестах проверить реальный запрос GET `/business/calendar`, правильный tenant и содержимое записей.

### P0-D. Контракт смены статуса записи сломан

**Файлы:** `packages/api-client/src/index.ts` и `apps/api/app/api/v1/business/routes.py`.  
**Наблюдение:** `BusinessCrmApiClient.updateBookingStatus` посылает `POST`, а endpoint объявлен `PATCH`.  
**Действие:** привести метод к PATCH, унифицировать контракт и протестировать статус при реальном HTTP.

## 3. P1 — продуктовые сценарии и целостность Booking Engine

1. **Management deep-link.** Backend отдаёт `https://{domain}/manage/{token}`, а Booking Web извлекает только `?manage=...`. Сделать корректный маршрут с прямым открытием и refresh, тест от внешней ссылки.
2. **Перенос клиентом.** `ManageBookingScreen` извлекает `service_id`/`staff_id` из `booking.items`, но `/public/manage/{token}` возвращает лишь name/duration/price; использует первый филиал, а не филиал записи. Добавить в ответ необходимые идентификаторы `branch_id`, `staff_id`, `service_ids` в безопасном token-scoped формате. Проверить перенос, отмену и открытие ссылки после перезапуска/в новом браузере.
3. **Quote binding.** `create_booking` проверяет у `BookingQuote` TTL, сумму и продолжительность, но не сравнивает branch/staff/ordered services/start/end с переданным запросом. Сделать quote обязательным для публичной записи и связывать строго с выбранной комбинацией. Негативный тест: quote из другого времени/мастера не принимается.
4. **Idempotency.** В Booking Web ключ создаётся заново на каждом Submit. Генерировать один key на booking intent, сохранять его для повторов того же запроса после timeout, а при изменении параметров генерировать другой. Не создавать дубль при потере ответа.
5. **Смена филиала.** При изменении branch frontend не перезагружает услуги и мастеров и не сбрасывает старые выбранные сущности. Исправить всю зависимую state-модель.
6. **Три входа в booking.** `time-first` объявлен в TS, но нет активного UI-пути, вызывающего `setFlow('time-first')`. Реализовать time-first как предварительный выбор даты/времени с последующим подбором услуг и мастеров. Master-first должен подгружать услуги конкретного мастера, а не общий каталог; проверить переходы и Back.
7. **Динамическая политика.** В ConfirmationScreen написано «за 2 часа», API policy может быть 180 минут. Использовать реальное `cancellation_cutoff_minutes`, включая экран управления.
8. **Таймзоны.** Calendar UI и Booking UI жёстко используют `Asia/Almaty` или `getUTCHours()+5`; использовать `branch.timezone_iana` и корректные локальные календарные дни. Убрать UTC `toISOString()` при выборе локальной даты. Протестировать рядом с полуночью.
9. **Стабильный календарь.** CRM рисует записи в фиксированные часовые клетки, теряет точное положение минут и длительность; использовать временную геометрию по start/end и динамические часы филиала; дополнить empty/error/loading states.
10. **Quote growth / public protection.** Поиск доступности создаёт и сохраняет отдельную BookingQuote **для каждого найденного слота**. Ограничить диапазон запросов, rate-limit, план очистки истекших quote; предпочтительно создавать quote лишь по выбору слота / защищать от роста таблицы при анонимных запросах.
11. **Ошибки API.** Использовать единый envelope, формы ошибок 409 `QUOTE_CHANGED`, `SLOT_CONFLICT`, `QUOTE_EXPIRED`, 403 `TENANT_SUSPENDED`. После изменения цены показывать новые условия и требовать повторного согласия.
12. **Несоответствия отчёту.** `React 19` не соответствует зависимостям `^18.3.1`. Утверждение «все таблицы в отдельной схеме crm_app» не подтверждено миграциями, использующими `public`; уточнить фактическую DB topology. Не объявлять unsupported функции полностью реализованными.

## 4. Acceptance tests — блокируют приёмку

1. **Clean checkout Linux/CI:** `pip install -r requirements.txt`, Alembic upgrade, runtime app user without superuser privileges, 24+ pytest PASS.
2. **Frontend:** `npm ci`, TypeScript build для booking-web/business-crm/api-client; Playwright 3+ workflows в CI с реальным API и базой, никакие `page.route` mocks вместо ключевого сценария.
3. **Cross-app vertical slice:** UI на `barberhouse.localhost`, выбрать две услуги с master price override, получить quote, заполнить телефон, создать бронь 201; CRM заходит **через настоящую авторизацию** и отображает тот же `booking_id`, имя, мастер, длительность и сумму.
4. **Isolation:** в Modern Cut авторизованный владелец не видит бронь Barber House и получает 404/403 при прямом запросе к её ID.
5. **CRM status:** клик «Клиент пришёл» даёт PATCH 200 и статус меняется после reload.
6. **Public self-service:** скопировать реальный `management_url`, открыть в новом контексте/после refresh, перенести бронь, проверить старый слот свободен и новый занят, отменить и проверить CRM.
7. **Security invite:** токен приглашения на email зарегистрированного пользователя не меняет его пароль; недействительные/повторные токены отвергаются; separate test accounts.
8. **Tenant/quote:** запрос другого tenant или quote от другого времени/мастера/набора услуг отклонён; истёкший quote 409, время уже занято 409.
9. **Three entry flows:** service-first, master-first, time-first проходят полный сценарий и корректный Back; на `320`, `360`, `390`, `1280` пикселях без overflow.
10. **Visual regression:** сравнение с `design/reference/готовый фронт.html`, отдельные скриншоты с теми же состояниями/viewport. Никаких необъяснённых крупных отклонений от утверждённой верстки.
11. **No credentials in bundle / seed in prod:** исходники frontend не содержат демонстрационных паролей; seed доступен только по явной DEV-команде. Для prod требуется безопасная конфигурация.
12. **Deliverable:** ссылка на новый коммит/ветку, точные версии, CI URL green, логи pytest/npm build/Playwright, screenshots+diff, known limitations; без merge main и деплоя.

## 5. Порядок реализации

**Stage A / no new scope:** починить P0-A/B/C/D, прогнать CI; обновить API клиент строго по OpenAPI (лучше генерируемый клиент или contract tests).  
**Stage B / booking lifecycle:** management link/reschedule, quote binding, idempotency, филиалы/time-first, dynamic policy/time zones.  
**Stage C / one real cross-app path:** функциональные E2E с проверкой фактической DB/API записей, CRM status, tenant isolation, screenshots visual regression.  
**Stage D / after acceptance:** полная CRM из дизайн-холста (клиенты, графики, услуги/цены, команда, настройки), затем Platform Console отдельно. Не начинать Platform Console до закрытия A-C.

## 6. Сообщение агенту

> **Репозиторий:** https://github.com/TryHanger/crm, ветка `feat/booking-frontend-integration`, ревью commit `f20e364c34c1641175a987baf1bb5d39dc77c6e9`.  
> Независимый аудит обнаружил P0/P1-проблемы. Исправляй существующий код, не переписывай архитектуру и дизайн. Самая важная проблема — account takeover через accept-invite; за ней — красный CI из-за email-validator, некорректный tenant_id после `/auth/me`, и POST вместо PATCH смены статуса. После этого доведи public management/reschedule, quote binding, idempotency, branch reload, все три entry flows и timezone. Не путай демонстрационный переключатель логинов с реальным tenant switching. 
> Сначала добейся зелёного GitHub Actions для backend, npm builds и Playwright. Обязательный E2E: настоящая бронь из Booking Web появляется с тем же ID в CRM Barber House и не доступна Modern Cut. Проверять данные, а не только тексты заголовков. Выполнять UI visual comparison с `готовый фронт.html`.  
> Commit и push разрешены только в отдельную feature/fix ветку репозитория без `--force`; **не merge в main и не публичный deploy**. Предоставь SHA, green CI URL, логи, скриншоты и точную матрицу DONE/PARTIAL/BLOCKED.

**Результат аудита:** GO только для DEV-доработки, HOLD для merge и публичного пилота.
