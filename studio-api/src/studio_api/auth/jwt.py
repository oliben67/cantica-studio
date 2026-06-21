"""JWT creation and decoding."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

ALGORITHM = "HS256"


def create_access_token(
    *,
    user_id: str,
    roles: list[str],
    permissions: list[str],
    secret: str,
    expire_minutes: int,
) -> str:
    """Return a signed JWT with RBAC claims embedded."""
    now = datetime.now(timezone.utc)
    payload = {
        "iss": "studio-api",
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(minutes=expire_minutes),
        "roles": roles,
        "permissions": permissions,
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_access_token(token: str, secret: str) -> dict:
    """Decode and verify a JWT. Raises jwt.InvalidTokenError on failure."""
    return jwt.decode(token, secret, algorithms=[ALGORITHM])
