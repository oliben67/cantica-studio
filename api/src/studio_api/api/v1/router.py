"""v1 API router — wires graph, prompts, and runtime sub-routers."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from studio_api.api.v1 import auth, graph, prompts, providers, resources, runtime
from studio_api.api.v1.deps import get_client_id

router = APIRouter()
_auth = [Depends(get_client_id)]

router.include_router(auth.router)  # public — bootstrapping endpoint
router.include_router(graph.router, prefix="/graph", tags=["graph"], dependencies=_auth)
router.include_router(prompts.router, prefix="/prompts", tags=["prompts"], dependencies=_auth)
router.include_router(runtime.router, prefix="/runtime", tags=["runtime"], dependencies=_auth)
router.include_router(resources.router, prefix="/resources", tags=["resources"], dependencies=_auth)
router.include_router(providers.router, prefix="/providers", tags=["providers"], dependencies=_auth)
