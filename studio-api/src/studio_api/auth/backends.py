"""Auth backend interface, AuthResult dataclass, and factory function."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from studio_api.orm.models import User


@dataclass
class AuthResult:
    user_id: str        # existing DB id; empty string means new/unknown user
    email: str
    group_name: str | None = None
    extra_roles: list[str] = field(default_factory=list)
    # Directory-provided identity (LDAP / OIDC backends).
    e_user_id: str | None = None
    first_name: str = ""
    last_name: str = ""
    # Raw external directory groups; mapped to roles via directory_group_roles.
    directory_groups: list[str] = field(default_factory=list)


class AuthBackend(Protocol):
    def authenticate(self, credential: str, secret: str) -> AuthResult | None:
        """Return AuthResult on success, None on bad credentials."""
        ...

    def sync_user(self, session: "Session", result: AuthResult) -> "User":
        """Upsert user row, assign group, add extra roles. Called after authenticate()."""
        ...


def get_auth_backend(settings, *, session=None) -> AuthBackend:
    """Factory — return the configured backend.

    The optional *session* is forwarded to LocalBackend only; LDAP and OIDC
    backends authenticate against external services and do not need it here.
    """
    if settings.auth_backend == "ldap":
        from studio_api.auth.ldap_backend import LdapBackend  # noqa: PLC0415
        return LdapBackend.from_settings(settings)
    if settings.auth_backend == "oidc":
        from studio_api.auth.oidc_backend import OidcBackend  # noqa: PLC0415
        return OidcBackend.from_settings(settings)
    from studio_api.auth.local_backend import LocalBackend  # noqa: PLC0415
    return LocalBackend(session)
