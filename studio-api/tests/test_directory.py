"""Tests for enterprise directory provisioning (roadmap phase 5).

Covers the directory_group_roles mapping CRUD, provisioning behaviour
(e_user_id, role mapping, newbie fallback), the OIDC login endpoint (JWKS
seam mocked), and the LDAP backend (ldap3 faked).
"""

from __future__ import annotations

import sys
import time
import types
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from studio_api.auth.backends import AuthResult
from studio_api.auth.oidc_backend import OidcBackend
from studio_api.auth.provision import provision_directory_user
from studio_api.cantica_client import CanticaConnector
from studio_api.config import Settings
from studio_api.main import create_app
from studio_api.runtime import ActorRuntime
from studio_api.workspace_fs import WorkspaceFS

_ADMIN_EMAIL = "admin@dir.local"
_ADMIN_PASS = "DirTest1234!"
_JWT_SECRET = "dir-test-secret-key-xxxxxxxxxxxxxxxxxxxxx"
_OIDC_ISSUER = "https://idp.example.com"
_OIDC_CLIENT_ID = "studio-client"


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


_IDP_PRIVATE, _IDP_PUBLIC = _keypair()


def _id_token(**overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": _OIDC_ISSUER,
        "aud": _OIDC_CLIENT_ID,
        "sub": "corp-uid-42",
        "email": "jdoe@corp.example.com",
        "given_name": "Jane",
        "family_name": "Doe",
        "groups": ["studio-operators"],
        "iat": now,
        "exp": now + 300,
        "jti": str(uuid.uuid4()),
        **overrides,
    }
    return pyjwt.encode(claims, _IDP_PRIVATE, algorithm="RS256")


