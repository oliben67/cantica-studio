"""cantica-secure adoption (extraction roadmap Phase C).

Builds the SecurityShim from studio settings and provides the delegation
bridge used by auth/deps when STUDIO_SECURITY_SHIM=1. The in-repo security
implementation is untouched and remains the flag-off path.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from cantica_secure import STUDIO_PERMISSIONS, STUDIO_ROLES, SecureConfig, SecurityShim

if TYPE_CHECKING:
    from studio_api.config import Settings


def build_security_shim(settings: "Settings") -> SecurityShim:
    """Map studio settings onto SecureConfig and construct the shim.

    The security database lives next to the studio DB
    (CANTICA_HOME/studio/secure.db) but is owned exclusively by the shim.
    """
    config = SecureConfig(
        local_mode=settings.local_mode,
        local_user_email="local@studio.local",
        db_path=settings.cantica_home / "studio" / "secure.db",
        jwt_secret=settings.jwt_secret,
        jwt_expire_minutes=settings.jwt_expire_minutes,
        admin_email=settings.admin_email,
        admin_password=settings.admin_password,
        auth_backend=settings.auth_backend,
        ldap_host=settings.ldap_host,
        ldap_port=settings.ldap_port,
        ldap_base_dn=settings.ldap_base_dn,
        ldap_group_attr=settings.ldap_group_attr,
        oidc_issuer=settings.oidc_issuer,
        oidc_client_id=settings.oidc_client_id,
        oidc_group_claim=settings.oidc_group_claim,
        default_roles_raw=settings.default_roles_raw,
        auto_activate_users=settings.auto_activate_users,
        invite_expire_minutes=settings.invite_expire_minutes,
        assertion_max_age_seconds=settings.assertion_max_age_seconds,
    )
    return SecurityShim(
        config,
        app_name="Cantica Studio",
        permissions=STUDIO_PERMISSIONS,
        builtin_roles=STUDIO_ROLES,
    )
