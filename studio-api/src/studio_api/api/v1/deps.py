"""FastAPI dependency aliases for shared runtime objects stored in app.state."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from studio_api.cantica_client import CanticaConnector
from studio_api.runtime import ActorRuntime


def _get_runtime(request: Request) -> ActorRuntime:
    return request.app.state.runtime  # type: ignore[no-any-return]


def _get_connector(request: Request) -> CanticaConnector:
    return request.app.state.connector  # type: ignore[no-any-return]


RuntimeDep = Annotated[ActorRuntime, Depends(_get_runtime)]
ConnectorDep = Annotated[CanticaConnector, Depends(_get_connector)]
