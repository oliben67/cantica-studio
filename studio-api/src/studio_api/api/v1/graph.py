"""Actor graph CRUD — persisted as JSON-LD in the workspace."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from studio_api.api.v1.deps import require_permission
from studio_api.config import get_settings

router = APIRouter()


class GraphPayload(BaseModel):
    data: dict


@router.get("", dependencies=[require_permission("graph:read")])
def load_graph() -> dict:
    """Return the actor graph JSON-LD from the workspace file."""
    path = get_settings().graph_path
    if not path.exists():
        return _empty_graph()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("", dependencies=[require_permission("graph:write")])
def save_graph(payload: GraphPayload) -> dict:
    """Persist the actor graph JSON-LD to the workspace file."""
    path = get_settings().graph_path
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload.data, indent=2, ensure_ascii=False), encoding="utf-8")
        return {"status": "saved"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _empty_graph() -> dict:
    return {
        "@context": {
            "@vocab": "https://cantica.dev/studio/",
            "schema": "http://schema.org/",
            "name": "schema:name",
        },
        "@type": "ActorGraph",
        "@id": "urn:cantica:studio:graph:default",
        "name": "New Workflow",
        "actors": [],
        "edges": [],
    }
