"""OidcBackend stub — validate OIDC ID token, resolve group membership.

Not yet implemented. Returns NotImplementedError on first authenticate() call.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from studio_api.auth.backends import AuthResult

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from studio_api.orm.models import User


class OidcBackend:
    """
    Validate an OIDC ID token against the configured issuer JWKS.
    credential = id_token, secret = ignored.
    Reads the configured groups claim for group resolution.
    """

    def __init__(
        self,
        issuer: str,
        client_id: str,
        group_claim: str,
        group_map: dict[str, str],
    ) -> None:
        self._issuer = issuer
        self._client_id = client_id
        self._group_claim = group_claim
        self._group_map = group_map

    @classmethod
    def from_settings(cls, settings) -> "OidcBackend":
        return cls(
            issuer=settings.oidc_issuer,
            client_id=settings.oidc_client_id,
            group_claim=settings.oidc_group_claim,
            group_map=settings.oidc_group_map,
        )

    def authenticate(self, credential: str, secret: str) -> AuthResult | None:
        raise NotImplementedError("OIDC backend not yet implemented")

    def sync_user(self, session: "Session", result: AuthResult) -> "User":
        raise NotImplementedError
