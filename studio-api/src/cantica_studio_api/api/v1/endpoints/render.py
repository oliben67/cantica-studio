"""Render endpoint for Cantica Studio API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from cantica.schemas.render import RenderRequest, RenderResponse
from cantica.services.template_engine import TemplateEngine
from cantica_studio_api.api.deps import StoreDep

router = APIRouter(tags=["render"])
_engine = TemplateEngine()


@router.post("/render", response_model=RenderResponse)
def render_prompt(body: RenderRequest, store: StoreDep) -> RenderResponse:
    """Resolve a prompt ref and render it with variable substitution."""
    parts = body.slug.split("/")
    if len(parts) != 2:
        raise HTTPException(status_code=422, detail="slug must be namespace/name")
    namespace, name = parts
    try:
        version = store.resolve(namespace, name, body.ref)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        content = _engine.render_with_defaults(version.content, version.variables, body.variables)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return RenderResponse(content=content, slug=body.slug, ref=body.ref, sha=version.sha)


@router.post("/resolve", tags=["resolve"])
def resolve_prompt(slug: str, ref: str = "latest", store: StoreDep = None) -> dict:
    """Resolve a slug/ref to its version SHA and content."""
    parts = slug.split("/")
    if len(parts) != 2:
        raise HTTPException(status_code=422, detail="slug must be namespace/name")
    namespace, name = parts
    try:
        version = store.resolve(namespace, name, ref)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"sha": version.sha, "content": version.content, "slug": slug, "ref": ref}