@pytest.fixture
def remote_oidc(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Remote-mode client with the OIDC backend configured and JWKS mocked."""
    import studio_api.config as cfg_mod
    import studio_api.mcp_server as mcp_mod
    from studio_api.api.v1.auth import _reset_rate_limiter

    ws = tmp_path / "ws"
    ws.mkdir(parents=True)
    test_settings = Settings(
        workspace=ws,
        local_mode=False,
        jwt_secret=_JWT_SECRET,
        admin_email=_ADMIN_EMAIL,
        admin_password=_ADMIN_PASS,
        auth_backend="oidc",
        oidc_issuer=_OIDC_ISSUER,
        oidc_client_id=_OIDC_CLIENT_ID,
    )
    monkeypatch.setattr(cfg_mod, "_settings", test_settings)
    _reset_rate_limiter()
    # JWKS seam: hand the IdP public key straight to the backend.
    monkeypatch.setattr(OidcBackend, "_signing_key_for", lambda self, token: _IDP_PUBLIC)

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


def _admin(client: TestClient) -> dict:
    # The local password backend is not active under auth_backend=oidc, so the
    # admin authenticates via an API-style JWT minted directly for tests.
    from studio_api.auth.jwt import create_access_token
    from studio_api.orm.db import new_session
    from studio_api.orm.models import User
    from sqlalchemy import select

    with new_session(client.app.state.db_engine) as s:
        admin = s.scalar(select(User).where(User.email == _ADMIN_EMAIL))
        assert admin is not None
    token = create_access_token(
        user_id=admin.id, roles=["admin"], permissions=["*"],
        secret=_JWT_SECRET, expire_minutes=5,
    )
    return {"Authorization": f"Bearer {token}"}


# ── Mapping CRUD ──────────────────────────────────────────────────────────────


def test_mapping_crud_round_trip(remote_oidc: TestClient) -> None:
    h = _admin(remote_oidc)
    r = remote_oidc.post(
        "/v1/directory/mappings",
        json={"external_group": "studio-operators", "role_name": "operator"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    assert r.json()["role"] == "operator"

    listed = remote_oidc.get("/v1/directory/mappings", headers=h).json()
    assert any(m["id"] == mid for m in listed)

    assert remote_oidc.delete(f"/v1/directory/mappings/{mid}", headers=h).status_code == 204
    assert remote_oidc.get("/v1/directory/mappings", headers=h).json() == []


def test_mapping_unknown_role_404(remote_oidc: TestClient) -> None:
    h = _admin(remote_oidc)
    r = remote_oidc.post(
        "/v1/directory/mappings",
        json={"external_group": "g", "role_name": "nope"},
        headers=h,
    )
    assert r.status_code == 404


def test_mapping_duplicate_409(remote_oidc: TestClient) -> None:
    h = _admin(remote_oidc)
    body = {"external_group": "dup-group", "role_name": "viewer"}
    assert remote_oidc.post("/v1/directory/mappings", json=body, headers=h).status_code == 201
    assert remote_oidc.post("/v1/directory/mappings", json=body, headers=h).status_code == 409


# ── OIDC login + provisioning ─────────────────────────────────────────────────


def test_oidc_login_provisions_user_with_mapped_role(remote_oidc: TestClient) -> None:
    h = _admin(remote_oidc)
    remote_oidc.post(
        "/v1/directory/mappings",
        json={"external_group": "studio-operators", "role_name": "operator"},
        headers=h,
    )

    r = remote_oidc.post("/v1/auth/oidc", json={"id_token": _id_token()})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]

    # Token carries operator permissions → can read the runtime.
    assert remote_oidc.get(
        "/v1/runtime/actors", headers={"Authorization": f"Bearer {tok}"}
    ).status_code == 200

    users = remote_oidc.get("/v1/users", headers=h).json()
    jane = next(u for u in users if u["email"] == "jdoe@corp.example.com")
    assert jane["e_user_id"] == "corp-uid-42"
    assert jane["first_name"] == "Jane"
    assert jane["roles"] == ["operator"]
    assert jane["is_active"] is True
    assert all(f["flag"] != "newbie" for f in jane["flags"])


def test_oidc_unmapped_groups_fall_back_to_limbo_newbie(remote_oidc: TestClient) -> None:
    r = remote_oidc.post(
        "/v1/auth/oidc", json={"id_token": _id_token(groups=["unmapped-group"])}
    )
    # Provisioned with limbo (default) + newbie; gate allows (active, no block).
    assert r.status_code == 200

    h = _admin(remote_oidc)
    users = remote_oidc.get("/v1/users", headers=h).json()
    jane = next(u for u in users if u["email"] == "jdoe@corp.example.com")
    assert jane["roles"] == ["limbo"]
    assert any(f["flag"] == "newbie" for f in jane["flags"])

    # limbo = zero permissions → protected resources stay closed.
    tok = r.json()["access_token"]
    assert remote_oidc.get(
        "/v1/runtime/actors", headers={"Authorization": f"Bearer {tok}"}
    ).status_code == 403


def test_oidc_group_revocation_revokes_role_on_next_login(remote_oidc: TestClient) -> None:
    h = _admin(remote_oidc)
    remote_oidc.post(
        "/v1/directory/mappings",
        json={"external_group": "studio-operators", "role_name": "operator"},
        headers=h,
    )
    remote_oidc.post(
        "/v1/directory/mappings",
        json={"external_group": "studio-viewers", "role_name": "viewer"},
        headers=h,
    )
    assert remote_oidc.post("/v1/auth/oidc", json={"id_token": _id_token()}).status_code == 200

    # Next login: the user lost studio-operators, gained studio-viewers.
    remote_oidc.post("/v1/auth/oidc", json={"id_token": _id_token(groups=["studio-viewers"])})
    users = remote_oidc.get("/v1/users", headers=h).json()
    jane = next(u for u in users if u["email"] == "jdoe@corp.example.com")
    assert jane["roles"] == ["viewer"]


def test_oidc_rejects_wrong_audience(remote_oidc: TestClient) -> None:
    r = remote_oidc.post("/v1/auth/oidc", json={"id_token": _id_token(aud="other-app")})
    assert r.status_code == 401


def test_oidc_rejects_expired_token(remote_oidc: TestClient) -> None:
    now = int(time.time())
    r = remote_oidc.post(
        "/v1/auth/oidc", json={"id_token": _id_token(iat=now - 900, exp=now - 600)}
    )
    assert r.status_code == 401


def test_oidc_blocked_user_denied_generically(remote_oidc: TestClient) -> None:
    assert remote_oidc.post("/v1/auth/oidc", json={"id_token": _id_token()}).status_code == 200
    h = _admin(remote_oidc)
    users = remote_oidc.get("/v1/users", headers=h).json()
    jane = next(u for u in users if u["email"] == "jdoe@corp.example.com")
    remote_oidc.post(f"/v1/users/{jane['id']}/flags", json={"flag": "blocked:abuse"}, headers=h)

    r = remote_oidc.post("/v1/auth/oidc", json={"id_token": _id_token()})
    assert r.status_code == 401
    assert "blocked" not in r.text.lower()


# ── Provisioning unit behaviour ───────────────────────────────────────────────


def test_provision_adopts_existing_email_account(remote_oidc: TestClient) -> None:
    """An account created earlier by email is adopted: e_user_id gets set."""
    from studio_api.orm.db import new_session
    from studio_api.orm.models import User
    from sqlalchemy import select

    engine = remote_oidc.app.state.db_engine
    with new_session(engine) as s:
        s.add(User(email="adopt@corp.example.com", password_hash="", is_active=True))
        s.commit()

    with new_session(engine) as s:
        user = provision_directory_user(s, AuthResult(
            user_id="", email="adopt@corp.example.com",
            e_user_id="corp-uid-77", first_name="Ada",
        ))
        assert user.e_user_id == "corp-uid-77"
        assert user.first_name == "Ada"

    with new_session(engine) as s:
        assert s.scalar(select(User).where(User.e_user_id == "corp-uid-77")) is not None


# ── LDAP backend (ldap3 faked) ────────────────────────────────────────────────


class _FakeEntry:
    entry_dn = "cn=jdoe,ou=users,dc=corp,dc=example"
    entry_attributes_as_dict = {
        "givenName": ["Jane"],
        "sn": ["Doe"],
        "mail": ["jdoe@corp.example.com"],
        "objectGUID": ["guid-1234"],
        "memberOf": ["cn=studio-operators,dc=corp,dc=example"],
    }


def _fake_ldap3(bind_results: dict[str, bool]) -> types.ModuleType:
    """A minimal ldap3 stand-in: Connection succeeds per the bind_results map."""
    mod = types.ModuleType("ldap3")

    class Server:  # noqa: D401
        def __init__(self, *a, **k) -> None: ...

    class Connection:
        def __init__(self, _server, user=None, password=None, auto_bind=False) -> None:
            key = user or "<anonymous>"
            if auto_bind and not bind_results.get(key, False):
                raise RuntimeError(f"bind failed for {key}")
            self.entries: list[_FakeEntry] = []

        def search(self, *_a, **_k) -> None:
            self.entries = [_FakeEntry()]

        def unbind(self) -> None: ...

    mod.Server = Server
    mod.Connection = Connection
    return mod


def test_ldap_backend_authenticates_and_extracts_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    from studio_api.auth.ldap_backend import LdapBackend

    monkeypatch.setitem(sys.modules, "ldap3", _fake_ldap3({
        "<anonymous>": True,
        "cn=jdoe,ou=users,dc=corp,dc=example": True,
    }))
    backend = LdapBackend(host="ldap.corp", port=389, base_dn="dc=corp", group_attr="memberOf", group_map={})
    result = backend.authenticate("jdoe@corp.example.com", "hunter2")
    assert result is not None
    assert result.email == "jdoe@corp.example.com"
    assert result.e_user_id == "guid-1234"
    assert result.first_name == "Jane"
    assert result.directory_groups == ["cn=studio-operators,dc=corp,dc=example"]


def test_ldap_backend_rejects_bad_password(monkeypatch: pytest.MonkeyPatch) -> None:
    from studio_api.auth.ldap_backend import LdapBackend

    monkeypatch.setitem(sys.modules, "ldap3", _fake_ldap3({
        "<anonymous>": True,
        # user bind fails
    }))
    backend = LdapBackend(host="ldap.corp", port=389, base_dn="dc=corp", group_attr="memberOf", group_map={})
    assert backend.authenticate("jdoe@corp.example.com", "wrong") is None


def test_ldap_backend_rejects_empty_password(monkeypatch: pytest.MonkeyPatch) -> None:
    from studio_api.auth.ldap_backend import LdapBackend

    monkeypatch.setitem(sys.modules, "ldap3", _fake_ldap3({"<anonymous>": True}))
    backend = LdapBackend(host="ldap.corp", port=389, base_dn="dc=corp", group_attr="memberOf", group_map={})
    assert backend.authenticate("jdoe@corp.example.com", "") is None
