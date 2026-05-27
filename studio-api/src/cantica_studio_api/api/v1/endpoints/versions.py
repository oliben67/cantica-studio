"""Version management endpoints for Cantica Studio API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from cantica.schemas.versions import VersionCreate, VersionResponse
from cantica_studio_api.api.deps import StoreDep

router = APIRouter(prefix="/prompts", tags=["versions"])


def _to_response(version) -> VersionResponse:
    return VersionResponse(**version.model_dump())


@router.get("/{namespace}/{name}/versions", response_model=list[VersionResponse])
def list_versions(
    namespace: str, name: str, store: StoreDep, branch: str = "main"
) -> list[VersionResponse]:
    """List versions of a prompt on the given branch, newest first."""
    prompt = store.get_prompt(namespace, name)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return [_to_response(v) for v in store.log(prompt.id, branch)]


@router.post("/{namespace}/{name}/versions", response_model=VersionResponse, status_code=201)
def create_version(
    namespace: str, name: str, body: VersionCreate, store: StoreDep
) -> VersionResponse:
    """Commit a new version of the prompt."""
    prompt = store.get_prompt(namespace, name)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    if body.sha:
        try:
            version = store.import_version(
                prompt.id, body.sha, body.content, body.message,
                body.author, body.branch, body.parent_sha, body.created_at,
            )
        except (ValueError, KeyError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    else:
        version = store.commit(
            prompt.id, body.content, body.message, body.author, branch=body.branch
        )
    return _to_response(version)


@router.get("/{namespace}/{name}/versions/{ref}", response_model=VersionResponse)
def get_version(namespace: str, name: str, ref: str, store: StoreDep) -> VersionResponse:
    """Resolve a ref (branch, tag, SHA, 'latest') to a version."""
    try:
        version = store.resolve(namespace, name, ref)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_response(version)
