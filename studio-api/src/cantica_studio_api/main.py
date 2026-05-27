"""
Cantica Studio API — FastAPI application factory.

A lightweight local API server that backs the Cantica Studio VSCode extension.
It exposes the full Cantica CRUD surface (namespaces, prompts, versions, branches,
render) without authentication or federation.  Data is stored in
``CANTICA_HOME/vault`` (default: ``~/.cantica/vault``).

The module-level ``app`` singleton is what Uvicorn imports:
    uvicorn cantica_studio_api.main:app --reload
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cantica_studio_api.api.v1.router import router as v1_router
from cantica_studio_api.config import get_settings

log = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    from cantica_studio_api.api.deps import get_store  # noqa: PLC0415

    settings = get_settings()
    log.info("Cantica Studio API starting — home=%s", settings.home)
    store = get_store()
    log.info("Vault: %s", store.root)
    yield
    store.close()
    log.info("Cantica Studio API stopped.")


def create_app() -> FastAPI:
    """Build and return the configured FastAPI application."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")

    app = FastAPI(
        title="Cantica Studio API",
        description=(
            "Local prompt vault for the Cantica Studio VSCode extension. "
            "Full CRUD — no auth, no federation."
        ),
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(v1_router, prefix="/v1")

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "cantica-studio-api"}

    @app.get("/.well-known/cantica.json", tags=["meta"])
    def discovery() -> dict[str, str]:
        settings = get_settings()
        return {
            "version": "0.1",
            "service": "cantica-studio-api",
            "api_url": "/v1",
            "home": str(settings.home),
            "templates_url": "/v1/templates",
        }

    return app


app = create_app()


def main() -> None:
    """CLI entry-point: ``cantica-studio``."""
    settings = get_settings()
    uvicorn.run(
        "cantica_studio_api.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
