"""Tests for remote-mode registration & key-based authentication (roadmap phases 0–4).

Covers: schema migration, the limbo role, the flag-aware auth gate (spec AUTH F),
flags/activation APIs, invitations (spec REGISTRATION C), key enrolment
(spec 3–8), and key-assertion authentication (spec AUTH A–E).
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

from studio_api.cantica_client import CanticaConnector
from studio_api.config import Settings
from studio_api.main import create_app
from studio_api.orm.migrate import migrate
from studio_api.runtime import ActorRuntime
from studio_api.workspace_fs import WorkspaceFS

_ADMIN_EMAIL = "admin@remote.local"
_ADMIN_PASS = "RemoteTest1234!"
_JWT_SECRET = "remote-auth-test-secret-xxxxxxxxxxxxxxxxx"


# ── Key helpers (mirror clients/shared/auth-core.ts) ──────────────────────────


def _keypair() -> tuple[str, str]:
    """Return (private_pem, public_pem) — RSA 2048, like the TS client."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_pem, public_pem


def _assertion(private_pem: str, subject: str, *, extra: dict | None = None,
               iat_offset: int = 0, jti: str | None = None) -> str:
    now = int(time.time()) + iat_offset
    payload = {
        "iss": subject, "sub": subject, "aud": "studio-api",
        "iat": now, "exp": now + 300, "jti": jti or str(uuid.uuid4()),
        **(extra or {}),
    }
    return pyjwt.encode(payload, private_pem, algorithm="RS256")


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def remote(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """TestClient in remote mode (local_mode=False) with a seeded admin."""
    import studio_api.config as cfg_mod
    import studio_api.mcp_server as mcp_mod
    from studio_api.api.v1.auth import _reset_rate_limiter

    ws = tmp_path / "ws"
    ws.mkdir(parents=True)
    test_settings = Settings(
        workspace=ws,
        local_mode=False,
        jwt_secret=_JWT_SECRET,
        jwt_expire_minutes=60,
        admin_email=_ADMIN_EMAIL,
        admin_password=_ADMIN_PASS,
    )
    monkeypatch.setattr(cfg_mod, "_settings", test_settings)
    _reset_rate_limiter()

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
    r = client.post("/v1/auth/login", json={"email": _ADMIN_EMAIL, "password": _ADMIN_PASS})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _invite(client: TestClient, email: str) -> str:
    r = client.post("/v1/auth/invitations", json={"first_name": "T", "last_name": "U", "email": email})
    assert r.status_code == 200, r.text
    token = r.json()["invitation"]
    assert token
    return token


def _enrol(client: TestClient, email: str) -> tuple[str, str]:
    """Invite + enrol a user; returns (private_pem, cantica_user_id)."""
    invitation = _invite(client, email)
    private_pem, public_pem = _keypair()
    assertion = _assertion(private_pem, "enrolee", extra={"invitation": invitation})
    r = client.post("/v1/auth/register", json={"assertion": assertion, "public_key_pem": public_pem})
    assert r.status_code == 200, r.text
    return private_pem, r.json()["cantica_user_id"]


# ── Phase 0: schema & seeds ───────────────────────────────────────────────────


def test_migrate_adds_e_user_id_to_legacy_db(tmp_path: Path) -> None:
    """A pre-existing users table without e_user_id gains the column."""
    db = tmp_path / "legacy.db"
    engine = create_engine(f"sqlite:///{db}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, email VARCHAR(255))"))
    migrate(engine)
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    assert "e_user_id" in cols
    migrate(engine)  # idempotent


def test_limbo_role_seeded_with_zero_permissions(remote: TestClient) -> None:
    roles = remote.get("/v1/roles", headers=_admin(remote)).json()
    limbo = next(r for r in roles if r["name"] == "limbo")
    assert limbo["permissions"] == []


# ── Phase 1: flag gate (spec AUTH F) ──────────────────────────────────────────


def _make_user(client: TestClient, h: dict, email: str, *, active: bool = True) -> str:
    u = client.post("/v1/users", json={"email": email, "password": "Pw123456!"}, headers=h).json()
    client.post(f"/v1/users/{u['id']}/roles/viewer", headers=h)
    if not active:
        client.put(f"/v1/users/{u['id']}", json={"is_active": False}, headers=h)
    return u["id"]


