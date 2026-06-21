# Studio API — Groups, Shared Keys & Pluggable Auth: Roadmap

## 1. Scope

This document covers three closely related changes to the Studio API:

1. **Group-owned provider keys** — a named group of users shares one set of provider API keys instead of each user managing their own.
2. **Single-group membership** — in remote mode, a user belongs to at most one group; group assignment is manual initially and can later be driven by an external directory.
3. **Pluggable auth backends** — a clean interface so the server can authenticate users and resolve their group membership from multiple sources (email/password today; LDAP/AD and OIDC tomorrow) without changing any business logic.

Local mode is already correct and requires no changes here.

---

## 2. Current State

```
User ──< Provider ──< ProviderToken
User ──< user_roles ──< Role ──< role_permissions ──< Permission
User ──< ApiToken
```

`Provider.user_id` (NOT NULL FK) ties every provider key to a single user. In local mode this is always `local@studio.local`. In remote mode each user manages their own keys independently — no sharing.

Authentication is entirely inline in `api/v1/auth.py`: it fetches the `User` row, runs `argon2.verify`, and mints a JWT. No concept of groups or pluggable backends exists.

---

## 3. Target Architecture

### 3.1 Local mode — no change

- One `local@studio.local` admin user.
- `Provider.user_id` points to that user. All providers remain user-owned.
- VS Code SecretStorage holds one `cantica.providerKeys` entry. `syncProviderKeys()` pushes those keys to the DB on first healthy connection.
- Groups and auth backends are irrelevant.

### 3.2 Remote mode — credential ownership model

A `Provider` belongs to **either** a user **or** a group — never both, never neither. The two FK columns are mutually exclusive and exactly-one-set is enforced at the application layer (not a DB constraint, KISS).

```
Group ──< Provider ──< ProviderToken      (group-owned)
User  ──< Provider ──< ProviderToken      (personal, user_id set, group_id NULL)
User ──> Group  (nullable FK, at most one group per user)
```

**Credential resolution order** when the runtime needs a key for a given provider type:

1. User's personal providers (those where `Provider.user_id == current_user`)
2. The group's providers (those where `Provider.group_id == current_user.group_id`)
3. 404 if nothing is found

This means a personal key always shadows the group key for the same provider type, useful for admin overrides.

### 3.3 Group membership

`User.group_id` is a nullable FK to `Group.id`. Because it is a single column, the "at most one group" constraint is structural — there is no join table to accidentally allow duplicate membership.

Groups are created and managed by admins via the API. Membership is assigned manually via `POST /groups/{id}/members`. In a future phase, `Group.external_id` (see §4.1) is used to match an LDAP DN or an OIDC `groups` claim and auto-assign membership on login.

### 3.4 Pluggable auth backends

The auth backend is selected at startup from config. All backends implement the same `AuthBackend` protocol:

```
credentials → authenticate() → AuthResult(user_id, email, group_name, extra_roles)
                                     ↓
                               sync_user()  ← upserts User row, assigns group, adds roles
                                     ↓
                               JWT minted with permissions
```

`authenticate()` returns `None` on failure (wrong password / unknown user). The login endpoint never needs to know which backend ran.

Initially only `LocalBackend` (current argon2+password) is implemented. `LdapBackend` and `OidcBackend` are scaffolded as stubs — the interface is defined, `authenticate` raises `NotImplementedError`, config fields exist but are inert.

---

## 4. Schema Changes

### 4.1 New table: `groups`

```sql
CREATE TABLE groups (
    id           VARCHAR(36)  PRIMARY KEY,
    name         VARCHAR(200) NOT NULL UNIQUE,
    description  VARCHAR(500) NOT NULL DEFAULT '',
    external_id  VARCHAR(500) NOT NULL DEFAULT '',   -- LDAP DN, AD SID, OIDC groups claim value
    created_at   DATETIME NOT NULL,
    updated_at   DATETIME NOT NULL
);
```

`external_id` is the opaque identifier the external directory uses to refer to this group. Empty string means "manual only". A single field is sufficient because one Studio group maps to exactly one external group concept per backend.

### 4.2 Modified table: `users`

Add one nullable FK column:

```sql
ALTER TABLE users ADD COLUMN group_id VARCHAR(36) REFERENCES groups(id) ON DELETE SET NULL;
```

When a group is deleted all its members' `group_id` is set to NULL automatically.

### 4.3 Modified table: `providers`

Make `user_id` nullable; add a nullable `group_id`:

