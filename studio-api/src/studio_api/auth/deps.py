"""Auth dependencies — CurrentUser, get_current_user, require_permission."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from studio_api.auth.flags import GENERIC_AUTH_FAILURE, gate_user
from studio_api.auth.jwt import decode_access_token
from studio_api.config import get_settings
from studio_api.orm.models import ApiToken, User
from studio_api.orm.seed import LOCAL_USER_EMAIL

_bearer = HTTPBearer(auto_error=False)
_ALL = "*"


@dataclass
class CurrentUser:
    user_id: str
    email: str
    roles: list[str] = field(default_factory=list)
    permissions: list[str] = field(default_factory=list)
    group_id: str | None = None
    # warning:* flags carried by the account (spec AUTH F "authenticated with warning").
    warnings: list[str] = field(default_factory=list)

    def has(self, permission: str) -> bool:
        return _ALL in self.permissions or permission in self.permissions


def _generic_401() -> HTTPException:
    # One indistinguishable failure for invalid / blocked / inactive / unknown —
    # the real reason lives in the studio_api.audit log (see auth/flags.py).
    return HTTPException(status_code=401, detail=GENERIC_AUTH_FAILURE)


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CurrentUser:
    """Resolve the current user from a JWT or API token Bearer credential.

    In local_mode returns an admin CurrentUser with the real DB user_id (set in
    app.state.local_user_id at startup), skipping all credential checks.

    In remote mode the flag gate (spec AUTH F) runs on EVERY request for both
    credential paths, so a blocked/* flag or deactivation takes effect
    immediately, not just at the next login.
    """
    settings = get_settings()

    if settings.local_mode:
        return CurrentUser(
            user_id=getattr(request.app.state, "local_user_id", "local"),
            email=LOCAL_USER_EMAIL,
            roles=["admin"],
            permissions=[_ALL],
        )

    if credentials is None:
        raise HTTPException(status_code=401, detail="Unauthorized")

    raw = credentials.credentials
    from studio_api.orm.db import new_session  # noqa: PLC0415

    engine = request.app.state.db_engine

    # ── JWT path (three dot-separated segments) ───────────────────────────────
    if raw.count(".") == 2:
        try:
            payload = decode_access_token(raw, settings.jwt_secret)
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")

        with new_session(engine) as session:
            user = session.scalar(
                select(User)
                .options(selectinload(User.flags))
                .where(User.id == payload["sub"])
            )
            result = gate_user(user, context="request:jwt")
            if not result.allowed:
                raise _generic_401()

        request.state.cantica_warnings = result.warnings
        return CurrentUser(
            user_id=payload["sub"],
            email=payload.get("email", ""),
            roles=payload.get("roles", []),
            permissions=payload.get("permissions", []),
            group_id=payload.get("group_id"),
            warnings=result.warnings,
        )

    # ── API token path (opaque token looked up by hash) ───────────────────────
    token_hash = hashlib.sha256(raw.encode()).hexdigest()

    with new_session(engine) as session:
        api_token = session.scalar(
            select(ApiToken)
            .options(
                selectinload(ApiToken.user).selectinload(User.roles),
                selectinload(ApiToken.user).selectinload(User.flags),
            )
            .where(ApiToken.token_hash == token_hash)
        )
        if api_token is None:
            raise HTTPException(status_code=401, detail="Invalid token")

        now = datetime.now(timezone.utc)
        if api_token.expires_at is not None and api_token.expires_at < now:
            raise HTTPException(status_code=401, detail="Token expired")

        result = gate_user(api_token.user, context="request:api-token")
        if not result.allowed:
            raise _generic_401()

        # Update last_used_at
        api_token.last_used_at = now
        session.commit()

        request.state.cantica_warnings = result.warnings
        return CurrentUser(
            user_id=api_token.user.id,
            email=api_token.user.email,
            roles=[r.name for r in api_token.user.roles],
            permissions=list(api_token.scopes),
            warnings=result.warnings,
        )


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_permission(*permissions: str):
    """Return a FastAPI Depends that raises 403 if the user lacks ALL listed permissions.

    Accepts any one of the listed permissions (OR semantics).
    A no-op in local_mode (current user has the wildcard '*').
    """
    async def _check(user: CurrentUserDep) -> None:
        if any(user.has(p) for p in permissions):
            return
        raise HTTPException(
            status_code=403,
            detail=f"Requires one of: {', '.join(permissions)}",
        )
    return Depends(_check)
