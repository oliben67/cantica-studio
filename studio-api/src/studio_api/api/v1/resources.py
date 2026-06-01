"""Agent resource management endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from studio_api.runtime import ActorRuntime

_log = logging.getLogger(__name__)
router = APIRouter()

_runtime: ActorRuntime | None = None


def init(runtime: ActorRuntime) -> None:
    global _runtime
    _runtime = runtime


def _rt() -> ActorRuntime:
    if _runtime is None:
        raise HTTPException(status_code=503, detail="Runtime not initialised")
    return _runtime


class ResourceCreate(BaseModel):
    name: str
    type: str = "file"
    uri: str
    description: str = ""


class ShareRequest(BaseModel):
    target_actor: str


@router.get("/actors/{name}/resources")
def list_resources(name: str) -> list[dict]:
    """List all resources owned by an actor."""
    return _rt().get_resources(name)


@router.get("/actors/{name}/resources/accessible")
def list_accessible_resources(name: str) -> list[dict]:
    """List resources accessible to an actor (own + shared with it)."""
    return _rt().get_accessible_resources(name)


@router.post("/actors/{name}/resources", status_code=201)
def add_resource(name: str, body: ResourceCreate) -> dict:
    """Add a dynamic resource to a running actor."""
    try:
        return _rt().add_resource(name, body.model_dump())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/actors/{name}/resources/{resource_id}", status_code=204)
def delete_resource(name: str, resource_id: str) -> None:
    """Delete a dynamic unshared resource (locked resources cannot be deleted)."""
    try:
        _rt().delete_resource(name, resource_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/actors/{name}/resources/{resource_id}/share")
def share_resource(name: str, resource_id: str, body: ShareRequest) -> dict:
    """Share a resource with another actor (locks it)."""
    try:
        return _rt().share_resource(name, resource_id, body.target_actor)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
