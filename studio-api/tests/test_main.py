"""Tests for studio_api.main — app creation, meta endpoints, MCP mount."""

from __future__ import annotations

from fastapi.testclient import TestClient

from studio_api.main import create_app


def _client() -> TestClient:
    """Create a TestClient with the app but bypass lifespan (no pykka/APScheduler)."""
    app = create_app()
    return TestClient(app, raise_server_exceptions=True)


def test_health_endpoint():
    with _client() as c:
        r = c.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "studio-api"}


def test_discovery_endpoint():
    with _client() as c:
        r = c.get("/.well-known/cantica.json")
    assert r.status_code == 200
    data = r.json()
    assert data["service"] == "studio-api"
    assert data["api_url"] == "/v1"
    assert data["mcp_url"] == "/mcp"
    assert "workspace" in data


def test_docs_available():
    with _client() as c:
        r = c.get("/docs")
    assert r.status_code == 200


def test_redoc_available():
    with _client() as c:
        r = c.get("/redoc")
    assert r.status_code == 200


def test_mcp_mount_reachable():
    """The /mcp path is mounted — POST returns non-404."""
    from studio_api.workspace_fs import WorkspaceFS  # noqa: PLC0415
    import studio_api.mcp_server as mcp_mod  # noqa: PLC0415
    import tempfile, pathlib  # noqa: PLC0415, E401

    app = create_app()
    with tempfile.TemporaryDirectory() as td:
        mcp_mod.init(WorkspaceFS(pathlib.Path(td)))
        with TestClient(app, raise_server_exceptions=False) as c:
            r = c.post("/mcp/", content=b"{}", headers={"content-type": "application/json"})
        mcp_mod._fs = None
    assert r.status_code != 404


def test_cors_headers():
    with _client() as c:
        r = c.options("/health", headers={"Origin": "http://localhost:3000"})
    assert r.headers.get("access-control-allow-origin") in ("*", "http://localhost:3000")


def test_v1_graph_endpoint_present():
    with _client() as c:
        r = c.get("/v1/graph")
    assert r.status_code in (200, 500)  # 500 if workspace not configured


def test_v1_prompts_endpoint_present():
    with _client() as c:
        r = c.get("/v1/prompts")
    assert r.status_code in (200, 500)


def test_v1_runtime_actors_endpoint_present():
    with _client() as c:
        r = c.get("/v1/runtime/actors")
    assert r.status_code in (200, 500)
