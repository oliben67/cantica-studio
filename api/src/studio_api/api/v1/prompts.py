"""Prompt proxy — aggregate prompts from all connected Cantica servers."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from studio_api.api.v1.deps import ConnectorDep
from studio_api.config import get_settings

router = APIRouter()


@router.get("")
async def list_prompts(
    connector: ConnectorDep,
    q: str | None = Query(None, description="Full-text search query"),
    tag: str | None = Query(None, description="Filter by tag"),
) -> list[dict]:
    """List prompts aggregated from all configured Cantica servers."""
    return await connector.list_prompts(q=q, tag=tag)


@router.get("/{namespace}/{name}")
async def get_prompt(
    namespace: str,
    name: str,
    connector: ConnectorDep,
    ref: str = "latest",
    server: str | None = None,
) -> dict:
    """Fetch a specific prompt version from a Cantica server."""
    servers = get_settings().cantica_servers
    if not servers:
        raise HTTPException(status_code=503, detail="No Cantica servers configured")

    target_url = server or servers[0].url
    try:
        content = await connector.get_prompt_content(target_url, namespace, name, ref)
        return {"namespace": namespace, "name": name, "ref": ref, "content": content}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
