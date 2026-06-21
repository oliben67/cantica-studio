"""User and role management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from studio_api.api.v1.deps import DbSession, require_permission
from studio_api.auth.password import hash_password
from studio_api.orm.models import Role, User

users_router = APIRouter()
roles_router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────


class CreateUserRequest(BaseModel):
    email: str
    password: str
    first_name: str = ""
    last_name: str = ""


class UpdateUserRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    password: str | None = None
    is_active: bool | None = None


def _user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "is_active": user.is_active,
        "roles": [r.name for r in user.roles],
        "created_at": user.created_at.isoformat(),
        "updated_at": user.updated_at.isoformat(),
    }


def _role_dict(role: Role) -> dict:
    return {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "permissions": [p.name for p in role.permissions],
        "created_at": role.created_at.isoformat(),
    }


# ── User CRUD ─────────────────────────────────────────────────────────────────


@users_router.get("", dependencies=[require_permission("users:read")])
def list_users(db: DbSession) -> list[dict]:
    users = db.scalars(select(User).options(selectinload(User.roles))).all()
    return [_user_dict(u) for u in users]


@users_router.post("", status_code=201, dependencies=[require_permission("users:write")])
def create_user(body: CreateUserRequest, db: DbSession) -> dict:
    if db.scalar(select(User).where(User.email == body.email)) is not None:
        raise HTTPException(status_code=409, detail=f"User {body.email!r} already exists")
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        first_name=body.first_name,
        last_name=body.last_name,
    )
    db.add(user)
    db.commit()
    return _user_dict(user)


@users_router.get("/{user_id}", dependencies=[require_permission("users:read")])
def get_user(user_id: str, db: DbSession) -> dict:
    user = db.scalar(select(User).options(selectinload(User.roles)).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_dict(user)


@users_router.put("/{user_id}", dependencies=[require_permission("users:write")])
def update_user(user_id: str, body: UpdateUserRequest, db: DbSession) -> dict:
    user = db.scalar(select(User).options(selectinload(User.roles)).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if body.first_name is not None:
        user.first_name = body.first_name
    if body.last_name is not None:
        user.last_name = body.last_name
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    if body.is_active is not None:
        user.is_active = body.is_active
    db.commit()
    return _user_dict(user)


@users_router.delete("/{user_id}", status_code=204, dependencies=[require_permission("users:write")])
def delete_user(user_id: str, db: DbSession) -> None:
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()


@users_router.post("/{user_id}/roles/{role_name}", dependencies=[require_permission("users:write")])
def assign_role(user_id: str, role_name: str, db: DbSession) -> dict:
    user = db.scalar(select(User).options(selectinload(User.roles)).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    role = db.scalar(select(Role).where(Role.name == role_name))
    if role is None:
        raise HTTPException(status_code=404, detail=f"Role {role_name!r} not found")
    if role not in user.roles:
        user.roles.append(role)
        db.commit()
    return _user_dict(user)


@users_router.delete("/{user_id}/roles/{role_name}", dependencies=[require_permission("users:write")])
def remove_role(user_id: str, role_name: str, db: DbSession) -> dict:
    user = db.scalar(select(User).options(selectinload(User.roles)).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.roles = [r for r in user.roles if r.name != role_name]
    db.commit()
    return _user_dict(user)


# ── Role listing ──────────────────────────────────────────────────────────────


@roles_router.get("", dependencies=[require_permission("roles:read")])
def list_roles(db: DbSession) -> list[dict]:
    roles = db.scalars(select(Role).options(selectinload(Role.permissions))).all()
    return [_role_dict(r) for r in roles]
