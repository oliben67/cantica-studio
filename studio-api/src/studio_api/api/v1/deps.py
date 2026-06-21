"""FastAPI dependency aliases for shared runtime objects stored in app.state."""

from __future__ import annotations

from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from studio_api.auth.deps import CurrentUser, CurrentUserDep, get_current_user, require_permission
from studio_api.cantica_client import CanticaConnector
from studio_api.orm.db import new_session
from studio_api.runtime import ActorRuntime


def _get_runtime(request: Request) -> ActorRuntime:
    return request.app.state.runtime  # type: ignore[no-any-return]


def _get_connector(request: Request) -> CanticaConnector:
    return request.app.state.connector  # type: ignore[no-any-return]


def _get_db_session(request: Request) -> Generator[Session, None, None]:
    engine = request.app.state.db_engine
    with new_session(engine) as session:
        yield session


RuntimeDep = Annotated[ActorRuntime, Depends(_get_runtime)]
ConnectorDep = Annotated[CanticaConnector, Depends(_get_connector)]
DbSession = Annotated[Session, Depends(_get_db_session)]

__all__ = [
    "ConnectorDep",
    "CurrentUser",
    "CurrentUserDep",
    "DbSession",
    "RuntimeDep",
    "get_current_user",
    "require_permission",
]
