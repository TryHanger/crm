"""Найдено на живом стенде 21.11.2026:
- воркер писем завершался при таймауте подключения к БД (сон машины) и ронял весь dev_stack;
- PUT расписания мастера без weekday_iso или с временем «25:00» отвечал 500 вместо 422.
"""
import importlib.util
import pathlib

import pytest

from apps.api.app.modules.notifications import worker
from apps.api.tests.company_factory import client, new_company

ROOT = pathlib.Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("outbox_worker_script", ROOT / "scripts" / "outbox_worker.py")
script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)


class Stop(BaseException):
    """Выход из бесконечного цикла воркера в тесте."""


async def test_worker_survives_database_outage(monkeypatch):
    calls, sleeps = [], []

    async def flaky(limit=20, transport=None):
        calls.append(1)
        if len(calls) <= 3:
            raise TimeoutError("connection to 127.0.0.1:5433 timed out")
        raise Stop()

    async def no_sleep(s):
        sleeps.append(s)

    async def no_reminders(now=None):
        return 0

    monkeypatch.setattr(worker, "run_once", flaky)
    monkeypatch.setattr(worker, "enqueue_reminders", no_reminders)
    monkeypatch.setattr(script.asyncio, "sleep", no_sleep)
    with pytest.raises(Stop):
        await script.loop(interval=1, once=False, batch=20)
    assert len(calls) == 4                      # три сбоя пережиты, четвёртый проход состоялся
    assert sleeps == [1.0, 2.0, 4.0]            # пауза растёт, а не долбим базу


async def test_worker_once_mode_reports_failure(monkeypatch):
    async def down(limit=20, transport=None):
        raise OSError("db down")

    async def no_reminders(now=None):
        return 0

    monkeypatch.setattr(worker, "run_once", down)
    monkeypatch.setattr(worker, "enqueue_reminders", no_reminders)
    assert await script.loop(interval=1, once=True, batch=20) == 1   # cron увидит ненулевой код


async def test_staff_schedule_rejects_bad_input_with_422():
    async with client() as c:
        co = await new_company(c, "Asia/Almaty")
        staff = await co.staff("Мастер", "09:00", "18:00")
        url = f"/api/v1/business/staff/{staff}/schedule?branch_id={co.branch_id}"

        r = await c.put(url, headers=co.h, json={"shifts": [{"local_start": "10:00", "local_end": "18:00"}]})
        assert r.status_code == 422, r.text                               # нет weekday_iso
        r = await c.put(url, headers=co.h, json={"shifts": [{"weekday_iso": 3, "local_start": "25:00", "local_end": "18:00"}]})
        assert r.status_code == 422, r.text
        r = await c.put(url, headers=co.h, json={"shifts": [{"weekday_iso": 3, "local_start": "abc", "local_end": "18:00"}]})
        assert r.status_code == 422, r.text
        r = await c.put(url, headers=co.h, json={"shifts": [{"weekday_iso": 3, "local_start": "10:00", "local_end": "18:00",
                                                             "breaks": [{"local_start": "13:00", "local_end": "1300"}]}]})
        assert r.status_code == 422, r.text
        r = await c.put(url, headers=co.h, json={"shifts": [{"weekday_iso": 3, "local_start": "10:00", "local_end": "18:00",
                                                             "breaks": [{"local_start": "13:00", "local_end": "14:00"}]}]})
        assert r.status_code == 200, r.text
