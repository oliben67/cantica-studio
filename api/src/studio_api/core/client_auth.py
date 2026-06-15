"""Client public-key store and JWT assertion verification for studio-api."""

from __future__ import annotations

import json
import logging
from pathlib import Path

_log = logging.getLogger(__name__)

_KEYS_DIR = Path.home() / ".cantica"
_KEYS_FILE = _KEYS_DIR / "studio-client-keys.json"


def _load() -> dict[str, str]:
    if not _KEYS_FILE.exists():
        return {}
    try:
        return json.loads(_KEYS_FILE.read_text())
    except Exception:
        return {}


def _save(data: dict[str, str]) -> None:
    _KEYS_DIR.mkdir(parents=True, exist_ok=True)
    _KEYS_FILE.write_text(json.dumps(data, indent=2))


def register_client(client_id: str, public_key_pem: str) -> None:
    data = _load()
    data[client_id] = public_key_pem
    _save(data)
    _log.info("Registered studio client %r", client_id)


def get_public_key_pem(client_id: str) -> str | None:
    return _load().get(client_id)


def verify_assertion(token: str) -> str | None:
    """Verify a RS256 client assertion JWT; return client_id or None if invalid."""
    try:
        import jwt  # noqa: PLC0415
        from cryptography.hazmat.primitives.serialization import load_pem_public_key  # noqa: PLC0415

        unverified = jwt.decode(token, options={"verify_signature": False})
        client_id: str | None = unverified.get("sub") or unverified.get("iss")
        if not client_id:
            return None
        pem = get_public_key_pem(client_id)
        if not pem:
            _log.debug("Unknown studio client %r", client_id)
            return None
        pub_key = load_pem_public_key(pem.encode())
        jwt.decode(token, pub_key, algorithms=["RS256"], options={"verify_aud": False})
        return client_id
    except Exception as exc:
        _log.debug("Client assertion verification failed: %s", exc)
        return None
