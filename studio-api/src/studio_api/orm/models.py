"""SQLAlchemy ORM models — Users, Roles, Permissions, ApiTokens, and their join tables."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, JSON, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from studio_api.orm.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


# ── Association tables (many-to-many) ─────────────────────────────────────────

user_roles_table = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", String(36), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)

role_permissions_table = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", String(36), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", String(36), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


# ── Core entities ─────────────────────────────────────────────────────────────

class User(Base):
    """Stores core user profile and credentials."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), default="")
    last_name: Mapped[str] = mapped_column(String(100), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    roles: Mapped[list[Role]] = relationship(
        "Role", secondary=user_roles_table, back_populates="users"
    )
    api_tokens: Mapped[list[ApiToken]] = relationship(
        "ApiToken", back_populates="user", cascade="all, delete-orphan"
    )
    providers: Mapped[list[Provider]] = relationship(
        "Provider", back_populates="user", cascade="all, delete-orphan"
    )


class Role(Base):
    """A named permission profile that can be assigned to multiple users."""

    __tablename__ = "roles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    users: Mapped[list[User]] = relationship(
        "User", secondary=user_roles_table, back_populates="roles"
    )
    permissions: Mapped[list[Permission]] = relationship(
        "Permission", secondary=role_permissions_table, back_populates="roles"
    )


class Permission(Base):
    """An atomic action on a resource, named resource:action (e.g. runtime:start)."""

    __tablename__ = "permissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    roles: Mapped[list[Role]] = relationship(
        "Role", secondary=role_permissions_table, back_populates="permissions"
    )


class ApiToken(Base):
    """Long-lived credential for CLI / 3rd-party access. Only the hash is stored."""

    __tablename__ = "api_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped[User] = relationship("User", back_populates="api_tokens")


class Provider(Base):
    """A registered LLM / tool provider owned by a user."""

    __tablename__ = "providers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Human-readable name, e.g. "Anthropic", "My OpenAI Account"
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Runtime key matching actor_ai provider names: claude, gpt, gemini, copilot, mistral
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    user: Mapped[User] = relationship("User", back_populates="providers")
    tokens: Mapped[list[ProviderToken]] = relationship(
        "ProviderToken", back_populates="provider", cascade="all, delete-orphan"
    )


class ProviderToken(Base):
    """An API key or token for a Provider. The value is stored as plaintext."""

    __tablename__ = "provider_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    provider_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("providers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(200), default="default")
    # Stored as plaintext — the value is needed at runtime to call external APIs.
    token: Mapped[str] = mapped_column(String(512), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    provider: Mapped[Provider] = relationship("Provider", back_populates="tokens")
