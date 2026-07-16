"""v1 API router — wires auth, graph, prompts, runtime, users, access, and more."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from studio_api.api.v1 import access, auth, directory, graph, groups, prompts, provider_models, resources, runtime
from studio_api.api.v1.deps import get_current_user
from studio_api.api.v1.users import roles_router, users_router


def build_v1_router(*, include_security: bool = True) -> APIRouter:
    """Assemble the v1 router.

    With ``include_security=False`` the in-repo security surface (auth, users,
    roles, directory) is omitted — the mounted cantica-secure shim serves those
    paths instead (extraction roadmap Phase C). Domain routers keep their
    blanket auth dependency; studio's get_current_user delegates to the shim
    when the flag is on.
    """
    # Public routes: no blanket auth.  Individual handlers that need auth inject
    # CurrentUserDep themselves (e.g. token management, which uses require_permission).
    public = APIRouter()
    if include_security:
        public.include_router(auth.router, prefix="/auth", tags=["auth"])

    # Protected routes: every request must authenticate via JWT or API token.
    protected = APIRouter(dependencies=[Depends(get_current_user)])
    protected.include_router(access.router, prefix="/providers", tags=["providers"])
    protected.include_router(graph.router, prefix="/graph", tags=["graph"])
    protected.include_router(prompts.router, prefix="/prompts", tags=["prompts"])
    protected.include_router(runtime.router, prefix="/runtime", tags=["runtime"])
    protected.include_router(resources.router, prefix="/resources", tags=["resources"])
    protected.include_router(provider_models.router, prefix="/models", tags=["models"])
    if include_security:
        protected.include_router(users_router, prefix="/users", tags=["users"])
        protected.include_router(roles_router, prefix="/roles", tags=["roles"])
        protected.include_router(directory.router, prefix="/directory", tags=["directory"])
    protected.include_router(groups.router, prefix="/groups", tags=["groups"])

    combined = APIRouter()
    combined.include_router(public)
    combined.include_router(protected)
    return combined


# Combined v1 router included by main.py at /v1 (flag-off path, unchanged shape)
router = build_v1_router()
