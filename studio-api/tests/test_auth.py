"""Tests for authentication, JWT, API tokens, user/role CRUD, and RBAC."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from studio_api.cantica_client import CanticaConnector
from studio_api.config import Settings
from studio_api.main import create_app
from studio_api.runtime import ActorRuntime
from studio_api.workspace_fs import WorkspaceFS

# ── Fixtures ──────────────────────────────────────────────────────────────────

_ADMIN_EMAIL = "admin@test.local"
_ADMIN_PASS = "Test1234!"
_JWT_SECRET = "test-super-secret-key-xxxxxxxxxxxxxxxxxxx"


@pytest.fixture
def auth_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    """TestClient with local_mode=False and a seeded admin user."""
    ws = tmp_path / "ws"
    ws.mkdir(parents=True)

    import studio_api.config as cfg_mod  # noqa: PLC0415
    import studio_api.mcp_server as mcp_mod  # noqa: PLC0415

    test_settings = Settings(
        workspace=ws,
        local_mode=False,
        jwt_secret=_JWT_SECRET,
        jwt_expire_minutes=60,
        admin_email=_ADMIN_EMAIL,
        admin_password=_ADMIN_PASS,
    )
    monkeypatch.setattr(cfg_mod, "_settings", test_settings)

    rt = MagicMock(spec=ActorRuntime)
    rt.list_running.return_value = []
    conn = MagicMock(spec=CanticaConnector)
    conn.list_prompts = AsyncMock(return_value=[])

    app = create_app()
    with TestClient(app, raise_server_exceptions=True) as c:
        app.state.runtime = rt
        app.state.connector = conn
        mcp_mod.init(WorkspaceFS(ws), rt)
        yield c


def _login(client: TestClient, email: str = _ADMIN_EMAIL, password: str = _ADMIN_PASS) -> str:
    r = client.post("/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Local mode ────────────────────────────────────────────────────────────────


def test_login_blocked_in_local_mode(client: TestClient) -> None:
    r = client.post("/v1/auth/login", json={"email": "x@x.com", "password": "y"})
    assert r.status_code == 400


def test_local_mode_actors_no_auth_required(client: TestClient) -> None:
    r = client.get("/v1/runtime/actors")
    assert r.status_code == 200


def test_local_mode_graph_no_auth_required(client: TestClient) -> None:
    r = client.get("/v1/graph")
    assert r.status_code == 200


# ── Login ─────────────────────────────────────────────────────────────────────


def test_login_valid_credentials(auth_client: TestClient) -> None:
    r = auth_client.post("/v1/auth/login", json={"email": _ADMIN_EMAIL, "password": _ADMIN_PASS})
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == 3600


def test_login_wrong_password(auth_client: TestClient) -> None:
    r = auth_client.post("/v1/auth/login", json={"email": _ADMIN_EMAIL, "password": "wrong"})
    assert r.status_code == 401


def test_login_unknown_email(auth_client: TestClient) -> None:
    r = auth_client.post("/v1/auth/login", json={"email": "ghost@x.com", "password": _ADMIN_PASS})
    assert r.status_code == 401


# ── JWT auth ──────────────────────────────────────────────────────────────────


def test_protected_endpoint_requires_auth(auth_client: TestClient) -> None:
    r = auth_client.get("/v1/runtime/actors")
    assert r.status_code == 401


def test_protected_endpoint_with_valid_jwt(auth_client: TestClient) -> None:
    token = _login(auth_client)
    r = auth_client.get("/v1/runtime/actors", headers=_auth(token))
    assert r.status_code == 200


def test_invalid_jwt_rejected(auth_client: TestClient) -> None:
    r = auth_client.get("/v1/runtime/actors", headers=_auth("not.a.real.token"))
    assert r.status_code == 401


# ── API tokens ────────────────────────────────────────────────────────────────


def test_create_and_list_api_token(auth_client: TestClient) -> None:
    h = _auth(_login(auth_client))
    r = auth_client.post("/v1/auth/tokens", json={"name": "ci-token", "scopes": ["*"]}, headers=h)
    assert r.status_code == 201
    data = r.json()
    assert "token" in data
    assert data["name"] == "ci-token"

    listed = auth_client.get("/v1/auth/tokens", headers=h).json()
    assert any(t["id"] == data["id"] for t in listed)


def test_api_token_authenticates_requests(auth_client: TestClient) -> None:
    h = _auth(_login(auth_client))
    raw = auth_client.post("/v1/auth/tokens", json={"name": "t", "scopes": ["*"]}, headers=h).json()["token"]
    r = auth_client.get("/v1/runtime/actors", headers=_auth(raw))
    assert r.status_code == 200


def test_revoke_api_token(auth_client: TestClient) -> None:
    h = _auth(_login(auth_client))
    resp = auth_client.post("/v1/auth/tokens", json={"name": "tmp", "scopes": ["*"]}, headers=h).json()
    raw, tid = resp["token"], resp["id"]

    # Token works before revocation
    assert auth_client.get("/v1/runtime/actors", headers=_auth(raw)).status_code == 200

    # Revoke
    assert auth_client.delete(f"/v1/auth/tokens/{tid}", headers=h).status_code == 204

    # Token no longer accepted
    assert auth_client.get("/v1/runtime/actors", headers=_auth(raw)).status_code == 401


# ── User CRUD (local mode via conftest `client`) ──────────────────────────────


def test_list_users_empty(client: TestClient) -> None:
    r = client.get("/v1/users")
    assert r.status_code == 200
    assert r.json() == []


def test_create_and_retrieve_user(client: TestClient) -> None:
    r = client.post("/v1/users", json={"email": "alice@example.com", "password": "pw1"})
    assert r.status_code == 201
    u = r.json()
    assert u["email"] == "alice@example.com"
    assert u["roles"] == []

    r2 = client.get(f"/v1/users/{u['id']}")
    assert r2.status_code == 200
    assert r2.json()["email"] == "alice@example.com"


def test_duplicate_email_rejected(client: TestClient) -> None:
    client.post("/v1/users", json={"email": "dup@example.com", "password": "a"})
    r = client.post("/v1/users", json={"email": "dup@example.com", "password": "b"})
    assert r.status_code == 409


def test_update_user(client: TestClient) -> None:
    u = client.post("/v1/users", json={"email": "bob@example.com", "password": "pw"}).json()
    r = client.put(f"/v1/users/{u['id']}", json={"first_name": "Bob"})
    assert r.status_code == 200
    assert r.json()["first_name"] == "Bob"


def test_delete_user(client: TestClient) -> None:
    u = client.post("/v1/users", json={"email": "del@example.com", "password": "pw"}).json()
    assert client.delete(f"/v1/users/{u['id']}").status_code == 204
    assert client.get(f"/v1/users/{u['id']}").status_code == 404


def test_assign_and_remove_role(client: TestClient) -> None:
    u = client.post("/v1/users", json={"email": "carol@example.com", "password": "pw"}).json()
    r = client.post(f"/v1/users/{u['id']}/roles/viewer")
    assert r.status_code == 200
    assert "viewer" in r.json()["roles"]

    r = client.delete(f"/v1/users/{u['id']}/roles/viewer")
    assert r.status_code == 200
    assert "viewer" not in r.json()["roles"]


def test_assign_nonexistent_role(client: TestClient) -> None:
    u = client.post("/v1/users", json={"email": "dave@example.com", "password": "pw"}).json()
    r = client.post(f"/v1/users/{u['id']}/roles/superadmin")
    assert r.status_code == 404


# ── Role listing ──────────────────────────────────────────────────────────────


def test_list_roles_returns_builtins(client: TestClient) -> None:
    r = client.get("/v1/roles")
    assert r.status_code == 200
    names = {role["name"] for role in r.json()}
    assert names == {"admin", "operator", "viewer"}


def test_role_has_permissions(client: TestClient) -> None:
    roles = client.get("/v1/roles").json()
    admin = next(r for r in roles if r["name"] == "admin")
    assert "runtime:start" in admin["permissions"]
    assert "users:write" in admin["permissions"]
