"""LdapBackend stub — bind user against LDAP, resolve group membership.

Not yet implemented. Returns NotImplementedError on first authenticate() call.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from studio_api.auth.backends import AuthResult

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from studio_api.orm.models import User


class LdapBackend:
    """
    Bind user against LDAP, resolve group membership from a configured attribute.
    Maps LDAP group DNs to Studio group names via ldap_group_map.
    """

    def __init__(
        self,
        host: str,
        port: int,
        base_dn: str,
        group_attr: str,
        group_map: dict[str, str],
    ) -> None:
        self._host = host
        self._port = port
        self._base_dn = base_dn
        self._group_attr = group_attr
        self._group_map = group_map

    @classmethod
    def from_settings(cls, settings) -> "LdapBackend":
        return cls(
            host=settings.ldap_host,
            port=settings.ldap_port,
            base_dn=settings.ldap_base_dn,
            group_attr=settings.ldap_group_attr,
            group_map=settings.ldap_group_map,
        )

    def authenticate(self, credential: str, secret: str) -> AuthResult | None:
        raise NotImplementedError("LDAP backend not yet implemented")

    def sync_user(self, session: "Session", result: AuthResult) -> "User":
        raise NotImplementedError
