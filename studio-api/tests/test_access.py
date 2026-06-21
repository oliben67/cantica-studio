"""Tests for access records and auth enforcement."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from studio_api.access import AccessRecord, AccessStore, LOCAL_ACCESS_ID, ProviderCredentials
from studio_api.config import Settings
from studio_api.main import create_app


# ── AccessStore unit tests ────────────────────────────────────────────────────

def test_local_mode_creates_single_record(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    store = AccessStore(local_mode=True)
    records = store.list()
    assert len(records) == 1
    assert records[0].id == LOCAL_ACCESS_ID
    assert records[0].readonly is True
    assert records[0].credentials.anthropic_api_key == "sk-ant-test"


def test_local_record_presence_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    store = AccessStore(local_mode=True)
    presence = store.get(LOCAL_ACCESS_ID).credentials.presence()
    assert presence["anthropic_api_key"] is True
    assert presence["openai_api_key"] is False


def test_local_mode_blocks_put() -> None:
    store = AccessStore(local_mode=True)
    with pytest.raises(ValueError, match="read-only in local mode"):
        store.put(AccessRecord(id="x", name="X"))


def test_local_mode_blocks_delete() -> None:
    store = AccessStore(local_mode=True)
    with pytest.raises(ValueError, match="read-only in local mode"):
        store.delete(LOCAL_ACCESS_ID)


def test_non_local_mode_empty_by_default() -> None:
    store = AccessStore(local_mode=False)
    assert store.list() == []


def test_non_local_put_and_get() -> None:
    store = AccessStore(local_mode=False)
    r = AccessRecord(
        id="team-a",
        name="Team A",
        credentials=ProviderCredentials(anthropic_api_key="sk-ant-xxx"),
    )
    store.put(r)
    fetched = store.get("team-a")
    assert fetched is not None
    assert fetched.name == "Team A"
    assert fetched.credentials.anthropic_api_key == "sk-ant-xxx"


def test_non_local_delete() -> None:
    store = AccessStore(local_mode=False)
    store.put(AccessRecord(id="tmp", name="Tmp"))
    store.delete("tmp")
    assert store.get("tmp") is None


def test_delete_missing_raises() -> None:
    store = AccessStore(local_mode=False)
    with pytest.raises(KeyError):
        store.delete("nonexistent")


def test_to_response_does_not_expose_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret")
    store = AccessStore(local_mode=True)
    resp = store.get(LOCAL_ACCESS_ID).to_response()
    assert resp["credentials"]["anthropic_api_key"] is True
    assert "sk-ant-secret" not in str(resp)


# ── API endpoint tests ────────────────────────────────────────────────────────

@pytest.fixture
def local_client(
    tmp_workspace,
    mock_runtime,
    mock_connector,
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    import studio_api.config as cfg_mod
    import studio_api.mcp_server as mcp_mod
    from studio_api.workspace_fs import WorkspaceFS

    tmp_workspace.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-local")
    test_settings = Settings(workspace=tmp_workspace)
    monkeypatch.setattr(cfg_mod, "_settings", test_settings)

    app = create_app()
    with TestClient(app, raise_server_exceptions=True) as c:
        app.state.runtime = mock_runtime
        app.state.connector = mock_connector
        mcp_mod.init(WorkspaceFS(tmp_workspace), mock_runtime)
        yield c


_REMOTE_ADMIN_EMAIL = "admin@access-test.local"
_REMOTE_ADMIN_PASS = "RemoteTest1234!"
_REMOTE_JWT_SECRET = "remote-test-secret-key-xxxxxxxxxxxxxxxxxxx"


@pytest.fixture
def remote_client(
    tmp_workspace,
    mock_runtime,
    mock_connector,
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    import studio_api.config as cfg_mod
    import studio_api.mcp_server as mcp_mod
    from studio_api.workspace_fs import WorkspaceFS

    tmp_workspace.mkdir(parents=True, exist_ok=True)
    test_settings = Settings(
        workspace=tmp_workspace,
        local_mode=False,
        jwt_secret=_REMOTE_JWT_SECRET,
        jwt_expire_minutes=60,
        admin_email=_REMOTE_ADMIN_EMAIL,
        admin_password=_REMOTE_ADMIN_PASS,
    )
    monkeypatch.setattr(cfg_mod, "_settings", test_settings)

    app = create_app()
    with TestClient(app, raise_server_exceptions=True) as c:
        app.state.runtime = mock_runtime
        app.state.connector = mock_connector
        mcp_mod.init(WorkspaceFS(tmp_workspace), mock_runtime)
        yield c


def _admin_jwt(client: TestClient) -> str:
    r = client.post("/v1/auth/login", json={"email": _REMOTE_ADMIN_EMAIL, "password": _REMOTE_ADMIN_PASS})
    assert r.status_code == 200
    return r.json()["access_token"]


class TestAccessEndpointsLocalMode:
    def test_list_returns_local_record(self, local_client: TestClient) -> None:
        r = local_client.get("/v1/access")
        assert r.status_code == 200
        records = r.json()
        assert len(records) == 1
        assert records[0]["id"] == LOCAL_ACCESS_ID
        assert records[0]["readonly"] is True

    def test_get_local_record(self, local_client: TestClient) -> None:
        r = local_client.get(f"/v1/access/{LOCAL_ACCESS_ID}")
        assert r.status_code == 200
        assert r.json()["id"] == LOCAL_ACCESS_ID

    def test_get_missing_record_404(self, local_client: TestClient) -> None:
        r = local_client.get("/v1/access/nonexistent")
        assert r.status_code == 404

    def test_put_forbidden_in_local_mode(self, local_client: TestClient) -> None:
        r = local_client.put("/v1/access/new", json={"name": "New"})
        assert r.status_code == 403

    def test_delete_forbidden_in_local_mode(self, local_client: TestClient) -> None:
        r = local_client.delete(f"/v1/access/{LOCAL_ACCESS_ID}")
        assert r.status_code == 403

    def test_no_auth_header_needed(self, local_client: TestClient) -> None:
        r = local_client.get("/v1/runtime/actors")
        assert r.status_code == 200


class TestAuthEnforcement:
    def test_no_token_rejected(self, remote_client: TestClient) -> None:
        r = remote_client.get("/v1/access")
        assert r.status_code == 401

    def test_wrong_token_rejected(self, remote_client: TestClient) -> None:
        r = remote_client.get("/v1/access", headers={"Authorization": "Bearer not.a.valid.jwt"})
        assert r.status_code == 401

    def test_correct_token_accepted(self, remote_client: TestClient) -> None:
        token = _admin_jwt(remote_client)
        r = remote_client.get("/v1/access", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200

    def test_health_exempt_from_auth(self, remote_client: TestClient) -> None:
        r = remote_client.get("/health")
        assert r.status_code == 200
        assert r.json()["auth_enabled"] is True

    def test_put_and_delete_in_remote_mode(self, remote_client: TestClient) -> None:
        headers = {"Authorization": f"Bearer {_admin_jwt(remote_client)}"}
        r = remote_client.put(
            "/v1/access/team-a",
            json={"name": "Team A", "credentials": {"anthropic_api_key": "sk-ant-xxx"}},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["id"] == "team-a"
        assert r.json()["credentials"]["anthropic_api_key"] is True

        r = remote_client.delete("/v1/access/team-a", headers=headers)
        assert r.status_code == 204