def _user_token(client: TestClient, email: str) -> str:
    r = client.post("/v1/auth/login", json={"email": email, "password": "Pw123456!"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_active_unflagged_user_authenticates(remote: TestClient) -> None:
    h = _admin(remote)
    _make_user(remote, h, "clean@x.com")
    tok = _user_token(remote, "clean@x.com")
    r = remote.get("/v1/runtime/actors", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert "X-Cantica-Warning" not in r.headers


def test_warning_flag_authenticates_with_header(remote: TestClient) -> None:
    h = _admin(remote)
    uid = _make_user(remote, h, "warned@x.com")
    remote.post(f"/v1/users/{uid}/flags", json={"flag": "warning:abuse", "comment": "spam"}, headers=h)
    tok = _user_token(remote, "warned@x.com")
    r = remote.get("/v1/runtime/actors", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert "warning:abuse" in r.headers["X-Cantica-Warning"]


def test_blocked_flag_invalidates_live_token(remote: TestClient) -> None:
    """A blocked:* flag takes effect on the NEXT request, not the next login."""
    h = _admin(remote)
    uid = _make_user(remote, h, "blocked@x.com")
    tok = _user_token(remote, "blocked@x.com")
    assert remote.get("/v1/runtime/actors", headers={"Authorization": f"Bearer {tok}"}).status_code == 200

    remote.post(f"/v1/users/{uid}/flags", json={"flag": "blocked:abuse"}, headers=h)
    r = remote.get("/v1/runtime/actors", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401
    # Generic body — no state disclosure (security note 6)
    assert "blocked" not in r.text.lower()


def test_deactivation_invalidates_live_token(remote: TestClient) -> None:
    h = _admin(remote)
    uid = _make_user(remote, h, "gone@x.com")
    tok = _user_token(remote, "gone@x.com")
    remote.put(f"/v1/users/{uid}", json={"is_active": False}, headers=h)
    assert remote.get("/v1/runtime/actors", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_blocked_and_inactive_and_invalid_are_indistinguishable(remote: TestClient) -> None:
    h = _admin(remote)
    uid_b = _make_user(remote, h, "b@x.com")
    tok_b = _user_token(remote, "b@x.com")
    remote.post(f"/v1/users/{uid_b}/flags", json={"flag": "blocked:none"}, headers=h)
    uid_i = _make_user(remote, h, "i@x.com")
    tok_i = _user_token(remote, "i@x.com")
    remote.put(f"/v1/users/{uid_i}", json={"is_active": False}, headers=h)

    r_blocked = remote.get("/v1/runtime/actors", headers={"Authorization": f"Bearer {tok_b}"})
    r_inactive = remote.get("/v1/runtime/actors", headers={"Authorization": f"Bearer {tok_i}"})
    assert r_blocked.status_code == r_inactive.status_code == 401
    assert r_blocked.json() == r_inactive.json()


def test_unknown_flag_rejected(remote: TestClient) -> None:
    h = _admin(remote)
    uid = _make_user(remote, h, "f@x.com")
    r = remote.post(f"/v1/users/{uid}/flags", json={"flag": "nonsense"}, headers=h)
    assert r.status_code == 422


def test_duplicate_flag_rejected(remote: TestClient) -> None:
    h = _admin(remote)
    uid = _make_user(remote, h, "d@x.com")
    assert remote.post(f"/v1/users/{uid}/flags", json={"flag": "warning:none"}, headers=h).status_code == 201
    assert remote.post(f"/v1/users/{uid}/flags", json={"flag": "warning:none"}, headers=h).status_code == 409


def test_remove_flag(remote: TestClient) -> None:
    h = _admin(remote)
    uid = _make_user(remote, h, "rm@x.com")
    f = remote.post(f"/v1/users/{uid}/flags", json={"flag": "warning:none"}, headers=h).json()
    assert remote.delete(f"/v1/users/{uid}/flags/{f['id']}", headers=h).status_code == 204
    assert remote.get(f"/v1/users/{uid}/flags", headers=h).json() == []


# ── Phase 2: invitations ──────────────────────────────────────────────────────


def test_invitation_creates_newbie_limbo_user(remote: TestClient) -> None:
    invitation = _invite(remote, "newbie@x.com")
    payload = pyjwt.decode(invitation, _JWT_SECRET, algorithms=["HS256"])
    assert payload["purpose"] == "invite"
    assert payload["roles"] == ["limbo"]
    assert payload["jti"]

    h = _admin(remote)
    users = remote.get("/v1/users", params={"flag": "newbie"}, headers=h).json()
    match = [u for u in users if u["email"] == "newbie@x.com"]
    assert match and match[0]["is_active"] is False
    assert match[0]["roles"] == ["limbo"]
    assert any(f["flag"] == "newbie" for f in match[0]["flags"])


def test_activation_enables_and_clears_newbie(remote: TestClient) -> None:
    _invite(remote, "toenable@x.com")
    h = _admin(remote)
    uid = next(u["id"] for u in remote.get("/v1/users", headers=h).json() if u["email"] == "toenable@x.com")
    u = remote.post(f"/v1/users/{uid}/activate", headers=h).json()
    assert u["is_active"] is True
    assert all(f["flag"] != "newbie" for f in u["flags"])


def test_invitation_blocked_in_local_mode(client: TestClient) -> None:
    r = client.post("/v1/auth/invitations", json={"first_name": "a", "last_name": "b", "email": "c@d.e"})
    assert r.status_code == 400


def test_invitation_rate_limited(remote: TestClient) -> None:
    for i in range(10):
        remote.post("/v1/auth/invitations",
                    json={"first_name": "a", "last_name": "b", "email": f"rl{i}@x.com"})
    r = remote.post("/v1/auth/invitations",
                    json={"first_name": "a", "last_name": "b", "email": "rl-final@x.com"})
    assert r.status_code == 429


def test_invitation_for_enrolled_user_returns_no_token(remote: TestClient) -> None:
    """Anyone knowing an enrolled user's email must not obtain a re-enrolment path."""
    remote.app.state  # noqa: B018 — ensure app started
    _enrol_email = "hijack@x.com"
    _enrol(remote, _enrol_email)
    # activate not needed for this check — invitation must be withheld regardless
    r = remote.post("/v1/auth/invitations",
                    json={"first_name": "a", "last_name": "b", "email": _enrol_email})
    assert r.status_code == 200
    assert r.json()["invitation"] is None


# ── Phase 3: key enrolment ────────────────────────────────────────────────────


def test_enrolment_happy_path_binds_email_as_cantica_user_id(remote: TestClient) -> None:
    _priv, cantica_user_id = _enrol(remote, "enrolme@x.com")
    assert cantica_user_id == "enrolme@x.com"

    h = _admin(remote)
    uid = next(u["id"] for u in remote.get("/v1/users", headers=h).json() if u["email"] == "enrolme@x.com")
    keys = remote.get(f"/v1/users/{uid}/keys", headers=h).json()
    assert len(keys) == 1 and keys[0]["cantica_user_id"] == "enrolme@x.com"


def test_enrolment_rejects_private_key_material(remote: TestClient) -> None:
    invitation = _invite(remote, "leaky@x.com")
    private_pem, _public_pem = _keypair()
    assertion = _assertion(private_pem, "leaky", extra={"invitation": invitation})
    r = remote.post("/v1/auth/register",
                    json={"assertion": assertion, "public_key_pem": private_pem})
    assert r.status_code == 401


def test_enrolment_rejects_wrong_key_signature(remote: TestClient) -> None:
    invitation = _invite(remote, "forged@x.com")
    signer_priv, _ = _keypair()
    _, other_pub = _keypair()
    assertion = _assertion(signer_priv, "forged", extra={"invitation": invitation})
    r = remote.post("/v1/auth/register",
                    json={"assertion": assertion, "public_key_pem": other_pub})
    assert r.status_code == 401


def test_enrolment_rejects_replayed_invitation(remote: TestClient) -> None:
    invitation = _invite(remote, "replay@x.com")
    priv1, pub1 = _keypair()
    a1 = _assertion(priv1, "replay", extra={"invitation": invitation})
    assert remote.post("/v1/auth/register",
                       json={"assertion": a1, "public_key_pem": pub1}).status_code == 200
    # Even after revoking the key, the burned invitation must not be reusable.
    priv2, pub2 = _keypair()
    a2 = _assertion(priv2, "replay", extra={"invitation": invitation})
    assert remote.post("/v1/auth/register",
                       json={"assertion": a2, "public_key_pem": pub2}).status_code == 401


def test_enrolment_rejects_second_key_via_invitation(remote: TestClient) -> None:
    _enrol(remote, "once@x.com")
    r = remote.post("/v1/auth/invitations",
                    json={"first_name": "a", "last_name": "b", "email": "once@x.com"})
    assert r.json()["invitation"] is None  # cannot even obtain a new invitation


def test_enrolment_rejects_stale_assertion(remote: TestClient) -> None:
    invitation = _invite(remote, "stale@x.com")
    priv, pub = _keypair()
    assertion = _assertion(priv, "stale", extra={"invitation": invitation}, iat_offset=-3600)
    r = remote.post("/v1/auth/register", json={"assertion": assertion, "public_key_pem": pub})
    assert r.status_code == 401


def test_legacy_register_body_is_noop_in_local_mode(client: TestClient) -> None:
    r = client.post("/v1/auth/register",
                    json={"client_id": "abc", "public_key_pem": "-----BEGIN PUBLIC KEY-----..."})
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "mode": "local"}


# ── Phase 4: key-based authentication ─────────────────────────────────────────


def _activate_by_email(client: TestClient, email: str) -> str:
    h = _admin(client)
    uid = next(u["id"] for u in client.get("/v1/users", headers=h).json() if u["email"] == email)
    client.post(f"/v1/users/{uid}/activate", headers=h)
    return uid


def test_assert_exchanges_key_signature_for_access_token(remote: TestClient) -> None:
    priv, cuid = _enrol(remote, "keyuser@x.com")
    uid = _activate_by_email(remote, "keyuser@x.com")
    h = _admin(remote)
    remote.post(f"/v1/users/{uid}/roles/viewer", headers=h)

    r = remote.post("/v1/auth/assert", json={"assertion": _assertion(priv, cuid)})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    assert r.json()["warnings"] == []

    # The issued token carries the user's real permissions.
    assert remote.get("/v1/runtime/actors", headers={"Authorization": f"Bearer {tok}"}).status_code == 200


def test_assert_denied_for_inactive_newbie(remote: TestClient) -> None:
    priv, cuid = _enrol(remote, "inactivekey@x.com")  # never activated
    r = remote.post("/v1/auth/assert", json={"assertion": _assertion(priv, cuid)})
    assert r.status_code == 401


def test_assert_denied_for_blocked_user(remote: TestClient) -> None:
    priv, cuid = _enrol(remote, "badkey@x.com")
    uid = _activate_by_email(remote, "badkey@x.com")
    h = _admin(remote)
    remote.post(f"/v1/users/{uid}/flags", json={"flag": "blocked:abuse"}, headers=h)
    r = remote.post("/v1/auth/assert", json={"assertion": _assertion(priv, cuid)})
    assert r.status_code == 401
    assert "blocked" not in r.text.lower()


def test_assert_returns_warnings(remote: TestClient) -> None:
    priv, cuid = _enrol(remote, "warnkey@x.com")
    uid = _activate_by_email(remote, "warnkey@x.com")
    h = _admin(remote)
    remote.post(f"/v1/users/{uid}/flags", json={"flag": "warning:suspicious"}, headers=h)
    r = remote.post("/v1/auth/assert", json={"assertion": _assertion(priv, cuid)})
    assert r.status_code == 200
    assert r.json()["warnings"] == ["warning:suspicious"]


def test_assert_rejects_wrong_key(remote: TestClient) -> None:
    _priv, cuid = _enrol(remote, "victim@x.com")
    _activate_by_email(remote, "victim@x.com")
    attacker_priv, _ = _keypair()
    r = remote.post("/v1/auth/assert", json={"assertion": _assertion(attacker_priv, cuid)})
    assert r.status_code == 401


def test_assert_rejects_jti_replay(remote: TestClient) -> None:
    priv, cuid = _enrol(remote, "replaykey@x.com")
    _activate_by_email(remote, "replaykey@x.com")
    assertion = _assertion(priv, cuid)
    assert remote.post("/v1/auth/assert", json={"assertion": assertion}).status_code == 200
    assert remote.post("/v1/auth/assert", json={"assertion": assertion}).status_code == 401


def test_assert_rejects_unknown_cantica_user_id(remote: TestClient) -> None:
    priv, _ = _keypair()
    r = remote.post("/v1/auth/assert", json={"assertion": _assertion(priv, "ghost@x.com")})
    assert r.status_code == 401


def test_revoked_key_stops_authenticating(remote: TestClient) -> None:
    priv, cuid = _enrol(remote, "revokeme@x.com")
    uid = _activate_by_email(remote, "revokeme@x.com")
    h = _admin(remote)
    assert remote.post("/v1/auth/assert", json={"assertion": _assertion(priv, cuid)}).status_code == 200

    key_id = remote.get(f"/v1/users/{uid}/keys", headers=h).json()[0]["id"]
    assert remote.delete(f"/v1/users/{uid}/keys/{key_id}", headers=h).status_code == 204
    assert remote.post("/v1/auth/assert", json={"assertion": _assertion(priv, cuid)}).status_code == 401


def test_assert_blocked_in_local_mode(client: TestClient) -> None:
    r = client.post("/v1/auth/assert", json={"assertion": "x.y.z"})
    assert r.status_code == 400


def test_e_user_id_used_as_cantica_user_id_when_present(remote: TestClient) -> None:
    """Spec 8.a — enterprise id wins over email."""
    invitation = _invite(remote, "corp@x.com")
    h = _admin(remote)
    uid = next(u["id"] for u in remote.get("/v1/users", headers=h).json() if u["email"] == "corp@x.com")

    # Simulate enterprise provisioning: set e_user_id directly in the DB.
    from sqlalchemy import update
    from studio_api.orm.db import new_session
    from studio_api.orm.models import User
    with new_session(remote.app.state.db_engine) as s:
        s.execute(update(User).where(User.id == uid).values(e_user_id="CORP\\jdoe"))
        s.commit()

    priv, pub = _keypair()
    assertion = _assertion(priv, "corp", extra={"invitation": invitation})
    r = remote.post("/v1/auth/register", json={"assertion": assertion, "public_key_pem": pub})
    assert r.status_code == 200
    assert r.json()["cantica_user_id"] == "CORP\\jdoe"
