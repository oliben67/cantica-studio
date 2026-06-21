"""AI Actor Studio API — FastAPI app factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from studio_api.api.v1.router import router as v1_router
from studio_api.auth.password import hash_password
from studio_api.cantica_client import CanticaConnector
from studio_api.config import get_settings
from studio_api.orm.db import Base, make_engine, new_session
from studio_api.orm.seed import ensure_admin, ensure_local_user, seed, seed_providers
from studio_api.runtime import ActorRuntime
from studio_api.workspace_fs import WorkspaceFS

log = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    from studio_api import mcp_server  # noqa: PLC0415

    settings = get_settings()
    log.info("Studio API starting — workspace=%s", settings.workspace)

    # ── Auth database ──────────────────────────────────────────────────────────
    studio_dir = settings.cantica_home / "studio"
    db_path = studio_dir / "studio.db"
    db_engine = make_engine(db_path)
    Base.metadata.create_all(db_engine)
    _app.state.db_engine = db_engine
    with new_session(db_engine) as _db:
        seed(_db)
        if settings.local_mode:
            local_user = ensure_local_user(_db)
            seed_providers(_db, local_user)
            _app.state.local_user_id = local_user.id
        elif settings.admin_password:
            ensure_admin(_db, settings.admin_email, hash_password(settings.admin_password))

    _app.state.connector = CanticaConnector(settings.cantica_servers)
    sessions_dir = studio_dir / "sessions"
    _app.state.runtime = ActorRuntime(sessions_dir=sessions_dir, db_engine=db_engine)
    _app.state.graph_locks = {}   # path → GraphLock (see api/v1/graph.py)
    fs = WorkspaceFS(settings.workspace)

    mcp_server.init(fs, _app.state.runtime)

    log.info(
        "Configured %d Cantica server(s) — local_mode=%s",
        len(settings.cantica_servers),
        settings.local_mode,
    )

    yield

    log.info("Studio API stopping — shutting down actors")
    _app.state.runtime.stop_all()
    db_engine.dispose()


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
    def health() -> dict[str, object]:
        import os  # noqa: PLC0415

        settings = get_settings()
        return {
            "status": "ok",
            "service": "studio-api",
            "local_mode": settings.local_mode,
            "auth_enabled": not settings.local_mode,
            "containerized": os.path.exists("/.dockerenv"),
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
