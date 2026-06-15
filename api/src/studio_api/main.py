"""AI Actor Studio API — FastAPI app factory."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from importlib.metadata import version as _pkg_version
from pathlib import Path
from uuid import uuid4

_SERVER_ID = str(uuid4())

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

_VERSION = _pkg_version("studio-api")

from studio_api.api.v1.router import router as v1_router
from studio_api.cantica_client import CanticaConnector
from studio_api.config import get_settings
from studio_api.runtime import ActorRuntime
from studio_api.workspace_fs import WorkspaceFS

log = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    from studio_api import mcp_server  # noqa: PLC0415

    settings = get_settings()
    log.info("Studio API starting — workspace=%s", settings.workspace)

    _app.state.started_at = time.monotonic()
    _app.state.connector = CanticaConnector(settings.cantica_servers)
    sessions_dir = settings.workspace / ".cantica-studio" / "sessions"
    _app.state.runtime = ActorRuntime(sessions_dir=sessions_dir)
    _app.state.runtime.start_health_monitor(settings.cantica_servers)
    fs = WorkspaceFS(settings.workspace)

    mcp_server.init(fs, _app.state.runtime)

    log.info("Configured %d Cantica server(s)", len(settings.cantica_servers))

    yield

    log.info("Studio API stopping — shutting down actors")
    _app.state.runtime.stop_all()


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
    def health(request: Request) -> dict:
        uptime = time.monotonic() - getattr(request.app.state, "started_at", 0.0)
        settings = get_settings()
        return {
            "status": "ok",
            "service": "studio-api",
            "version": _VERSION,
            "server_id": _SERVER_ID,
            "uptime_seconds": round(uptime, 1),
            "workspace": str(settings.workspace),
            "containerized": Path("/.dockerenv").exists(),
        }

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