```sql
ALTER TABLE providers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE providers ADD COLUMN group_id VARCHAR(36) REFERENCES groups(id) ON DELETE CASCADE;
```

`create_all` in SQLAlchemy will handle these as additive changes against an existing SQLite DB since the new column is nullable. If a clean rebuild is needed, delete the DB file and restart.

---

## 5. ORM Models (`orm/models.py`)

### 5.1 New class `Group`

```python
class Group(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(500), default="")
    external_id: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    members: Mapped[list["User"]] = relationship("User", back_populates="group")
    providers: Mapped[list["Provider"]] = relationship(
        "Provider", back_populates="group", cascade="all, delete-orphan"
    )
```

### 5.2 Updated `User`

Add `group_id` column and `group` relationship:

```python
group_id: Mapped[str | None] = mapped_column(
    String(36), ForeignKey("groups.id", ondelete="SET NULL"), nullable=True, index=True
)
group: Mapped["Group | None"] = relationship("Group", back_populates="members")
```

### 5.3 Updated `Provider`

Make `user_id` nullable; add `group_id`:

```python
user_id: Mapped[str | None] = mapped_column(
    String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
)
group_id: Mapped[str | None] = mapped_column(
    String(36), ForeignKey("groups.id", ondelete="CASCADE"), nullable=True, index=True
)
group: Mapped["Group | None"] = relationship("Group", back_populates="providers")
```

`User.providers` relationship stays but is now the personal-only view. The cascade still applies (delete user → delete their personal providers).

**Application-level invariant** enforced in every endpoint that creates a `Provider`:

```python
def _validate_provider_owner(user_id: str | None, group_id: str | None) -> None:
    if (user_id is None) == (group_id is None):
        raise ValueError("Exactly one of user_id or group_id must be set")
```

---

## 6. Auth Backend Interface (`auth/backends.py`) — new file

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Protocol, TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session
    from studio_api.orm.models import User


@dataclass
class AuthResult:
    user_id: str          # existing DB id, or empty string for new users
    email: str
    group_name: str | None = None     # group to assign on sync
    extra_roles: list[str] = field(default_factory=list)


class AuthBackend(Protocol):
    def authenticate(self, credential: str, secret: str) -> AuthResult | None:
        """Return AuthResult on success, None on bad credentials."""
        ...

    def sync_user(self, session: "Session", result: AuthResult) -> "User":
        """Upsert user row, assign group and extra roles. Called after authenticate()."""
        ...


def get_auth_backend(settings) -> AuthBackend:
    """Factory: return the configured backend based on settings.auth_backend."""
    if settings.auth_backend == "ldap":
        from studio_api.auth.ldap_backend import LdapBackend  # noqa: PLC0415
        return LdapBackend.from_settings(settings)
    if settings.auth_backend == "oidc":
        from studio_api.auth.oidc_backend import OidcBackend  # noqa: PLC0415
        return OidcBackend.from_settings(settings)
    from studio_api.auth.local_backend import LocalBackend  # noqa: PLC0415
    return LocalBackend()
```

---

## 7. Auth Backend Implementations

### 7.1 `auth/local_backend.py` — new file

Extracts the current inline argon2 logic from `api/v1/auth.py` into `LocalBackend`. Behaviour is identical to today; no functional change.

```python
class LocalBackend:
    """Email + argon2 password. No external directory."""

    def authenticate(self, credential: str, secret: str) -> AuthResult | None:
        # query users table by email, verify argon2 hash
        ...

    def sync_user(self, session: Session, result: AuthResult) -> User:
        # no external groups; just return the existing user row
        ...
```

### 7.2 `auth/ldap_backend.py` — new file (stub)

```python
class LdapBackend:
    """
    Bind user against LDAP, resolve group membership from a configured attribute.
    Maps LDAP group DNs to Studio group names via ldap_group_map.
    """

    @classmethod
    def from_settings(cls, settings) -> "LdapBackend": ...

    def authenticate(self, credential: str, secret: str) -> AuthResult | None:
        raise NotImplementedError("LDAP backend not yet implemented")

    def sync_user(self, session: Session, result: AuthResult) -> User:
        raise NotImplementedError
