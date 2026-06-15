"""FastAPI dependency aliases for shared runtime objects stored in app.state."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request

from studio_api.cantica_client import CanticaConnector
from studio_api.config import get_settings
from studio_api.core.client_auth import verify_assertion
from studio_api.runtime import ActorRuntime


def _get_runtime(request: Request) -> ActorRuntime:
    return request.app.state.runtime  # type: ignore[no-any-return]


def _get_connector(request: Request) -> CanticaConnector:
    return request.app.state.connector  # type: ignore[no-any-return]


def get_client_id(authorization: Annotated[str | None, Header()] = None) -> str | None:
    """Verify RS256 JWT bearer token when auth_enabled=True; return client_id or None."""
    settings = get_settings()
    if not settings.auth_enabled:
        return None
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization required")
    token = authorization.split(" ", 1)[1]
    client_id = verify_assertion(token)
    if client_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired client assertion")
    return client_id


RuntimeDep = Annotated[ActorRuntime, Depends(_get_runtime)]
ConnectorDep = Annotated[CanticaConnector, Depends(_get_connector)]
ClientDep = Annotated[str | None, Depends(get_client_id)]
