"""Шаблоны писем клиенту (M15).

Шаблон — обычный текст с подстановками {name}. Разрешены только переменные из PLACEHOLDERS:
неизвестная подстановка — ошибка при сохранении, а не пустое место в письме. HTML владелец не пишет:
текст экранируется, ссылки управления и отписки превращаются в кнопки при сборке письма.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Dict, Optional

PLACEHOLDERS = {
    "business_name": "Название салона",
    "customer_name": "Имя клиента",
    "services": "Услуги через запятую",
    "staff_name": "Мастер",
    "date": "Дата визита (местное время филиала)",
    "time": "Время визита (местное время филиала)",
    "branch_name": "Филиал",
    "branch_address": "Адрес филиала",
    "total": "Стоимость, ₸",
    "public_ref": "Номер записи",
    "manage_url": "Ссылка «перенести или отменить»",
}

DEFAULTS: Dict[str, tuple] = {
    "booking_confirmation": (
        "Вы записаны: {date} в {time}, {business_name}",
        "Здравствуйте, {customer_name}!\n\n"
        "Вы записаны в {business_name}: {services}.\n"
        "Когда: {date} в {time}. Мастер: {staff_name}.\n"
        "Где: {branch_name}, {branch_address}.\n"
        "Стоимость: {total}. Номер записи: {public_ref}.\n\n"
        "Перенести или отменить запись: {manage_url}",
    ),
    "booking_rescheduled": (
        "Запись перенесена: {date} в {time}",
        "Здравствуйте, {customer_name}!\n\n"
        "Ваша запись в {business_name} перенесена на {date} в {time}.\n"
        "Мастер: {staff_name}. Где: {branch_name}, {branch_address}.\n\n"
        "Управление записью: {manage_url}",
    ),
    "booking_cancelled": (
        "Запись отменена: {date} в {time}",
        "Здравствуйте, {customer_name}!\n\n"
        "Запись {public_ref} в {business_name} на {date} в {time} отменена.\n"
        "Будем рады видеть вас снова.",
    ),
    "booking_reminder": (
        "Напоминание: завтра в {time}, {business_name}",
        "Здравствуйте, {customer_name}!\n\n"
        "Напоминаем о записи в {business_name}: {date} в {time}, {services}.\n"
        "Где: {branch_name}, {branch_address}.\n\n"
        "Если планы изменились: {manage_url}",
    ),
}
LABELS = {"booking_confirmation": "Подтверждение записи", "booking_rescheduled": "Перенос записи",
          "booking_cancelled": "Отмена записи", "booking_reminder": "Напоминание за сутки"}

_VAR = re.compile(r"\{([a-zA-Z_]+)\}")
SUBJECT_MAX, BODY_MAX = 200, 4000


class TemplateError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def validate(code: str, subject: str, body: str) -> None:
    if code not in DEFAULTS:
        raise TemplateError("TEMPLATE_NOT_FOUND", "Нет такого шаблона")
    subject, body = (subject or "").strip(), (body or "").strip()
    if not subject or len(subject) > SUBJECT_MAX or "\n" in subject or "\r" in subject:
        raise TemplateError("TEMPLATE_SUBJECT_INVALID", f"Тема: одна строка, 1–{SUBJECT_MAX} символов")
    if not body or len(body) > BODY_MAX:
        raise TemplateError("TEMPLATE_BODY_INVALID", f"Текст: 1–{BODY_MAX} символов")
    unknown = sorted({v for v in _VAR.findall(subject + body) if v not in PLACEHOLDERS})
    if unknown:
        raise TemplateError("TEMPLATE_PLACEHOLDER_UNKNOWN", "Неизвестные подстановки: " + ", ".join("{" + u + "}" for u in unknown))
    if code != "booking_cancelled" and "{manage_url}" not in body:
        raise TemplateError("TEMPLATE_MANAGE_LINK_REQUIRED", "В тексте должна остаться ссылка {manage_url}: клиент переносит и отменяет запись по ней")


def _fill(text: str, ctx: Dict[str, str]) -> str:
    return _VAR.sub(lambda m: ctx.get(m.group(1), ""), text)


@dataclass
class Rendered:
    subject: str
    text: str
    html: str


def render(subject: str, body: str, ctx: Dict[str, str], unsubscribe_url: Optional[str] = None) -> Rendered:
    subj = " ".join(_fill(subject, ctx).split())[:SUBJECT_MAX]
    text = _fill(body, ctx)
    if unsubscribe_url:
        text += f"\n\n—\nНе получать письма о записях: {unsubscribe_url}"
    # HTML: escape everything, then turn our own links into anchors
    safe = html.escape(_fill(body, ctx)).replace("\n", "<br>")
    for url in filter(None, [ctx.get("manage_url")]):
        esc = html.escape(url)
        safe = safe.replace(esc, f'<a href="{html.escape(url, quote=True)}">{esc}</a>')
    footer = ""
    if unsubscribe_url:
        footer = (f'<p style="font-size:12px;color:#64748B">Не хотите получать письма о записях? '
                  f'<a href="{html.escape(unsubscribe_url, quote=True)}">Отписаться</a></p>')
    page = (f'<html><body style="font-family:sans-serif;color:#1E293B;line-height:1.5">'
            f'<p>{safe}</p>{footer}</body></html>')
    return Rendered(subj, text, page)