```

### 7.3 `auth/oidc_backend.py` — new file (stub)

```python
class OidcBackend:
    """
    Validate an OIDC ID token. credential = id_token, secret = ignored.
    Reads the configured groups claim for group resolution.
    """

    @classmethod
    def from_settings(cls, settings) -> "OidcBackend": ...

    def authenticate(self, credential: str, secret: str) -> AuthResult | None:
        raise NotImplementedError("OIDC backend not yet implemented")

    def sync_user(self, session: Session, result: AuthResult) -> User:
        raise NotImplementedError
```

---

## 8. Configuration Changes (`config.py`)

```python
# Auth backend selector: "local" | "ldap" | "oidc"
auth_backend: str = "local"

# ── LDAP (auth_backend = "ldap") ───────────────────────────────────────────
ldap_host: str = ""
ldap_port: int = 389
ldap_base_dn: str = ""
ldap_group_attr: str = "memberOf"
# JSON map: external group DN → Studio group name
# e.g. '{"cn=studio-admins,dc=corp,dc=com": "admins"}'
ldap_group_map_raw: str = "{}"

# ── OIDC (auth_backend = "oidc") ───────────────────────────────────────────
oidc_issuer: str = ""
oidc_client_id: str = ""
oidc_group_claim: str = "groups"
# JSON map: OIDC groups claim value → Studio group name
# e.g. '{"studio-admins": "admins"}'
oidc_group_map_raw: str = "{}"

@property
def ldap_group_map(self) -> dict[str, str]:
    import json
    return json.loads(self.ldap_group_map_raw)

@property
def oidc_group_map(self) -> dict[str, str]:
    import json
    return json.loads(self.oidc_group_map_raw)
