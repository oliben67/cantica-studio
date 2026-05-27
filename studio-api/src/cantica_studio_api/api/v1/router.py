"""Cantica Studio API v1 router — full CRUD, no auth, no federation."""

from __future__ import annotations

from fastapi import APIRouter

from cantica_studio_api.api.v1.endpoints import (
    branches,
    namespaces,
    prompts,
    render,
    templates,
    versions,
)

router = APIRouter()

router.include_router(namespaces.router)
router.include_router(prompts.router)
router.include_router(versions.router)
router.include_router(branches.router)
router.include_router(render.router)
router.include_router(templates.router)
