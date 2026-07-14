"""Database seeding — built-in permissions, roles, providers, and optional first admin user."""

from __future__ import annotations

import logging
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from studio_api.orm.models import Permission, Provider, ProviderToken, Role, User

log = logging.getLogger(__name__)

# ── Built-in permissions (resource:action) ────────────────────────────────────

BUILTIN_PERMISSIONS: list[tuple[str, str]] = [
    # Actor runtime
    ("runtime:read",      "List and inspect running actors"),
    ("runtime:start",     "Start new actors"),
    ("runtime:stop",      "Stop and delete actors"),
    ("runtime:instruct",  "Send instructions and fire events to actors"),
    # Actor graph
    ("graph:read",        "Read the actor graph"),
    ("graph:write",       "Save changes to the actor graph"),
    # Prompts & providers
    ("prompts:read",      "Fetch prompts from Cantica servers"),
    ("providers:read",    "List available LLM provider models"),
    # Resources
    ("resources:read",    "Read actor resources"),
    ("resources:write",   "Add, delete, and share actor resources"),
    # Provider management
    ("providers:write",   "Create, update, and delete providers and their tokens"),
    # User management
    ("users:read",        "View users and their role assignments"),
    ("users:write",       "Create, update, and delete users"),
    # Role management
    ("roles:read",        "View roles and their permissions"),
    ("roles:write",       "Create, update, and delete roles"),
    # API token management
    ("tokens:read",       "List API tokens"),
    ("tokens:write",      "Create and revoke API tokens"),
    # Group management
    ("groups:read",       "View groups and their membership"),
    ("groups:write",      "Create, update, delete groups and manage membership"),
]

# ── Built-in roles ────────────────────────────────────────────────────────────

BUILTIN_ROLES: dict[str, dict] = {
    "admin": {
        "description": "Full administrative access to all resources",
        "permissions": [p[0] for p in BUILTIN_PERMISSIONS],
    },
    "operator": {
        "description": "Manage actors, graphs, and resources; read-only on users",
        "permissions": [
            "runtime:read", "runtime:start", "runtime:stop", "runtime:instruct",
            "graph:read", "graph:write",
            "prompts:read", "providers:read",
            "resources:read", "resources:write",
            "providers:write",
            "tokens:read", "tokens:write",
            "groups:read",
        ],
    },
    "viewer": {
        "description": "Read-only access to actors, graph, and prompts",
        "permissions": [
            "runtime:read",
            "graph:read",
            "prompts:read",
            "providers:read",
            "resources:read",
        ],
    },
    # Deny-by-default role for users with no assignment yet. Every endpoint
    # requires an explicit permission, so zero permissions means zero access.
    "limbo": {
        "description": "No access (default for unassigned users)",
        "permissions": [],
    },
}

LOCAL_USER_EMAIL = "local@studio.local"

# Env-var → (provider type, display name)
_ENV_PROVIDERS: list[tuple[str, str, str]] = [
    ("ANTHROPIC_API_KEY", "claude",   "Anthropic"),
    ("OPENAI_API_KEY",    "gpt",      "OpenAI"),
    ("GEMINI_API_KEY",    "gemini",   "Google Gemini"),
    ("GITHUB_TOKEN",      "copilot",  "GitHub Copilot"),
]


def seed(session: Session) -> None:
    """Idempotently create built-in permissions and roles."""
    perm_by_name: dict[str, Permission] = {}

    for name, description in BUILTIN_PERMISSIONS:
        existing = session.scalar(select(Permission).where(Permission.name == name))
        if existing is None:
            p = Permission(name=name, description=description)
            session.add(p)
            perm_by_name[name] = p
            log.debug("Seeded permission: %s", name)
        else:
            perm_by_name[name] = existing

    session.flush()

    for role_name, role_def in BUILTIN_ROLES.items():
        role = session.scalar(select(Role).where(Role.name == role_name))
        if role is None:
            role = Role(name=role_name, description=role_def["description"])
            session.add(role)
            log.debug("Seeded role: %s", role_name)

        # Sync permissions (add missing ones, don't remove any)
        session.flush()
        existing_perm_names = {p.name for p in role.permissions}
        for perm_name in role_def["permissions"]:
            if perm_name not in existing_perm_names and perm_name in perm_by_name:
                role.permissions.append(perm_by_name[perm_name])

    session.commit()
    log.info("Database seed complete")


def ensure_local_user(session: Session) -> User:
    """Return the built-in 'local' admin user, creating it if necessary."""
    user = session.scalar(select(User).where(User.email == LOCAL_USER_EMAIL))
    if user is not None:
        return user

    admin_role = session.scalar(select(Role).where(Role.name == "admin"))
    user = User(
        email=LOCAL_USER_EMAIL,
        password_hash="",  # no password — local mode bypasses auth entirely
        first_name="Local",
        last_name="Admin",
    )
    if admin_role:
        user.roles.append(admin_role)
    session.add(user)
    session.flush()
    log.info("Created local user: %s", LOCAL_USER_EMAIL)
    return user


def seed_providers(session: Session, user: User) -> None:
    """Idempotently create Provider + ProviderToken rows from host environment variables.

    Only called in local mode.  Each env-var present creates (or updates) one
    Provider row owned by *user* with one active ProviderToken labelled "env".
    If the env var is absent the provider is left untouched so manually added
    tokens survive server restarts.
    """
    for env_key, provider_type, display_name in _ENV_PROVIDERS:
        value = os.environ.get(env_key, "").strip()
        if not value:
            continue

        provider = session.scalar(
            select(Provider)
            .where(Provider.user_id == user.id, Provider.type == provider_type)
        )
        if provider is None:
            provider = Provider(user_id=user.id, name=display_name, type=provider_type)
            session.add(provider)
            session.flush()
            log.info("Seeded provider: %s (%s)", display_name, provider_type)

        # Upsert the "env" token — update value if changed
        token_row = session.scalar(
            select(ProviderToken)
            .where(ProviderToken.provider_id == provider.id, ProviderToken.label == "env")
        )
        if token_row is None:
            session.add(ProviderToken(provider_id=provider.id, label="env", token=value))
            log.debug("Added env token for provider: %s", provider_type)
        elif token_row.token != value:
            token_row.token = value
            log.debug("Updated env token for provider: %s", provider_type)

    session.commit()


def ensure_admin(session: Session, email: str, password_hash: str) -> bool:
    """Create the admin user if no admin user exists yet. Returns True if created."""
    from sqlalchemy.orm import selectinload  # noqa: PLC0415

    admin_role = session.scalar(select(Role).where(Role.name == "admin"))
    if admin_role is None:
        return False

    existing = session.scalar(
        select(User)
        .options(selectinload(User.roles))
        .join(User.roles)
        .where(Role.name == "admin")
    )
    if existing is not None:
        return False

    user = User(email=email, password_hash=password_hash, first_name="Admin")
    user.roles.append(admin_role)
    session.add(user)
    session.commit()
    log.info("Created initial admin user: %s", email)
    return True