```

All env var names follow the `STUDIO_` prefix: `STUDIO_AUTH_BACKEND`, `STUDIO_LDAP_HOST`, etc.

---

## 9. New API Endpoints (`api/v1/groups.py`) — new file

Mounted at `/groups` in `router.py`.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/groups` | `groups:read` | List all groups with member count |
| `POST` | `/groups` | `groups:write` | Create a group |
| `GET` | `/groups/{id}` | `groups:read` | Get group detail |
| `PATCH` | `/groups/{id}` | `groups:write` | Update name / description / external_id |
| `DELETE` | `/groups/{id}` | `groups:write` | Delete group (members' group_id set to NULL) |
| `GET` | `/groups/{id}/members` | `groups:read` | List users in group |
| `POST` | `/groups/{id}/members` | `groups:write` | Assign user to group (removes from prior group first) |
| `DELETE` | `/groups/{id}/members/{uid}` | `groups:write` | Remove user from group |
| `GET` | `/groups/{id}/providers` | `providers:read` | List group-owned providers |

New permissions to add in `orm/seed.py`:

```python
("groups:read",  "View groups and their membership"),
("groups:write", "Create, update, delete groups and manage membership"),
```

Role assignments:
- `admin`: all permissions (already gets everything)
- `operator`: add `groups:read`
- `viewer`: no change

---

## 10. Modified Endpoints

### `api/v1/access.py`

**`_get_provider_or_404`**: allow access if `Provider.user_id == current_user` OR `Provider.group_id == current_user.group_id`.

**`list_providers`**: return personal providers + group's providers merged, with a `"scope": "personal" | "group"` field in the response dict.

**`create_provider`**: accept optional `group_id` in `ProviderCreate`. If supplied, user must have `groups:write` (or be admin). `user_id` is set to NULL when creating a group-owned provider.

**`_provider_response`**: add `group_id` field.

### `api/v1/auth.py`

Replace the inline argon2 block in `POST /auth/login` with:

```python
backend = get_auth_backend(settings)
result = backend.authenticate(body.email, body.password)
if result is None:
    raise HTTPException(status_code=401, detail="Invalid credentials")
user = backend.sync_user(session, result)
```

`sync_user` handles group assignment so the JWT carries the correct group context.

### `auth/deps.py`

Add `group_id: str | None` to `CurrentUser`. The JWT payload will include `"group_id"`. `LOCAL_USER` gets `group_id=None` (local mode has no groups).

### `api/v1/router.py`

```python
from studio_api.api.v1 import groups
_protected.include_router(groups.router, prefix="/groups", tags=["groups"])
```

---

## 11. VS Code Extension (minimal impact)

| Mode | Change |
|------|--------|
| Local | None — `syncProviderKeys` continues to push SecretStorage keys to the `local` user's personal providers |
| Remote | Skip `syncProviderKeys` — in remote mode the server owns its own keys; the extension only holds a JWT. The `_syncCredentials()` call in `extension.ts` already gates on `settings.studioMode`. |

No new extension files. The only conditional to add is in `extension.ts` `_syncCredentials()`:

```typescript
if (settings.studioMode !== "remote") {
    const providerKeys = await loadProviderKeys(context.secrets);
    await client.syncProviderKeys(providerKeys);
}
```

---

## 12. File Change Summary

| File | Change |
|------|--------|
| `orm/models.py` | Add `Group`; update `User` (`group_id` FK, `group` rel); update `Provider` (`user_id` nullable, `group_id` FK, `group` rel) |
| `orm/seed.py` | Add `groups:read`, `groups:write` permissions; add to `admin` and `operator` roles |
| `auth/backends.py` | **New** — `AuthResult`, `AuthBackend` Protocol, `get_auth_backend()` factory |
| `auth/local_backend.py` | **New** — extracted current argon2 logic |
| `auth/ldap_backend.py` | **New** — stub, `NotImplementedError` |
| `auth/oidc_backend.py` | **New** — stub, `NotImplementedError` |
| `auth/deps.py` | Add `group_id` to `CurrentUser`; update JWT payload extraction |
| `api/v1/groups.py` | **New** — Group CRUD + membership endpoints |
| `api/v1/access.py` | Update ownership resolution, merge personal+group providers in list |
| `api/v1/auth.py` | Delegate to `get_auth_backend(settings).authenticate()` |
| `api/v1/router.py` | Register `groups.router` at `/groups` |
| `config.py` | Add `auth_backend`, LDAP and OIDC settings |
| `clients/vscode/src/extension.ts` | Skip `syncProviderKeys` in remote mode |

---

## 13. Implementation Phases

### Phase 1 — Groups and shared provider keys *(server only)*

1. Add `Group` to `orm/models.py`.
2. Add `User.group_id`, `Provider.group_id`, make `Provider.user_id` nullable.
3. Add `groups:read/write` to `orm/seed.py` and role tables.
4. Create `api/v1/groups.py` with all CRUD + membership endpoints.
5. Update `api/v1/access.py` for group-owned provider resolution.
6. Register `groups.router` in `api/v1/router.py`.
7. Rebuild container.

No client changes. Existing personal-provider behaviour is unchanged.

### Phase 2 — Auth backend extraction *(refactor, no behaviour change)*

1. Create `auth/backends.py` with `AuthResult`, `AuthBackend`, `get_auth_backend`.
2. Create `auth/local_backend.py` extracting current argon2 logic.
3. Update `api/v1/auth.py` to delegate to `get_auth_backend(settings).authenticate`.
4. Add `auth_backend` to `config.py`.
5. All existing tests pass unchanged — `LocalBackend` is identical to today's inline logic.

### Phase 3 — LDAP stub *(config only)*

1. Create `auth/ldap_backend.py` with `NotImplementedError`.
2. Add LDAP config fields to `config.py`.
3. `get_auth_backend` returns `LdapBackend` when `STUDIO_AUTH_BACKEND=ldap` (fails gracefully on first login attempt until implemented).

### Phase 4 — OIDC stub *(same pattern as Phase 3)*

1. Create `auth/oidc_backend.py`.
2. Add OIDC config fields.

### Phase 5 (future) — Real LDAP implementation

Implement `LdapBackend.authenticate` using `python-ldap` or `ldap3`. Read `group_attr` to resolve group name via `ldap_group_map`. `sync_user` upserts the user and assigns the mapped group.

### Phase 6 (future) — Real OIDC implementation

Implement `OidcBackend.authenticate` using `python-jose` or `authlib`. Validate the ID token against the issuer JWKS. Read the `oidc_group_claim` value, map via `oidc_group_map`. `sync_user` as above.

---

## 14. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single `group_id` FK on `User` (not a join table) | Structural enforcement of "at most one group" with zero extra code |
| Mutually exclusive `user_id` / `group_id` on `Provider` (app-enforced) | Simple; avoids a `CredentialSet` indirection layer (KISS) |
| Credential resolution at query time (not caching) | Correct by default; avoids cache invalidation problems |
| Auth backend in config, not DB | A server restart is acceptable when changing identity providers; no admin UI needed for Phase 1-4 |
| LDAP/OIDC as `NotImplementedError` stubs | Interface is defined and tested early; real implementation drops in without touching call sites |
| `sync_user` called on every login | Keeps group membership current if the external directory changes; idempotent upsert |

---

*Awaiting green light to begin Phase 1 implementation.*
