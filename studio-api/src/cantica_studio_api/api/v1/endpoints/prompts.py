"""Prompt CRUD endpoints for Cantica Studio API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from cantica.schemas.prompts import PromptCreate, PromptResponse
from cantica_studio_api.api.deps import StoreDep

router = APIRouter(prefix="/prompts", tags=["prompts"])


def _to_response(prompt) -> PromptResponse:
    return PromptResponse(**prompt.model_dump())


@router.get("", response_model=list[PromptResponse])
def list_prompts(
    store: StoreDep,
    namespace: str | None = None,
    q: str | None = Query(None, description="Full-text search"),
    tag: str | None = Query(None),
    model: str | None = Query(None),
    visibility: str | None = Query(None),
) -> list[PromptResponse]:
    """List or search prompts."""
    if q:
        return [_to_response(p) for p in store.search_prompts(
            q, namespace=namespace, tag=tag, model=model, visibility=visibility
        )]
    return [_to_response(p) for p in store.list_prompts(namespace, tag=tag, model=model, visibility=visibility)]


@router.post("", response_model=PromptResponse, status_code=201)
def create_prompt(body: PromptCreate, store: StoreDep) -> PromptResponse:
    """Create a new prompt."""
    if store.get_prompt(body.namespace, body.name):
        raise HTTPException(status_code=409, detail="Prompt already exists")
    prompt = store.create_prompt(
        body.namespace, body.name, body.description,
        tags=body.tags, model_hints=body.model_hints,
        license=body.license, visibility=body.visibility,
        variables=body.variables, source=body.source,
    )
    return _to_response(prompt)


@router.get("/{namespace}/{name}", response_model=PromptResponse)
def get_prompt(namespace: str, name: str, store: StoreDep) -> PromptResponse:
    """Return a single prompt."""
    prompt = store.get_prompt(namespace, name)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return _to_response(prompt)


@router.delete("/{namespace}/{name}", status_code=204)
def delete_prompt(namespace: str, name: str, store: StoreDep) -> None:
    """Delete a prompt and all its versions."""
    prompt = store.get_prompt(namespace, name)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    store.delete_prompt(prompt.id)
