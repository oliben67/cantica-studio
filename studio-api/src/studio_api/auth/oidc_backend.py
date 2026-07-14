"""OidcBackend — validate an OIDC ID token, extract identity + directory groups.

credential = the raw ID token obtained by the client from the IdP; secret is
ignored. Signature is verified against the issuer's JWKS (discovered via
/.well-known/openid-configuration and cached per backend instance).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx
import jwt

from studio_api.auth.backends import AuthResult
from studio_api.auth.provision import provision_directory_user

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from studio_api.orm.models import User

log = logging.getLogger(__name__)


class OidcBackend:
    """
    Validate an OIDC ID token against the configured issuer JWKS.
    credential = id_token, secret = ignored.
    Reads the configured groups claim for directory-group resolution.
    """

    def __init__(
        self,
        issuer: str,
        client_id: str,
        group_claim: str,
        group_map: dict[str, str],
    ) -> None:
        self._issuer = issuer.rstrip("/")
        self._client_id = client_id
        self._group_claim = group_claim
        self._group_map = group_map
        self._jwk_client: jwt.PyJWKClient | None = None

    @classmethod
    def from_settings(cls, settings) -> "OidcBackend":
        return cls(
            issuer=settings.oidc_issuer,
            client_id=settings.oidc_client_id,
            group_claim=settings.oidc_group_claim,
            group_map=settings.oidc_group_map,
        )

    # ── JWKS resolution (separate seam so tests can inject a key) ─────────────

    def _signing_key_for(self, id_token: str) -> Any:
        """Return the verification key for *id_token* from the issuer's JWKS."""
        if self._jwk_client is None:
            discovery = f"{self._issuer}/.well-known/openid-configuration"
            resp = httpx.get(discovery, timeout=10.0)
            resp.raise_for_status()
            jwks_uri = resp.json()["jwks_uri"]
            self._jwk_client = jwt.PyJWKClient(jwks_uri)
        return self._jwk_client.get_signing_key_from_jwt(id_token).key

    # ── AuthBackend protocol ──────────────────────────────────────────────────

    def authenticate(self, credential: str, secret: str) -> AuthResult | None:  # noqa: ARG002
        try:
            key = self._signing_key_for(credential)
            claims = jwt.decode(
                credential,
                key,
                algorithms=["RS256", "ES256"],
                audience=self._client_id,
                issuer=self._issuer,
            )
        except (jwt.InvalidTokenError, httpx.HTTPError, KeyError) as exc:
            log.warning("OIDC token rejected: %s", exc)
            return None

        raw_groups = claims.get(self._group_claim) or []
        groups = [g for g in raw_groups if isinstance(g, str)] if isinstance(raw_groups, list) else []
        # Legacy group membership: first directory group with a group_map entry.
        group_name = next((self._group_map[g] for g in groups if g in self._group_map), None)

        return AuthResult(
            user_id="",  # resolved / created by sync_user
            email=str(claims.get("email", "")),
            group_name=group_name,
            e_user_id=str(claims.get("sub", "")) or None,
            first_name=str(claims.get("given_name", "")),
            last_name=str(claims.get("family_name", "")),
            directory_groups=groups,
        )

    def sync_user(self, session: "Session", result: AuthResult) -> "User":
        user = provision_directory_user(session, result)
        if result.group_name:
            from sqlalchemy import select  # noqa: PLC0415

            from studio_api.orm.models import Group  # noqa: PLC0415

            group = session.scalar(select(Group).where(Group.name == result.group_name))
            if group is not None and user.group_id != group.id:
                user.group_id = group.id
                session.commit()
        return user
