"""Branch management endpoints for Cantica Studio API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from cantica.schemas.branches import BranchCreate, BranchResponse
from cantica_studio_api.api.deps import StoreDep

router = APIRouter(prefix="/prompts", tags=["branches"])


def _to_response(branch) -> BranchResponse:
    return BranchResponse(**branch.model_dump())


@router.get("/{namespace}/{name}/branches", response_model=list[BranchResponse])
def list_branches(namespace: str, name: str, store: StoreDep) -> list[BranchResponse]:
    """List all branches of a prompt."""
    prompt = store.get_prompt(namespace, name)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return [_to_response(b) for b in store.list_branches(prompt.id)]


@router.post("/{namespace}/{name}/branches", response_model=BranchResponse, status_code=201)
def create_branch(namespace: str, name: str, body: BranchCreate, store: StoreDep) -> BranchResponse:
    """Create a new branch from a given SHA."""
    prompt = store.get_prompt(namespace, name)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    try:
        branch = store.create_branch(prompt.id, body.name, body.from_sha)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _to_response(branch)
