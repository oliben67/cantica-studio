"""Prompt proxy — aggregate prompts from all connected Cantica servers."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from studio_api.config import get_settings
from studio_api.cantica_client import CanticaConnector

router = APIRouter()

_connector: CanticaConnector | None = None


def init(connector: CanticaConnector) -> None:
    global _connector
    _connector = connector


def _get() -> CanticaConnector:
    if _connector is None:
        raise RuntimeError("CanticaConnector not initialised")
    return _connector


@router.get("")
async def list_prompts(
    q: str | None = Query(None, description="Full-text search query"),
    tag: str | None = Query(None, description="Filter by tag"),
) -> list[dict]:
    """List prompts aggregated from all configured Cantica servers."""
    return await _get().list_prompts(q=q, tag=tag)


@router.get("/{namespace}/{name}")
async def get_prompt(
    namespace: str,
    name: str,
    ref: str = "latest",
    server: str | None = None,
) -> dict:
    """Fetch a specific prompt version from a Cantica server."""
    connector = _get()
    servers = get_settings().cantica_servers
    if not servers:
        raise HTTPException(status_code=503, detail="No Cantica servers configured")

    target_url = server or servers[0].url
    try:
        content = await connector.get_prompt_content(target_url, namespace, name, ref)
        return {"namespace": namespace, "name": name, "ref": ref, "content": content}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
