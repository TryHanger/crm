# Деньги и снимок заказа: контракт D1 ↔ D2

Статус: зафиксирован в M04 (D2). Таблицы заказа появляются в M05, начисление в M11, касса в M12–M13.
Решения, отмеченные **[PO]**, подтверждает владелец продукта. До подтверждения действует указанное значение по умолчанию.

## 1. Деньги

| Правило | Значение | Где в коде |
|---|---|---|
| Единица хранения | целое число в минимальных единицах валюты. KZT: 1 ₸ = 100 тиын, `8000 ₸ = 800000` | `money.to_minor`, все колонки `*_minor` |
| float | запрещён в API, БД и расчётах. Деление на 100 допускается только при показе | `money.format_minor` |
| Валюта | одна на компанию (`tenant_settings.currency`). Услуги, цены мастеров, позиции брони и заказа в ней же. Поддерживается `KZT` | `money.CURRENCY_EXPONENTS`, `ownership.tenant_currency` |
| Смешение валют | ошибка `CURRENCY_MISMATCH` (422), тихое сложение запрещено | `money.sum_same_currency`, `BookingEngine` |
| Цена позиции | `0 … 10 000 000 ₸` (`MAX_PRICE_MINOR`). Ноль допустим (бесплатная консультация). Колонки `integer`, запас от переполнения при сложении | `schemas.py`, `money.validate_price_minor` |
| Точность ввода | цены в UI вводятся в целых тенге **[PO]**; API принимает любые целые тиыны | CRM: `parseInt(price) * 100` |
| Округление вычислений | ROUND_HALF_UP до минимальной единицы, **один раз на позицию**: скидка, процент, доля | `money.round_half_up`, `money.percent_of` |
| Деление суммы | метод наибольшего остатка, сумма частей равна исходной | `money.allocate` |
| Формат показа | `8 000 ₸`, `8 000,50 ₸`, разделитель тысяч — пробел | `money.format_minor` |

## 2. Привязки tenant / branch

- Услуга принадлежит компании. Доступность и цена в филиале задаются предложением мастера `staff_service_offers (staff, branch, service)`.
- Цену мастеру можно задать только в филиале, где он работает (`STAFF_NOT_IN_BRANCH`).
- Все ссылки проверяются в API до записи (`modules/catalog/ownership.py`) и гарантируются в БД составными FK `(tenant_id, X_id) → (tenant_id, id)` (ревизия `002_catalog_tenant_fks`):
  - `staff_service_offers`: staff, branch, service;
  - `staff_branches`: staff, branch;
  - `services.category_id`;
  - `booking_items.service_id`.
- Публичный каталог с `branch_id` показывает только услуги, которые в этом филиале оказывает активный мастер с онлайн-записью. Чужой филиал даёт 404 `BRANCH_NOT_FOUND`.

## 3. Цена записи (как сейчас считает Booking, зона D1)

`цена позиции = staff_service_offers.price_override_minor ?? services.base_price_minor` для пары мастер+филиал.
Quote фиксирует цены. При изменении цены между quote и бронью возвращается `409 QUOTE_CHANGED`. Бронь хранит снимок:
`booking_items.price_minor_snapshot`, `currency_snapshot`, `service_name_snapshot`, `duration_minutes_snapshot`
и сумму `bookings.amount_minor_snapshot`.

## 4. Модель заказа (M05: таблицы, M11: начисление)

Заказ ≠ визит. Оказано ≠ оплачено. Модель не зависит от платёжного провайдера.

```
orders
  id, tenant_id, branch_id, customer_id
  booking_id            UNIQUE NULL          -- не больше одного заказа на визит
  currency              = валюта компании на момент создания
  status                open | completed | cancelled
  source                booking | walk_in | manual
  created_at, created_by, completed_at
  -- суммы не хранятся отдельно: считаются из позиций и движений (или кэш с проверкой в тестах)

order_items
  id, tenant_id, order_id, sequence
  kind                  service             -- позже: product, certificate, subscription
  service_id, staff_id  (составные FK в своей компании)
  name_snapshot, duration_minutes_snapshot
  unit_price_minor      -- снимок цены на момент создания, не меняется
  quantity              >= 1
  discount_minor        0..unit_price*quantity
  total_minor           = unit_price_minor * quantity - discount_minor  (CHECK)
  price_source          base | staff_override | manual
  quote_id              NULL
  created_at

ledger_entries          (M05 каркас, M11–M13 наполнение; только INSERT)
  id, tenant_id, branch_id, order_id NULL
  kind                  service_rendered | payment | refund | advance | advance_applied | adjustment
  amount_minor          знак по kind, валюта = валюта заказа
  idempotency_key       UNIQUE (tenant_id, idempotency_key)
  reverses_entry_id     NULL                -- сторно ссылается на исходную запись
  reason, created_by, created_at
```

Инварианты (проверяются тестами M05 и M11):
1. Позиция заказа неизменяема после создания. Новая цена — новая позиция или корректировка `adjustment` с автором и причиной.
2. Заказ создаётся из снимка брони (`booking_items`), а не из текущего прайса.
3. Повтор события (`VisitCompleted`, повтор запроса кассы) не удваивает запись: `idempotency_key`.
4. `оказано = Σ service_rendered`, `получено = Σ payment − Σ refund`, `долг = оказано − получено − применённый аванс`.
5. Удалений нет. Отмена — это сторно (`reverses_entry_id`).
6. Валюта всех позиций и движений заказа совпадает с валютой заказа.

## 5. Открытые вопросы к PO

1. Разрешать ли цены с тиынами в интерфейсе CRM (сейчас только целые тенге)?
2. Округление скидок: одна позиция — одно округление ROUND_HALF_UP. Подтвердить.
3. Мультивалютность (компании вне Казахстана) — вне MVP?
