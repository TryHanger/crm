"""Воркер уведомлений (M15): outbox -> email, напоминания за сутки.

  python scripts/outbox_worker.py            # цикл, пауза --interval секунд
  python scripts/outbox_worker.py --once     # один проход (cron, отладка)

Транспорт: SMTP_HOST/SMTP_PORT/SMTP_SECURITY (starttls|ssl|none), SMTP_USER/SMTP_PASSWORD, SMTP_FROM.
Выключатель: EMAIL_NOTIFICATIONS_ENABLED=false — события копятся, ничего не отправляется.
Можно запускать несколько воркеров: события разбираются через SKIP LOCKED.
"""
import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from apps.api.app.modules.notifications import worker  # noqa: E402


MAX_BACKOFF = 60.0


async def loop(interval: float, once: bool, batch: int) -> int:
    """Работает, пока его не остановят. Временная недоступность БД (сон машины, рестарт Postgres,
    сеть) не роняет процесс: пишем тип ошибки в лог и повторяем с растущей паузой до минуты."""
    reminders_every, tick, delay = max(1, int(60 / max(interval, 1))), 0, max(interval, 1.0)
    while True:
        if tick % reminders_every == 0:
            try:
                n = await worker.enqueue_reminders()
                if n:
                    logging.info("reminders queued: %s", n)
            except Exception as e:  # the queue must keep moving even if reminder scan fails
                logging.error("reminder scan failed: %s", type(e).__name__)
        try:
            stats = await worker.run_once(limit=batch)
        except Exception as e:  # noqa: BLE001 — сообщение может содержать адрес БД: в лог только тип
            logging.error("outbox pass failed (%s), retry in %.0fs", type(e).__name__, delay)
            if once:
                return 1
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_BACKOFF)
            continue
        delay = max(interval, 1.0)
        if stats.claimed:
            logging.info("outbox: claimed %s, sent %s, skipped %s, retried %s, failed %s, deferred %s",
                         stats.claimed, stats.sent, stats.skipped, stats.retried, stats.failed, stats.deferred)
        if once:
            return 0
        tick += 1
        await asyncio.sleep(0 if stats.claimed == batch else interval)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=float, default=5.0)
    ap.add_argument("--batch", type=int, default=20)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    try:
        return asyncio.run(loop(a.interval, a.once, a.batch))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
