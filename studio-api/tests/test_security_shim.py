"""Phase C — studio-api mounted on the cantica-secure shim (STUDIO_SECURITY_SHIM=1).

Proves the flag-on configuration serves the security surface via the package
and that studio's domain endpoints still authorize correctly through the
delegated principal. The in-repo security suite (test_auth.py, test_access.py,
test_remote_auth.py, test_directory.py) continues to run in the default,
flag-off configuration.
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from studio_api.cantica_client import CanticaConnector
from studio_api.config import Settings
from studio_api.main import create_app
from studio_api.runtime import ActorRuntime
from studio_api.workspace_fs import WorkspaceFS

_ADMIN_EMAIL = "admin@shim.local"
_ADMIN_PASS = "ShimTest1234!"
_JWT_SECRET = "studio-shim-test-secret-xxxxxxxxxxxxxxxxx"


def _keypair() -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return (
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode(),
        key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode(),
    )


def _assertion(private_pem: str, subject: str, *, extra: dict | None = None) -> str:
    now = int(time.time())
    payload = {"iss": subject, "sub": subject, "aud": "cantica-secure",
               "iat": now, "exp": now + 300, "jti": str(uuid.uuid4()), **(extra or {})}
    return pyjwt.encode(payload, private_pem, algorithm="RS256")


def _client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, local_mode: bool) -> TestClient:
    import studio_api.config as cfg_mod
    import studio_api.mcp_server as mcp_mod

    ws = tmp_path / "ws"
    ws.mkdir(parents=True, exist_ok=True)
    settings = Settings(
        workspace=ws,
        local_mode=local_mode,
        security_shim=True,
        jwt_secret=_JWT_SECRET,
        admin_email=_ADMIN_EMAIL,
        admin_password=_ADMIN_PASS,
    )
    monkeypatch.setattr(cfg_mod, "_settings", settings)

    rt = MagicMock(spec=ActorRuntime)
    rt.list_running.return_value = []
    conn = MagicMock(spec=CanticaConnector)
    conn.list_prompts = AsyncMock(return_value=[])

    app = create_app()
    client = TestClient(app, raise_server_exceptions=True)
    client.__enter__()
    app.state.runtime = rt
    app.state.connector = conn
    mcp_mod.init(WorkspaceFS(ws), rt)
    return client


@pytest.fixture
def shim_remote(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    client = _client(tmp_path, monkeypatch, local_mode=False)
    yield client
    client.__exit__(None, None, None)


@pytest.fixture
def shim_local(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    client = _client(tmp_path, monkeypatch, local_mode=True)
    yield client
    client.__exit__(None, None, None)


def _admin(client: TestClient) -> dict:
    r = client.post("/v1/auth/login", json={"email": _ADMIN_EMAIL, "password": _ADMIN_PASS})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ── The shim serves the security surface ──────────────────────────────────────


def test_shim_security_routes_served(shim_remote: TestClient) -> None:
    h = _admin(shim_remote)
    roles = {r["name"] for r in shim_remote.get("/v1/roles", headers=h).json()}
    assert roles == {"admin", "operator", "viewer", "limbo"}
    # ui-config is a package-only endpoint — proves it is the shim answering.
    assert shim_remote.get("/v1/security/ui-config").json()["app_name"] == "Cantica Studio"


def test_domain_endpoint_authorizes_through_shim(shim_remote: TestClient) -> None:
    h = _admin(shim_remote)
    # Create an operator and confirm studio's runtime endpoint honours the
    # permission resolved by the delegated principal.
    u = shim_remote.post("/v1/users", json={"email": "op@x.com", "password": "Pw123456!"}, headers=h).json()
    shim_remote.post(f"/v1/users/{u['id']}/roles/operator", headers=h)
    op = {"Authorization": f"Bearer {shim_remote.post('/v1/auth/login', json={'email': 'op@x.com', 'password': 'Pw123456!'}).json()['access_token']}"}

    assert shim_remote.get("/v1/runtime/actors", headers=op).status_code == 200
    # viewer lacks runtime:read on nothing? operator has runtime:read → 200 above.
    # Unauthenticated request to a domain endpoint is rejected.
    assert shim_remote.get("/v1/runtime/actors").status_code == 401


def test_blocked_flag_blocks_domain_access_through_shim(shim_remote: TestClient) -> None:
    h = _admin(shim_remote)
    u = shim_remote.post("/v1/users", json={"email": "blk@x.com", "password": "Pw123456!"}, headers=h).json()
    shim_remote.post(f"/v1/users/{u['id']}/roles/operator", headers=h)
    tok = shim_remote.post("/v1/auth/login", json={"email": "blk@x.com", "password": "Pw123456!"}).json()["access_token"]
    bh = {"Authorization": f"Bearer {tok}"}
    assert shim_remote.get("/v1/runtime/actors", headers=bh).status_code == 200

    shim_remote.post(f"/v1/users/{u['id']}/flags", json={"flag": "blocked:abuse"}, headers=h)
    r = shim_remote.get("/v1/runtime/actors", headers=bh)
    assert r.status_code == 401
    assert "blocked" not in r.text.lower()


def test_key_enrolment_and_assert_through_shim(shim_remote: TestClient) -> None:
    invitation = shim_remote.post(
        "/v1/auth/invitations",
        json={"first_name": "K", "last_name": "E", "email": "keyed@x.com"},
    ).json()["invitation"]
    priv, pub = _keypair()
    r = shim_remote.post("/v1/auth/register",
                         json={"assertion": _assertion(priv, "keyed", extra={"invitation": invitation}),
                               "public_key_pem": pub})
    assert r.status_code == 200
    cuid = r.json()["cantica_user_id"]

    # activate (newbie) then assert
    h = _admin(shim_remote)
    uid = next(u["id"] for u in shim_remote.get("/v1/users", headers=h).json() if u["email"] == "keyed@x.com")
    shim_remote.post(f"/v1/users/{uid}/roles/viewer", headers=h)
    shim_remote.post(f"/v1/users/{uid}/activate", headers=h)

    ar = shim_remote.post("/v1/auth/assert", json={"assertion": _assertion(priv, cuid)})
    assert ar.status_code == 200
    tok = ar.json()["access_token"]
    assert shim_remote.get("/v1/runtime/actors", headers={"Authorization": f"Bearer {tok}"}).status_code == 200


def test_directory_mappings_served_by_shim(shim_remote: TestClient) -> None:
    h = _admin(shim_remote)
    r = shim_remote.post("/v1/directory/mappings",
                         json={"external_group": "cn=ops,dc=corp", "role_name": "operator"}, headers=h)
    assert r.status_code == 201
    assert any(m["role"] == "operator" for m in shim_remote.get("/v1/directory/mappings", headers=h).json())


# ── Local mode through the shim ───────────────────────────────────────────────


def test_local_mode_needs_no_auth_and_carries_real_user_id(shim_local: TestClient) -> None:
    # Domain endpoints open in local mode…
    assert shim_local.get("/v1/runtime/actors").status_code == 200
    # …and the principal carries the seeded local DB user id (Provider links).
    me = shim_local.get("/v1/auth/me").json()
    assert me["user_id"] not in ("local", "")
    assert me["email"] == "local@studio.local" or me["email"]  # local principal email
