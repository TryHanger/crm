"""Доступ сотрудника CRM к филиалам (M08-D2; R08 «tenant+branch scope с M02»).

    owner  -> все филиалы компании
    admin  -> филиалы из branch_role_grants его membership; нет грантов -> все (как было до M08)
    master -> только филиалы, где работает его профиль мастера, и только его собственный календарь

Проверка всегда двухступенчатая: филиал существует в этой компании (иначе 404, чужие id не
отличаются от несуществующих) и входит в доступ сотрудника (иначе 403).
"""
from __future__ import annotations

import uuid
from typing import Optional, Set

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.app.infrastructure.db.models import Branch, BranchRoleGrant, StaffBranch, StaffProfile
from apps.api.app.infrastructure.security.auth import AuthenticatedTenantUser


async def master_profile_id(db: AsyncSession, crm_user: AuthenticatedTenantUser) -> Optional[uuid.UUID]:
    if crm_user.role != "master":
        return None
    sp = (await db.execute(select(StaffProfile.id).where(
        StaffProfile.tenant_id == crm_user.tenant_id, StaffProfile.user_id == crm_user.user.id))).scalar_one_or_none()
    if sp is None:
        raise HTTPException(status_code=403, detail={"code": "MASTER_PROFILE_MISSING",
                                                     "message": "Профиль мастера не привязан к учётной записи"})
    return sp


async def allowed_branch_ids(db: AsyncSession, crm_user: AuthenticatedTenantUser) -> Optional[Set[uuid.UUID]]:
    """None = все филиалы компании."""
    if crm_user.role == "owner":
        return None
    if crm_user.role == "master":
        staff_id = await master_profile_id(db, crm_user)
        rows = (await db.execute(select(StaffBranch.branch_id).where(
            StaffBranch.tenant_id == crm_user.tenant_id, StaffBranch.staff_id == staff_id,
            StaffBranch.active.is_(True)))).scalars().all()
        return set(rows)
    grants = (await db.execute(select(BranchRoleGrant.branch_id).where(
        BranchRoleGrant.membership_id == crm_user.membership.id))).scalars().all()
    return set(grants) or None


async def require_branch(db: AsyncSession, crm_user: AuthenticatedTenantUser, branch_id: uuid.UUID) -> Branch:
    branch = (await db.execute(select(Branch).where(
        Branch.id == branch_id, Branch.tenant_id == crm_user.tenant_id))).scalar_one_or_none()
    if branch is None:
        raise HTTPException(status_code=404, detail={"code": "BRANCH_NOT_FOUND", "message": "Филиал не найден"})
    allowed = await allowed_branch_ids(db, crm_user)
    if allowed is not None and branch_id not in allowed:
        raise HTTPException(status_code=403, detail={"code": "BRANCH_FORBIDDEN",
                                                     "message": "Нет доступа к этому филиалу"})
    return branch


async def require_staff_in_branch(db: AsyncSession, crm_user: AuthenticatedTenantUser,
                                  staff_id: uuid.UUID, branch_id: uuid.UUID) -> None:
    """Мастер принадлежит компании и работает в филиале; мастер-пользователь действует только за себя."""
    own = await master_profile_id(db, crm_user)
    if own is not None and staff_id != own:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN",
                                                     "message": "Мастер может менять только свой календарь"})
    found = (await db.execute(select(StaffBranch.id).join(StaffProfile, StaffProfile.id == StaffBranch.staff_id).where(
        StaffBranch.tenant_id == crm_user.tenant_id, StaffBranch.staff_id == staff_id,
        StaffBranch.branch_id == branch_id, StaffBranch.active.is_(True),
        StaffProfile.tenant_id == crm_user.tenant_id))).first()
    if not found:
        raise HTTPException(status_code=422, detail={"code": "STAFF_NOT_IN_BRANCH",
                                                     "message": "Сотрудник не работает в этом филиале"})
