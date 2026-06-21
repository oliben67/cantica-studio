"""Auth endpoints — login and API token management."""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from studio_api.api.v1.deps import CurrentUserDep, DbSession, require_permission
from studio_api.auth.jwt import create_access_token
from studio_api.auth.password import verify_password
from studio_api.config import get_settings
from studio_api.orm.models import ApiToken, Role, User

router = APIRouter()


# ── Request / response schemas ────────────────────────────────────────────────


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class CreateTokenRequest(BaseModel):
    name: str
    scopes: list[str] = []
    expires_days: int | None = None


def _token_dict(t: ApiToken) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "scopes": t.scopes,
        "expires_at": t.expires_at.isoformat() if t.expires_at else None,
        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
        "created_at": t.created_at.isoformat(),
    }


# ── Public endpoint (no auth required) ───────────────────────────────────────


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: DbSession) -> LoginResponse:
    settings = get_settings()
    if settings.local_mode:
        raise HTTPException(status_code=400, detail="Login not available in local mode")

    user = db.scalar(
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.email == body.email, User.is_active.is_(True))
    )
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    permissions = list({p.name for role in user.roles for p in role.permissions})
    token = create_access_token(
        user_id=user.id,
        roles=[r.name for r in user.roles],
        permissions=permissions,
        secret=settings.jwt_secret,
        expire_minutes=settings.jwt_expire_minutes,
    )
    return LoginResponse(access_token=token, expires_in=settings.jwt_expire_minutes * 60)


# ── Protected token-management endpoints ──────────────────────────────────────


@router.get("/tokens", dependencies=[require_permission("tokens:read")])
def list_tokens(current_user: CurrentUserDep, db: DbSession) -> list[dict]:
    tokens = db.scalars(
        select(ApiToken).where(ApiToken.user_id == current_user.user_id)
    ).all()
    return [_token_dict(t) for t in tokens]


@router.post("/tokens", status_code=201, dependencies=[require_permission("tokens:write")])
def create_token(body: CreateTokenRequest, current_user: CurrentUserDep, db: DbSession) -> dict:
    raw = os.urandom(32).hex()
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires_at: datetime | None = None
    if body.expires_days is not None:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_days)

    api_token = ApiToken(
        user_id=current_user.user_id,
        token_hash=token_hash,
        name=body.name,
        scopes=body.scopes,
        expires_at=expires_at,
    )
    db.add(api_token)
    db.commit()
    return {**_token_dict(api_token), "token": raw}


@router.delete("/tokens/{token_id}", status_code=204, dependencies=[require_permission("tokens:write")])
def delete_token(token_id: str, current_user: CurrentUserDep, db: DbSession) -> None:
    token = db.scalar(
        select(ApiToken).where(
            ApiToken.id == token_id, ApiToken.user_id == current_user.user_id
        )
    )
    if token is None:
        raise HTTPException(status_code=404, detail="Token not found")
    db.delete(token)
    db.commit()
