"""AI Actor Studio API — FastAPI app factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from studio_api.api.v1.router import router as v1_router
from studio_api.cantica_client import CanticaConnector
from studio_api.config import get_settings
from studio_api.runtime import ActorRuntime
from studio_api.workspace_fs import WorkspaceFS

log = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    from studio_api.api.v1 import prompts as prompts_ep  # noqa: PLC0415
    from studio_api.api.v1 import runtime as runtime_ep  # noqa: PLC0415
    from studio_api.api.v1 import resources as resources_ep  # noqa: PLC0415
    from studio_api import mcp_server  # noqa: PLC0415

    settings = get_settings()
    log.info("Studio API starting — workspace=%s", settings.workspace)

    connector = CanticaConnector(settings.cantica_servers)
    sessions_dir = settings.workspace / ".cantica-studio" / "sessions"
    rt = ActorRuntime(sessions_dir=sessions_dir)
    fs = WorkspaceFS(settings.workspace)

    prompts_ep.init(connector)
    runtime_ep.init(rt, connector)
    resources_ep.init(rt)
    mcp_server.init(fs, rt)

    log.info("Configured %d Cantica server(s)", len(settings.cantica_servers))

    yield

    log.info("Studio API stopping — shutting down actors")
    rt.stop_all()


def create_app() -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")

    app = FastAPI(
        title="Cantica Studio API",
        description="AI Actor Studio — run actor-ai agents with MCP and Cantica prompt integration.",
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

    from studio_api.mcp_server import mcp  # noqa: PLC0415

    app.mount("/mcp", mcp.http_app(path="/"))

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "studio-api"}

    @app.get("/.well-known/cantica.json", tags=["meta"])
    def discovery() -> dict[str, str]:
        settings = get_settings()
        return {
            "version": "0.1",
            "service": "studio-api",
            "api_url": "/v1",
            "mcp_url": "/mcp",
            "workspace": str(settings.workspace),
        }

    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "studio_api.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
