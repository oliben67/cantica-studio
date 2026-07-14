"""Minimal startup migrations for the SQLite auth database.

`Base.metadata.create_all` creates missing *tables* but never adds *columns*
to existing ones. This module applies the small set of additive changes that
create_all cannot express, idempotently, at startup. If the schema ever needs
more than ADD COLUMN / CREATE INDEX, switch to Alembic.
"""

from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

log = logging.getLogger(__name__)

# (table, column, DDL type) — applied only when the column is missing.
_ADD_COLUMNS: list[tuple[str, str, str]] = [
    ("users", "e_user_id", "VARCHAR(255)"),
]

# Raw index DDL — must be idempotent (IF NOT EXISTS).
_INDEXES: list[str] = [
    # Partial unique index: e_user_id must be unique when set, NULLs unrestricted.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_e_user_id "
    "ON users (e_user_id) WHERE e_user_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS ix_users_e_user_id ON users (e_user_id)",
]


def migrate(engine: Engine) -> None:
    """Apply additive schema migrations. Safe to run on every startup."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, column, ddl_type in _ADD_COLUMNS:
            if table not in inspector.get_table_names():
                continue  # create_all will create it with the column included
            existing = {c["name"] for c in inspector.get_columns(table)}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
                log.info("Migrated: added %s.%s", table, column)
        for ddl in _INDEXES:
            conn.execute(text(ddl))
