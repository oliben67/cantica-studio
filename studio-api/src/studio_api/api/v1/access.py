"""Provider endpoints — manage providers and their API tokens stored in the database."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from studio_api.api.v1.deps import CurrentUserDep, DbSession, require_permission
from studio_api.orm.models import Provider, ProviderToken, User

router = APIRouter()

VALID_TYPES = {"claude", "gpt", "gemini", "copilot", "mistral"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class ProviderCreate(BaseModel):
    name: str
    type: str


class ProviderUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class TokenCreate(BaseModel):
    label: str = "default"
    token: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _provider_response(p: Provider) -> dict:
    return {
        "id": p.id,
        "user_id": p.user_id,
        "name": p.name,
        "type": p.type,
        "is_active": p.is_active,
        "token_count": len(p.tokens),
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat(),
    }


def _token_response(t: ProviderToken, *, include_value: bool = False) -> dict:
    r: dict = {
        "id": t.id,
        "provider_id": t.provider_id,
        "label": t.label,
        "is_active": t.is_active,
        "created_at": t.created_at.isoformat(),
        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
    }
    if include_value:
        r["token"] = t.token
    return r


def _get_provider_or_404(db: DbSession, provider_id: str, user_id: str) -> Provider:
    p = db.scalar(
        select(Provider)
        .where(Provider.id == provider_id, Provider.user_id == user_id)
        .options(selectinload(Provider.tokens))
    )
    if p is None:
        raise HTTPException(status_code=404, detail=f"Provider {provider_id!r} not found")
    return p


def _resolve_user_id(db: DbSession, current_user: CurrentUserDep) -> str:
    """Return the DB user id for the current user, or the local user id in local mode."""
    from studio_api.orm.seed import LOCAL_USER_EMAIL  # noqa: PLC0415

    if current_user.user_id == "local":
        local = db.scalar(select(User).where(User.email == LOCAL_USER_EMAIL))
        if local is None:
            raise HTTPException(status_code=500, detail="Local user not found in database")
        return local.id
    return current_user.user_id


# ── Provider CRUD ─────────────────────────────────────────────────────────────

@router.get("", dependencies=[require_permission("providers:read")])
def list_providers(db: DbSession, current_user: CurrentUserDep) -> list[dict]:
    user_id = _resolve_user_id(db, current_user)
    providers = db.scalars(
        select(Provider)
        .where(Provider.user_id == user_id)
        .options(selectinload(Provider.tokens))
        .order_by(Provider.created_at)
    ).all()
    return [_provider_response(p) for p in providers]


@router.post("", status_code=201, dependencies=[require_permission("providers:write")])
def create_provider(body: ProviderCreate, db: DbSession, current_user: CurrentUserDep) -> dict:
    if body.type not in VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid provider type {body.type!r}. Must be one of: {', '.join(sorted(VALID_TYPES))}")
    user_id = _resolve_user_id(db, current_user)
    p = Provider(user_id=user_id, name=body.name, type=body.type)
    db.add(p)
    db.flush()
    db.refresh(p)
    db.commit()
    return _provider_response(p)


@router.get("/{provider_id}", dependencies=[require_permission("providers:read")])
def get_provider(provider_id: str, db: DbSession, current_user: CurrentUserDep) -> dict:
    user_id = _resolve_user_id(db, current_user)
    p = _get_provider_or_404(db, provider_id, user_id)
    return _provider_response(p)


@router.patch("/{provider_id}", dependencies=[require_permission("providers:write")])
def update_provider(provider_id: str, body: ProviderUpdate, db: DbSession, current_user: CurrentUserDep) -> dict:
    user_id = _resolve_user_id(db, current_user)
    p = _get_provider_or_404(db, provider_id, user_id)
    if body.name is not None:
        p.name = body.name
    if body.is_active is not None:
        p.is_active = body.is_active
    db.commit()
    db.refresh(p)
    return _provider_response(p)


@router.delete("/{provider_id}", status_code=204, dependencies=[require_permission("providers:write")])
def delete_provider(provider_id: str, db: DbSession, current_user: CurrentUserDep) -> None:
    user_id = _resolve_user_id(db, current_user)
    p = _get_provider_or_404(db, provider_id, user_id)
    db.delete(p)
    db.commit()


# ── Token sub-resource ────────────────────────────────────────────────────────

@router.get("/{provider_id}/tokens", dependencies=[require_permission("providers:read")])
def list_tokens(provider_id: str, db: DbSession, current_user: CurrentUserDep) -> list[dict]:
    user_id = _resolve_user_id(db, current_user)
    _get_provider_or_404(db, provider_id, user_id)
    tokens = db.scalars(
        select(ProviderToken).where(ProviderToken.provider_id == provider_id)
    ).all()
    return [_token_response(t) for t in tokens]


@router.post("/{provider_id}/tokens", status_code=201, dependencies=[require_permission("providers:write")])
def add_token(provider_id: str, body: TokenCreate, db: DbSession, current_user: CurrentUserDep) -> dict:
    user_id = _resolve_user_id(db, current_user)
    _get_provider_or_404(db, provider_id, user_id)
    t = ProviderToken(provider_id=provider_id, label=body.label, token=body.token)
    db.add(t)
    db.commit()
    db.refresh(t)
    return _token_response(t, include_value=True)


@router.delete("/{provider_id}/tokens/{token_id}", status_code=204, dependencies=[require_permission("providers:write")])
def delete_token(provider_id: str, token_id: str, db: DbSession, current_user: CurrentUserDep) -> None:
    user_id = _resolve_user_id(db, current_user)
    _get_provider_or_404(db, provider_id, user_id)
    t = db.scalar(
        select(ProviderToken)
        .where(ProviderToken.id == token_id, ProviderToken.provider_id == provider_id)
    )
    if t is None:
        raise HTTPException(status_code=404, detail=f"Token {token_id!r} not found")
    db.delete(t)
    db.commit()
