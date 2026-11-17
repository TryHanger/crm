"""Проверки «объект принадлежит этой компании/филиалу» для записи каталога и цен (M04-D2).

RLS ограничивает чтение и запись строк своим tenant, но внешний ключ проверяется без RLS:
без явной проверки строка компании A может сослаться на услугу/филиал компании B.
Здесь эти ссылки проверяются до записи; в БД то же гарантируют составные FK (ревизия 002).
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import (
    Branch, Service, ServiceCategory, StaffBranch, StaffProfile, TenantSettings,
)
from apps.api.app.modules.finance import money


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


async def require_category(db: AsyncSession, tenant_id: uuid.UUID, category_id: Optional[uuid.UUID]) -> None:
    if category_id is None:
        return
    found = (await db.execute(select(ServiceCategory.id).where(
        ServiceCategory.id == category_id, ServiceCategory.tenant_id == tenant_id,
        ServiceCategory.archived_at.is_(None)))).first()
    if not found:
        raise _err(422, "CATEGORY_NOT_FOUND", "Категория не найдена в вашей компании")


async def require_branch(db: AsyncSession, tenant_id: uuid.UUID, branch_id: uuid.UUID) -> None:
    found = (await db.execute(select(Branch.id).where(Branch.id == branch_id, Branch.tenant_id == tenant_id))).first()
    if not found:
        raise _err(422, "BRANCH_NOT_FOUND", "Филиал не найден в вашей компании")


async def require_service(db: AsyncSession, tenant_id: uuid.UUID, service_id: uuid.UUID) -> Service:
    svc = (await db.execute(select(Service).where(
        Service.id == service_id, Service.tenant_id == tenant_id, Service.archived_at.is_(None)))).scalar_one_or_none()
    if not svc:
        raise _err(422, "SERVICE_NOT_FOUND", "Услуга не найдена в вашей компании")
    return svc


async def require_staff(db: AsyncSession, tenant_id: uuid.UUID, staff_id: uuid.UUID) -> None:
    found = (await db.execute(select(StaffProfile.id).where(
        StaffProfile.id == staff_id, StaffProfile.tenant_id == tenant_id))).first()
    if not found:
        raise _err(404, "STAFF_NOT_FOUND", "Сотрудник не найден")


async def require_staff_in_branch(db: AsyncSession, tenant_id: uuid.UUID, staff_id: uuid.UUID, branch_id: uuid.UUID) -> None:
    found = (await db.execute(select(StaffBranch.id).where(
        StaffBranch.tenant_id == tenant_id, StaffBranch.staff_id == staff_id,
        StaffBranch.branch_id == branch_id, StaffBranch.active.is_(True)))).first()
    if not found:
        raise _err(422, "STAFF_NOT_IN_BRANCH",
                   "Сотрудник не работает в этом филиале: сначала назначьте его в филиал, потом задавайте цены")


async def tenant_currency(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    cur = (await db.execute(select(TenantSettings.currency).where(TenantSettings.tenant_id == tenant_id))).scalar_one_or_none()
    return money.normalize_currency(cur or money.DEFAULT_CURRENCY)
