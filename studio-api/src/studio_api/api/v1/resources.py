"""Agent resource management endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from studio_api.api.v1.deps import RuntimeDep

_log = logging.getLogger(__name__)
router = APIRouter()


class ResourceCreate(BaseModel):
    name: str
    type: str = "file"
    uri: str
    description: str = ""


class ShareRequest(BaseModel):
    target_actor: str


@router.get("/actors/{name}/resources")
def list_resources(name: str, rt: RuntimeDep) -> list[dict]:
    """List all resources owned by an actor."""
    return rt.get_resources(name)


@router.get("/actors/{name}/resources/accessible")
def list_accessible_resources(name: str, rt: RuntimeDep) -> list[dict]:
    """List resources accessible to an actor (own + shared with it)."""
    return rt.get_accessible_resources(name)


@router.post("/actors/{name}/resources", status_code=201)
def add_resource(name: str, body: ResourceCreate, rt: RuntimeDep) -> dict:
    """Add a dynamic resource to a running actor."""
    try:
        return rt.add_resource(name, body.model_dump())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/actors/{name}/resources/{resource_id}", status_code=204)
def delete_resource(name: str, resource_id: str, rt: RuntimeDep) -> None:
    """Delete a dynamic unshared resource (locked resources cannot be deleted)."""
    try:
        rt.delete_resource(name, resource_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/actors/{name}/resources/{resource_id}/share")
def share_resource(name: str, resource_id: str, body: ShareRequest, rt: RuntimeDep) -> dict:
    """Share a resource with another actor (locks it)."""
    try:
        return rt.share_resource(name, resource_id, body.target_actor)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
