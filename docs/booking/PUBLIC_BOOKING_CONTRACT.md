# Публичная запись: контракт availability / quote / booking (M06)

Правило: **сервер решает, какое время доступно и сколько оно стоит.** Booking Web показывает то, что вернул сервер, и бронирует по `quote_id`. Своих правил (подстановка услуги, пересчёт цены, фильтрация мастеров) у UI нет.
Все запросы идут на домен записи салона (`{slug}.book.<root>/api/v1/public/...`), компания определяется по Host.

## Общие элементы

| Шаг | Запрос | Что возвращает |
|---|---|---|
| Каталог | `GET /services?branch_id=` | услуги, которые в этом филиале оказывает активный мастер; цена — базовая |
| Мастера | `GET /staff?branch_id=&service_ids=` | мастера филиала, которые делают **все** выбранные услуги |
| Цены мастера | `GET /staff/{id}/services?branch_id=` | услуги мастера с **его** ценой и длительностью |
| Слоты + quote | `POST /availability/search` | слоты с `price_minor`, `duration_minutes`, `currency`, `quote_id` (живёт 15 мин) |
| Время без услуги | `POST /availability/time-first` | время, когда свободен хотя бы один мастер: `starts_at_utc`, `available_staff_count`; quote не создаёт |
| Бронь | `POST /bookings` + заголовок `Idempotency-Key` | `public_ref`, `total_amount_minor`, `management_token` / `management_url` |

`POST /availability/search`:
```json
{
  "branch_id": "…", "service_ids": ["…", "…"],
  "from_date": "2026-11-24", "to_date": "2026-11-24",
  "staff_mode": "any" | "specific", "staff_id": "… (обязателен при specific)",
  "at_utc": "2026-11-24T09:00:00+00:00 (необязательно: точное время из time-first)"
}
```
- Порядок `service_ids` = порядок услуг в визите. Повторы запрещены (422).
- Цена слота = Σ (цена мастера ?? базовая) по услугам, длительность = Σ длительностей. Сетка — шаг политики филиала (15 мин по умолчанию).
- `staff_mode=any`: порядок — время, затем цена, затем мастер. Первый слот на время — самый выгодный мастер.
- С `at_utc`: `exact_match=true` и quote ровно на это время, либо `exact_match=false`, `slots=[]` и `alternatives` — до 6 ближайших подходящих стартов того же дня.
- Ошибки: `422` (нет услуг, повтор услуг, `specific` без мастера, `to_date < from_date`, `at_utc` без пояса), `404 BRANCH_NOT_FOUND`, `403 BOOKING_DISABLED`.

`POST /bookings` — повторите всё из выбранного слота: `staff_id`, `service_ids` (в том же порядке), `starts_at_utc`, `quote_id`, `expected_price_minor = price_minor`. Плюс контакты.
- `409 QUOTE_CHANGED`: цена или длительность изменились с момента поиска. Покажите новую цену и повторите поиск.
- `409 SLOT_CONFLICT`: время заняли. Повторите поиск.
- Тот же `Idempotency-Key` при повторной отправке возвращает ту же запись.

## Три сценария

**По услуге.** `GET /services` → клиент выбирает услуги → `POST /availability/search` (`staff_mode=any` или конкретный мастер) → `POST /bookings`.

**По мастеру.** `GET /staff?branch_id=` → `GET /staff/{id}/services` (цены этого мастера) → `POST /availability/search` (`staff_mode=specific`, `staff_id`) → `POST /bookings`. Цена в каталоге мастера совпадает с ценой слота (проверяется тестом).

**По времени (time-first).**
1. `POST /availability/time-first` → клиент выбирает время.
2. Клиент выбирает услуги → `POST /availability/search` с `at_utc` = выбранное время.
   - `exact_match=true`: показать мастеров/цены на это время → `POST /bookings`.
   - `exact_match=false`: «Эти услуги не помещаются в HH:MM» + кнопки из `alternatives`. Выбор альтернативы повторяет шаг 2.
3. Бронь по quote.

**Чего UI больше не делает:** не подставляет `services[0]`, когда услуга не выбрана. Раньше Booking Web искал время и создавал бронь по первой услуге каталога, если клиент начинал с времени. **Для D1:** перевести шаг «Сначала время» на `searchTimeFirst` + `searchAvailability({ at_utc })` (методы уже есть в `@crm/api-client`).

## Проверки

- `apps/api/tests/test_booking_contract.py`: несколько услуг одного мастера с индивидуальной ценой и снимком цен в брони, `QUOTE_CHANGED`, цены мастера = цены слота, порядок «любого мастера», time-first до настоящей брони, валидация.
- `scripts/smoke_booking_flows.py`: три сценария на живом стеке, каждый заканчивается записью.
