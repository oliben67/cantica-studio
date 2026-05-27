"""Namespace CRUD endpoints for Cantica Studio API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from cantica.schemas.namespaces import NamespaceCreate, NamespaceResponse, NamespaceUpdate
from cantica_studio_api.api.deps import StoreDep

router = APIRouter(prefix="/namespaces", tags=["namespaces"])


def _to_response(ns) -> NamespaceResponse:
    return NamespaceResponse(**ns.model_dump())


@router.get("", response_model=list[NamespaceResponse])
def list_namespaces(store: StoreDep) -> list[NamespaceResponse]:
    """List all namespaces."""
    return [_to_response(ns) for ns in store.list_namespaces()]


@router.post("", response_model=NamespaceResponse, status_code=201)
def create_namespace(body: NamespaceCreate, store: StoreDep) -> NamespaceResponse:
    """Create or return an existing namespace (idempotent)."""
    ns = store.get_or_create_namespace(
        body.name,
        description=body.description or "",
        is_proprietary=body.is_proprietary,
        encoded=body.encoded,
    )
    return _to_response(ns)


@router.get("/{name}", response_model=NamespaceResponse)
def get_namespace(name: str, store: StoreDep) -> NamespaceResponse:
    """Return a namespace by name."""
    ns = store.get_namespace(name)
    if not ns:
        raise HTTPException(status_code=404, detail="Namespace not found")
    return _to_response(ns)


@router.patch("/{name}", response_model=NamespaceResponse)
def update_namespace(name: str, body: NamespaceUpdate, store: StoreDep) -> NamespaceResponse:
    """Update a namespace's description or proprietary flag."""
    try:
        updated = store.update_namespace(
            name,
            description=body.description,
            is_proprietary=body.is_proprietary,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Namespace not found") from exc
    return _to_response(updated)
