"""v1 API router — wires graph, prompts, and runtime sub-routers."""

from __future__ import annotations

from fastapi import APIRouter

from studio_api.api.v1 import graph, prompts, resources, runtime

router = APIRouter()
router.include_router(graph.router, prefix="/graph", tags=["graph"])
router.include_router(prompts.router, prefix="/prompts", tags=["prompts"])
router.include_router(runtime.router, prefix="/runtime", tags=["runtime"])
router.include_router(resources.router, prefix="/resources", tags=["resources"])
