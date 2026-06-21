"""Group endpoints — CRUD for groups and group membership management."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from studio_api.api.v1.deps import CurrentUserDep, DbSession, require_permission
from studio_api.orm.models import Group, Provider, User

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class GroupCreate(BaseModel):
    name: str
    description: str = ""
    external_id: str = ""


class GroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    external_id: str | None = None


class AddMemberRequest(BaseModel):
    user_id: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _group_response(g: Group, member_count: int | None = None) -> dict:
    r: dict = {
        "id": g.id,
        "name": g.name,
        "description": g.description,
        "external_id": g.external_id,
        "created_at": g.created_at.isoformat(),
        "updated_at": g.updated_at.isoformat(),
    }
    if member_count is not None:
        r["member_count"] = member_count
    return r


def _user_response(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "first_name": u.first_name,
        "last_name": u.last_name,
        "is_active": u.is_active,
        "group_id": u.group_id,
    }


def _get_group_or_404(db: DbSession, group_id: str) -> Group:
    g = db.scalar(select(Group).where(Group.id == group_id))
    if g is None:
        raise HTTPException(status_code=404, detail=f"Group {group_id!r} not found")
    return g


# ── Group CRUD ────────────────────────────────────────────────────────────────

@router.get("", dependencies=[require_permission("groups:read")])
def list_groups(db: DbSession) -> list[dict]:
    groups = db.scalars(select(Group).order_by(Group.name)).all()
    # Count members per group in a single query
    counts = dict(
        db.execute(
            select(User.group_id, func.count(User.id))
            .where(User.group_id.is_not(None))
            .group_by(User.group_id)
        ).all()
    )
    return [_group_response(g, counts.get(g.id, 0)) for g in groups]


@router.post("", status_code=201, dependencies=[require_permission("groups:write")])
def create_group(body: GroupCreate, db: DbSession) -> dict:
    existing = db.scalar(select(Group).where(Group.name == body.name))
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Group {body.name!r} already exists")
    g = Group(name=body.name, description=body.description, external_id=body.external_id)
    db.add(g)
    db.flush()
    db.refresh(g)
    db.commit()
    return _group_response(g, 0)


@router.get("/{group_id}", dependencies=[require_permission("groups:read")])
def get_group(group_id: str, db: DbSession) -> dict:
    g = _get_group_or_404(db, group_id)
    count = db.scalar(
        select(func.count(User.id)).where(User.group_id == group_id)
    ) or 0
    return _group_response(g, count)


@router.patch("/{group_id}", dependencies=[require_permission("groups:write")])
def update_group(group_id: str, body: GroupUpdate, db: DbSession) -> dict:
    g = _get_group_or_404(db, group_id)
    if body.name is not None:
        g.name = body.name
    if body.description is not None:
        g.description = body.description
    if body.external_id is not None:
        g.external_id = body.external_id
    db.commit()
    db.refresh(g)
    return _group_response(g)


@router.delete("/{group_id}", status_code=204, dependencies=[require_permission("groups:write")])
def delete_group(group_id: str, db: DbSession) -> None:
    g = _get_group_or_404(db, group_id)
    # ondelete="SET NULL" on User.group_id means the DB clears members' FK.
    # cascade="all, delete-orphan" on Group.providers deletes group-owned providers.
    db.delete(g)
    db.commit()


# ── Membership ────────────────────────────────────────────────────────────────

@router.get("/{group_id}/members", dependencies=[require_permission("groups:read")])
def list_members(group_id: str, db: DbSession) -> list[dict]:
    _get_group_or_404(db, group_id)
    members = db.scalars(select(User).where(User.group_id == group_id)).all()
    return [_user_response(u) for u in members]


@router.post("/{group_id}/members", status_code=201, dependencies=[require_permission("groups:write")])
def add_member(group_id: str, body: AddMemberRequest, db: DbSession) -> dict:
    _get_group_or_404(db, group_id)
    user = db.scalar(select(User).where(User.id == body.user_id))
    if user is None:
        raise HTTPException(status_code=404, detail=f"User {body.user_id!r} not found")
    # Structural constraint: single nullable FK means at most one group per user.
    user.group_id = group_id
    db.commit()
    db.refresh(user)
    return _user_response(user)


@router.delete("/{group_id}/members/{user_id}", status_code=204, dependencies=[require_permission("groups:write")])
def remove_member(group_id: str, user_id: str, db: DbSession) -> None:
    user = db.scalar(
        select(User).where(User.id == user_id, User.group_id == group_id)
    )
    if user is None:
        raise HTTPException(status_code=404, detail=f"User {user_id!r} is not a member of group {group_id!r}")
    user.group_id = None
    db.commit()


# ── Group providers ───────────────────────────────────────────────────────────

@router.get("/{group_id}/providers", dependencies=[require_permission("providers:read")])
def list_group_providers(group_id: str, db: DbSession, current_user: CurrentUserDep) -> list[dict]:
    _get_group_or_404(db, group_id)
    providers = db.scalars(
        select(Provider)
        .where(Provider.group_id == group_id)
        .options(selectinload(Provider.tokens))
        .order_by(Provider.created_at)
    ).all()
    return [
        {
            "id": p.id,
            "group_id": p.group_id,
            "scope": "group",
            "name": p.name,
            "type": p.type,
            "is_active": p.is_active,
            "token_count": len(p.tokens),
            "created_at": p.created_at.isoformat(),
            "updated_at": p.updated_at.isoformat(),
        }
        for p in providers
    ]
