"""M15-D2: outbox -> email, права по ролям и филиалам, согласия, шаблоны и лимиты.

Приёмка: клиент получил письмо, открыл управление записью; мастер не видит кассу.
STOP: уведомление отправлено, а бронь в базе не создалась.
"""
import asyncio
import datetime as dt
import logging
import re
import uuid

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from apps.api.app.core.config import settings
from apps.api.app.modules.notifications import worker
from apps.api.app.modules.notifications.transport import MemoryTransport
from apps.api.tests.company_factory import client, invite_admin, new_company

DAY = dt.date.today() + dt.timedelta(days=15)
MANAGE = re.compile(r"/manage/([A-Za-z0-9_\-]+)")


def sql(q, **params):
    engine = create_engine(settings.ADMIN_SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            res = conn.execute(text(q), params)
            return res.fetchall() if res.returns_rows else None
    finally:
        engine.dispose()


def k():
    return str(uuid.uuid4())


async def drain(transport, rounds=10):
    total = worker.RunStats()
    for _ in range(rounds):
        s = await worker.run_once(transport, limit=200)
        for f in ("claimed", "sent", "skipped", "retried", "failed", "deferred"):
            setattr(total, f, getattr(total, f) + getattr(s, f))
        if s.claimed == 0:
            break
    return total


async def setup(c):
    co = await new_company(c, "Asia/Almaty")
    co.master = await co.staff("Мастер Письма", "09:00", "21:00")
    co.svc = await co.service(8000_00, minutes=60)
    return co


async def book(co, hour, email=None, phone=None, day=DAY):
    start = dt.datetime.combine(day, dt.time(hour), tzinfo=co.tz).astimezone(dt.timezone.utc)
    body = {"branch_id": co.branch_id, "staff_id": co.master, "service_ids": [co.svc], "starts_at_utc": start.isoformat(),
            "expected_price_minor": 8000_00, "customer_name": "Анна <b>Тест</b>",
            "customer_phone": phone or f"+7701{uuid.uuid4().int % 10**7:07d}"}
    if email:
        body["customer_email"] = email
    return await co.c.post("/api/v1/public/bookings", headers={**co.host, "Idempotency-Key": k()}, json=body)


def mails_to(t, email):
    return [m for m in t.sent if m.to == email]


def delivery(booking_id):
    return sql("SELECT d.status, d.reason, d.template_code, d.message_id, e.id FROM notification_deliveries d "
               "JOIN outbox_events e ON e.id = d.outbox_event_id WHERE e.aggregate_id LIKE :b ORDER BY d.created_at",
               b=f"{booking_id}%")


# ---------------------------------------------------------------- acceptance

async def test_client_gets_email_and_opens_manage_link_once():
    async with client() as c:
        co = await setup(c)
        email = f"anna-{uuid.uuid4().hex[:6]}@example.kz"
        r = await book(co, 10, email)
        assert r.status_code == 201, r.text
        bid = r.json()["booking_id"]
        t = MemoryTransport()
        await drain(t)
        [m] = mails_to(t, email)
        assert "Вы записаны" in m.subject and DAY.strftime("%d.%m.%Y") in m.subject
        assert "10:00" in m.text and "8 000 ₸" in m.text
        assert "<b>Тест</b>" not in m.html and "&lt;b&gt;" in m.html               # client name never becomes markup
        token = MANAGE.search(m.text).group(1)
        assert token != r.json().get("management_token")                          # a fresh link for the letter
        page = await c.get(f"/api/v1/public/manage/{token}")
        assert page.status_code == 200 and page.json()["booking_id"] == bid and page.json()["can_cancel"] is True
        [(status, reason, tpl, msg_id, ev_id)] = delivery(bid)
        assert (status, tpl) == ("sent", "booking_confirmation") and msg_id == f"<outbox-{ev_id}@" + settings.SMTP_FROM.split("@")[-1] + ">"
        assert m.headers["List-Unsubscribe"].startswith("<") and "unsubscribe" in m.headers["List-Unsubscribe"]

        # repeated runs and a second worker never send it again
        await drain(t)
        await asyncio.gather(worker.run_once(t), worker.run_once(t))
        assert len(mails_to(t, email)) == 1

        # client cancels from the letter -> cancellation email, without a manage link
        r = await c.post(f"/api/v1/public/manage/{token}/cancel", json={})
        assert r.status_code == 200, r.text
        await drain(t)
        cancel = mails_to(t, email)[1]
        assert "отменена" in cancel.subject and not MANAGE.search(cancel.text)


async def test_no_booking_no_event_no_email():
    async with client() as c:
        co = await setup(c)
        email = f"race-{uuid.uuid4().hex[:6]}@example.kz"
        assert (await book(co, 12, email)).status_code == 201
        lost = await book(co, 12, f"lost-{uuid.uuid4().hex[:6]}@example.kz")     # the same slot: no booking
        assert lost.status_code == 409, lost.text
        events = sql("SELECT count(*) FROM outbox_events WHERE tenant_id = :t AND event_type = 'booking.created'", t=co.tenant_id)
        assert events[0][0] == 1
        t = MemoryTransport()
        await drain(t)
        assert [m.to for m in t.sent if m.to.endswith("@example.kz") and ("race-" in m.to or "lost-" in m.to)] == [email]

        # an event whose booking disappeared is skipped, never "sent"
        sql("INSERT INTO outbox_events (id, tenant_id, event_type, aggregate_id, payload_sanitized, created_at, retry_count) "
            "VALUES (gen_random_uuid(), :t, 'booking.created', :b, '{}', now(), 0)", t=co.tenant_id, b=str(uuid.uuid4()))
        stats = await drain(t)
        assert stats.sent == 0 and stats.skipped >= 1
        assert sql("SELECT status, last_error FROM outbox_events WHERE tenant_id = :t ORDER BY created_at DESC LIMIT 1",
                   t=co.tenant_id)[0] == ("skipped", "booking_missing")


async def test_retry_backoff_and_no_secrets_in_logs(caplog):
    async with client() as c:
        co = await setup(c)
        email = f"retry-{uuid.uuid4().hex[:6]}@example.kz"
        bid = (await book(co, 13, email)).json()["booking_id"]
        t = MemoryTransport(fail_times=2)
        caplog.set_level(logging.INFO, logger="crm.notifications")
        for _ in range(3):
            await drain(t)
            sql("UPDATE outbox_events SET next_attempt_at = now() WHERE aggregate_id = :b", b=bid)
        assert len(mails_to(t, email)) == 1
        row = sql("SELECT status, retry_count, last_error FROM outbox_events WHERE aggregate_id = :b", b=bid)[0]
        assert row[0] == "sent" and row[1] == 2 and email not in (row[2] or "")
        # nothing secret reached the logs: no full address, no manage link, no tokens
        token = MANAGE.search(mails_to(t, email)[0].text).group(1)
        assert email not in caplog.text and token not in caplog.text and "/manage/" not in caplog.text
        assert "retry 1" in caplog.text and email[:1] + "***@example.kz" in caplog.text

        # permanent error -> failed at once, with a failed delivery decision
        email2 = f"bounce-{uuid.uuid4().hex[:6]}@example.kz"
        bid2 = (await book(co, 15, email2)).json()["booking_id"]
        await drain(MemoryTransport(fail_times=1, permanent=True))
        assert sql("SELECT status FROM outbox_events WHERE aggregate_id = :b", b=bid2)[0][0] == "failed"
        assert delivery(bid2)[0][:2] == ("failed", "permanent_error")
        # a failed attempt leaves no dangling manage link
        assert sql("SELECT count(*) FROM public_management_tokens WHERE booking_id = :b", b=bid2)[0][0] == 1


async def test_consent_opt_out_and_skips():
    async with client() as c:
        co = await setup(c)
        r = await book(co, 9)                                                   # no email given
        await drain(MemoryTransport())
        assert delivery(r.json()["booking_id"])[0][:2] == ("skipped", "no_email")

        email = f"optout-{uuid.uuid4().hex[:6]}@example.kz"
        phone = "+77010008801"
        first = (await book(co, 10, email, phone)).json()["booking_id"]
        t = MemoryTransport()
        await drain(t)
        [m] = mails_to(t, email)
        tok = re.search(r"token=([^\s>]+)", m.headers["List-Unsubscribe"]).group(1)
        page = await c.get(f"/api/v1/public/notifications/unsubscribe?token={tok}")
        assert page.status_code == 200 and "<form" in page.text
        assert sql("SELECT notifications_opt_out_at FROM customers WHERE email = :e", e=email)[0][0] is None   # GET changes nothing
        assert "недействительна" in (await c.post("/api/v1/public/notifications/unsubscribe", data={"token": tok[:-2] + "xx"})).text
        assert (await c.post("/api/v1/public/notifications/unsubscribe", data={"token": tok})).status_code == 200
        second = (await book(co, 12, email, phone)).json()["booking_id"]
        await drain(t)
        assert len(mails_to(t, email)) == 1 and delivery(second)[0][:2] == ("skipped", "opted_out")
        assert first != second

        # owner switches email off for the company
        r = await c.put("/api/v1/business/notification-settings", headers=co.h, json={"email_notifications_enabled": False})
        assert r.status_code == 200 and r.json()["email_notifications_enabled"] is False
        other = f"off-{uuid.uuid4().hex[:6]}@example.kz"
        bid = (await book(co, 14, other)).json()["booking_id"]
        await drain(t)
        assert not mails_to(t, other) and delivery(bid)[0][:2] == ("skipped", "tenant_disabled")


async def test_reminder_once_and_stale_reminder_skipped():
    async with client() as c:
        co = await setup(c)
        email = f"remind-{uuid.uuid4().hex[:6]}@example.kz"
        bid = (await book(co, 11, email)).json()["booking_id"]
        starts = sql("SELECT starts_at_utc FROM bookings WHERE id = :b", b=bid)[0][0]
        now = starts - dt.timedelta(hours=24)
        assert await worker.enqueue_reminders(now) >= 1
        assert await worker.enqueue_reminders(now) == 0                           # dedupe_key: no second reminder
        t = MemoryTransport()
        await drain(t)
        subjects = [m.subject for m in mails_to(t, email)]
        assert len(subjects) == 2 and subjects[1].startswith("Напоминание")
        # a reminder for a booking that was cancelled meanwhile is not sent
        bid2 = (await book(co, 15, email)).json()["booking_id"]
        starts2 = sql("SELECT starts_at_utc FROM bookings WHERE id = :b", b=bid2)[0][0]
        await drain(t)
        await worker.enqueue_reminders(starts2 - dt.timedelta(hours=24))
        assert (await c.patch(f"/api/v1/business/bookings/{bid2}/status", headers=co.h, json={"status": "cancelled", "reason": "x"})).status_code == 200
        before = len(mails_to(t, email))
        await drain(t)
        reasons = [d[1] for d in delivery(bid2)]
        assert "reminder_stale" in reasons
        assert all(not m.subject.startswith("Напоминание") for m in mails_to(t, email)[before:])


# ---------------------------------------------------------------- templates and limits

async def test_templates_and_daily_limit():
    async with client() as c:
        co = await setup(c)
        s = (await c.get("/api/v1/business/notification-settings", headers=co.h)).json()
        assert {x["code"] for x in s["templates"]} == {"booking_confirmation", "booking_rescheduled", "booking_cancelled", "booking_reminder"}
        url = "/api/v1/business/notification-templates/booking_confirmation"
        r = await c.put(url, headers=co.h, json={"subject": "Привет {nickname}", "body": "Ссылка {manage_url}"})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "TEMPLATE_PLACEHOLDER_UNKNOWN"
        r = await c.put(url, headers=co.h, json={"subject": "Ждём вас", "body": "Без ссылки"})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "TEMPLATE_MANAGE_LINK_REQUIRED"
        r = await c.put(url, headers=co.h, json={"subject": "Ждём вас {time}, {customer_name}", "body": "До встречи! {manage_url}"})
        assert r.status_code == 200 and next(x for x in r.json()["templates"] if x["code"] == "booking_confirmation")["customized"]
        assert (await c.put("/api/v1/business/notification-templates/nope", headers=co.h, json={"subject": "a", "body": "b"})).status_code == 404

        r = await c.put("/api/v1/business/notification-settings", headers=co.h, json={"daily_email_limit": 100000})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "EMAIL_LIMIT_TOO_HIGH"
        assert (await c.put("/api/v1/business/notification-settings", headers=co.h, json={"daily_email_limit": 1})).status_code == 200

        a, b = f"lim-a-{uuid.uuid4().hex[:6]}@example.kz", f"lim-b-{uuid.uuid4().hex[:6]}@example.kz"
        await book(co, 10, a)
        await book(co, 12, b)
        t = MemoryTransport()
        stats = await drain(t)
        assert stats.deferred >= 1
        sent = [m for m in t.sent if m.to in (a, b)]
        assert len(sent) == 1 and sent[0].subject.startswith("Ждём вас 10:00")
        assert sql("SELECT last_error, next_attempt_at > now() FROM outbox_events WHERE tenant_id = :t AND status = 'pending'",
                   t=co.tenant_id) == [("DAILY_LIMIT", True)]
        s = (await c.get("/api/v1/business/notification-settings", headers=co.h)).json()
        assert s["sent_last_24h"] == 1
        log = (await c.get("/api/v1/business/notification-deliveries", headers=co.h)).json()
        assert log[0]["status"] == "sent" and "***@example.kz" in log[0]["recipient"] and a not in str(log)

        assert (await c.delete(url, headers=co.h)).status_code == 200
        s = (await c.get("/api/v1/business/notification-settings", headers=co.h)).json()
        assert not next(x for x in s["templates"] if x["code"] == "booking_confirmation")["customized"]

        admin_h, _ = await invite_admin(co)
        assert (await c.get("/api/v1/business/notification-settings", headers=admin_h)).status_code == 200
        assert (await c.put("/api/v1/business/notification-settings", headers=admin_h, json={"daily_email_limit": 5})).status_code == 403


# ---------------------------------------------------------------- roles and branches

async def test_invite_roles_master_profile_and_admin_branches():
    async with client() as c:
        co = await setup(c)
        r = await c.post("/api/v1/business/invites", headers=co.h, json={"email": "x@example.kz", "role": "owner"})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "INVITE_ROLE_INVALID"
        # legacy form without a profile still works, but the master sees nothing until linked
        legacy_email = f"legacy-{uuid.uuid4().hex[:6]}@example.kz"
        r = await c.post("/api/v1/business/invites", headers=co.h, json={"email": legacy_email, "role": "master"})
        assert r.status_code == 201 and r.json()["warning"]["code"] == "STAFF_PROFILE_NOT_LINKED"
        legacy = await c.post("/api/v1/auth/accept-invite", json={"token": r.json()["invite_token"], "password": "Legacy-Pass-1"})
        lh = {"Authorization": f"Bearer {legacy.json()['access_token']}"}
        assert (await c.get("/api/v1/business/calendar?date=" + DAY.isoformat() + f"&branch_id={co.branch_id}", headers=lh)).status_code == 403
        legacy_profile = await co.staff("Мастер Наследие", "09:00", "21:00")
        legacy_m = next(u for u in (await c.get("/api/v1/business/users", headers=co.h)).json() if u["email"] == legacy_email)
        r = await c.put(f"/api/v1/business/users/{legacy_m['id']}/staff-profile", headers=co.h, json={"staff_id": co.master})
        assert r.status_code == 200
        r = await c.put(f"/api/v1/business/users/{legacy_m['id']}/staff-profile", headers=co.h, json={"staff_id": legacy_profile})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "ACCOUNT_ALREADY_LINKED"
        sql("UPDATE staff_profiles SET user_id = NULL WHERE id = :s", s=co.master)          # free the profile for the main flow

        # master: invite linked to the profile; sees own calendar, never the till
        email = f"master-{uuid.uuid4().hex[:6]}@example.kz"
        r = await c.post("/api/v1/business/invites", headers=co.h, json={"email": email, "role": "master", "staff_id": co.master})
        assert r.status_code == 201, r.text
        r2 = await c.post("/api/v1/business/invites", headers=co.h, json={"email": "y@example.kz", "role": "master", "staff_id": co.master})
        assert r2.status_code == 201                                            # still unlinked until accepted
        acc = await c.post("/api/v1/auth/accept-invite", json={"token": r.json()["invite_token"], "password": "Master-Pass-1"})
        assert acc.status_code == 200, acc.text
        mh = {"Authorization": f"Bearer {acc.json()['access_token']}"}
        late = await c.post("/api/v1/auth/accept-invite", json={"token": r2.json()["invite_token"], "password": "Master-Pass-2"})
        assert late.status_code == 409                                          # one profile, one account
        bid = (await book(co, 16)).json()["booking_id"]
        card = await c.get(f"/api/v1/business/bookings/{bid}", headers=mh)
        assert card.status_code == 200 and card.json()["finance"] is None
        today, end = dt.date.today(), DAY
        for path in (f"/api/v1/business/cash-accounts?branch_id={co.branch_id}", f"/api/v1/business/bookings/{bid}/payments",
                     f"/api/v1/business/reports/finance?from_date={today}&to_date={end}", "/api/v1/business/expense-categories",
                     f"/api/v1/business/reports/overview?from_date={today}&to_date={end}", "/api/v1/business/notification-settings"):
            assert (await c.get(path, headers=mh)).status_code == 403, path
        r = await c.post(f"/api/v1/business/bookings/{bid}/payments", headers={**mh, "Idempotency-Key": k()},
                         json={"amount_minor": 100, "cash_account_id": str(uuid.uuid4())})
        assert r.status_code == 403

        # admin: invited for one branch only; owner can change the branches later
        second = str(sql("INSERT INTO branches (id, tenant_id, name, city, address, timezone_iana, status, created_at) "
                         "VALUES (gen_random_uuid(), :t, 'Второй', 'Астана', 'ул. 2', 'Asia/Almaty', 'active', now()) RETURNING id",
                         t=co.tenant_id)[0][0])
        aemail = f"adm-{uuid.uuid4().hex[:6]}@example.kz"
        r = await c.post("/api/v1/business/invites", headers=co.h, json={"email": aemail, "role": "admin", "branch_ids": [second]})
        assert r.status_code == 201, r.text
        acc = await c.post("/api/v1/auth/accept-invite", json={"token": r.json()["invite_token"], "password": "Admin-Pass-1"})
        ah = {"Authorization": f"Bearer {acc.json()['access_token']}"}
        assert (await c.get(f"/api/v1/business/cash-accounts?branch_id={co.branch_id}", headers=ah)).status_code == 403
        assert (await c.get(f"/api/v1/business/cash-accounts?branch_id={second}", headers=ah)).status_code == 200
        users = (await c.get("/api/v1/business/users", headers=co.h)).json()
        me = next(u for u in users if u["email"] == aemail)
        assert me["branch_ids"] == [second]
        r = await c.put(f"/api/v1/business/users/{me['id']}/branches", headers=co.h, json={"branch_ids": [co.branch_id]})
        assert r.status_code == 200
        assert (await c.get(f"/api/v1/business/cash-accounts?branch_id={co.branch_id}", headers=ah)).status_code == 200
        assert (await c.get(f"/api/v1/business/cash-accounts?branch_id={second}", headers=ah)).status_code == 403
        assert (await c.put(f"/api/v1/business/users/{me['id']}/branches", headers=ah, json={"branch_ids": []})).status_code == 403
        r = await c.put(f"/api/v1/business/users/{me['id']}/branches", headers=co.h, json={"branch_ids": [str(uuid.uuid4())]})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "BRANCH_NOT_FOUND"
        master_m = next(u for u in users if u["email"] == email)
        r = await c.put(f"/api/v1/business/users/{master_m['id']}/branches", headers=co.h, json={"branch_ids": [second]})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "BRANCHES_FOR_ADMIN_ONLY"


class SlowTransport(MemoryTransport):
    async def send(self, msg):
        await asyncio.sleep(0.3)
        await super().send(msg)


async def test_two_workers_racing_send_one_letter():
    async with client() as c:
        co = await setup(c)
        email = f"race2-{uuid.uuid4().hex[:6]}@example.kz"
        assert (await book(co, 17, email)).status_code == 201
        t = SlowTransport()
        await asyncio.gather(*[worker.run_once(t, limit=200) for _ in range(4)])
        await drain(t)
        assert len(mails_to(t, email)) == 1
