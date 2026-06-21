"""Provider endpoints — manage providers and their API tokens stored in the database."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from studio_api.api.v1.deps import CurrentUserDep, DbSession, require_permission
from studio_api.api.v1.provider_models import PROVIDER_TYPES
from studio_api.orm.models import Provider, ProviderToken

router = APIRouter()

VALID_TYPES = set(PROVIDER_TYPES)


# ── Schemas ───────────────────────────────────────────────────────────────────

class ProviderCreate(BaseModel):
    name: str
    type: str
    group_id: str | None = None     # set to create a group-owned provider


class ProviderUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class TokenCreate(BaseModel):
    label: str = "default"
    token: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _validate_provider_owner(user_id: str | None, group_id: str | None) -> None:
    if (user_id is None) == (group_id is None):
        raise ValueError("Exactly one of user_id or group_id must be set")


def _provider_response(p: Provider) -> dict:
    return {
        "id": p.id,
        "user_id": p.user_id,
        "group_id": p.group_id,
        "scope": "group" if p.user_id is None else "personal",
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


def _get_provider_or_404(db: DbSession, provider_id: str, current_user: CurrentUserDep) -> Provider:
    """Return provider if owned by the user or by their group; raise 404 otherwise."""
    owner_clauses = [Provider.user_id == current_user.user_id]
    if current_user.group_id is not None:
        owner_clauses.append(Provider.group_id == current_user.group_id)

    p = db.scalar(
        select(Provider)
        .where(Provider.id == provider_id, or_(*owner_clauses))
        .options(selectinload(Provider.tokens))
    )
    if p is None:
        raise HTTPException(status_code=404, detail=f"Provider {provider_id!r} not found")
    return p


# ── Provider CRUD ─────────────────────────────────────────────────────────────

@router.get("", dependencies=[require_permission("providers:read")])
def list_providers(db: DbSession, current_user: CurrentUserDep) -> list[dict]:
    owner_clauses = [Provider.user_id == current_user.user_id]
    if current_user.group_id is not None:
        owner_clauses.append(Provider.group_id == current_user.group_id)

    providers = db.scalars(
        select(Provider)
        .where(or_(*owner_clauses))
        .options(selectinload(Provider.tokens))
        .order_by(Provider.created_at)
    ).all()
    return [_provider_response(p) for p in providers]


@router.post("", status_code=201, dependencies=[require_permission("providers:write")])
def create_provider(body: ProviderCreate, db: DbSession, current_user: CurrentUserDep) -> dict:
    if body.type not in VALID_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid provider type {body.type!r}. Must be one of: {', '.join(sorted(VALID_TYPES))}",
        )

    if body.group_id is not None:
        if not current_user.has("groups:write"):
            raise HTTPException(status_code=403, detail="Requires groups:write to create group-owned providers")
        _validate_provider_owner(None, body.group_id)
        p = Provider(group_id=body.group_id, name=body.name, type=body.type)
    else:
        _validate_provider_owner(current_user.user_id, None)
        p = Provider(user_id=current_user.user_id, name=body.name, type=body.type)

    db.add(p)
    db.flush()
    db.refresh(p)
    db.commit()
    return _provider_response(p)


@router.get("/{provider_id}", dependencies=[require_permission("providers:read")])
def get_provider(provider_id: str, db: DbSession, current_user: CurrentUserDep) -> dict:
    p = _get_provider_or_404(db, provider_id, current_user)
    return _provider_response(p)


@router.patch("/{provider_id}", dependencies=[require_permission("providers:write")])
def update_provider(provider_id: str, body: ProviderUpdate, db: DbSession, current_user: CurrentUserDep) -> dict:
    p = _get_provider_or_404(db, provider_id, current_user)
    if body.name is not None:
        p.name = body.name
    if body.is_active is not None:
        p.is_active = body.is_active
    db.commit()
    db.refresh(p)
    return _provider_response(p)


@router.delete("/{provider_id}", status_code=204, dependencies=[require_permission("providers:write")])
def delete_provider(provider_id: str, db: DbSession, current_user: CurrentUserDep) -> None:
    p = _get_provider_or_404(db, provider_id, current_user)
    db.delete(p)
    db.commit()


# ── Token sub-resource ────────────────────────────────────────────────────────

@router.get("/{provider_id}/tokens", dependencies=[require_permission("providers:read")])
def list_tokens(provider_id: str, db: DbSession, current_user: CurrentUserDep) -> list[dict]:
    _get_provider_or_404(db, provider_id, current_user)
    tokens = db.scalars(
        select(ProviderToken).where(ProviderToken.provider_id == provider_id)
    ).all()
    return [_token_response(t) for t in tokens]


@router.post("/{provider_id}/tokens", status_code=201, dependencies=[require_permission("providers:write")])
def add_token(provider_id: str, body: TokenCreate, db: DbSession, current_user: CurrentUserDep) -> dict:
    _get_provider_or_404(db, provider_id, current_user)
    t = ProviderToken(provider_id=provider_id, label=body.label, token=body.token)
    db.add(t)
    db.commit()
    db.refresh(t)
    return _token_response(t, include_value=True)


@router.delete("/{provider_id}/tokens/{token_id}", status_code=204, dependencies=[require_permission("providers:write")])
def delete_token(provider_id: str, token_id: str, db: DbSession, current_user: CurrentUserDep) -> None:
    _get_provider_or_404(db, provider_id, current_user)
    t = db.scalar(
        select(ProviderToken)
        .where(ProviderToken.id == token_id, ProviderToken.provider_id == provider_id)
    )
    if t is None:
        raise HTTPException(status_code=404, detail=f"Token {token_id!r} not found")
    db.delete(t)
    db.commit()
