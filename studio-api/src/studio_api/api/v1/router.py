"""v1 API router — wires auth, graph, prompts, runtime, users, access, and more."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from studio_api.api.v1 import access, auth, graph, groups, prompts, provider_models, resources, runtime
from studio_api.api.v1.deps import get_current_user
from studio_api.api.v1.users import roles_router, users_router

# Public routes: no blanket auth.  Individual handlers that need auth inject
# CurrentUserDep themselves (e.g. token management, which uses require_permission).
_public = APIRouter()
_public.include_router(auth.router, prefix="/auth", tags=["auth"])

# Protected routes: every request must authenticate via JWT or API token.
_protected = APIRouter(dependencies=[Depends(get_current_user)])
_protected.include_router(access.router, prefix="/providers", tags=["providers"])
_protected.include_router(graph.router, prefix="/graph", tags=["graph"])
_protected.include_router(prompts.router, prefix="/prompts", tags=["prompts"])
_protected.include_router(runtime.router, prefix="/runtime", tags=["runtime"])
_protected.include_router(resources.router, prefix="/resources", tags=["resources"])
_protected.include_router(provider_models.router, prefix="/models", tags=["models"])
_protected.include_router(users_router, prefix="/users", tags=["users"])
_protected.include_router(roles_router, prefix="/roles", tags=["roles"])
_protected.include_router(groups.router, prefix="/groups", tags=["groups"])

# Combined v1 router included by main.py at /v1
router = APIRouter()
router.include_router(_public)
router.include_router(_protected)
