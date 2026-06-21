"""SQLAlchemy engine, session factory, and declarative Base for the studio auth database."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session


class Base(DeclarativeBase):
    pass


def make_engine(db_path: Path) -> Engine:
    """Create a SQLite engine for the given path, enabling WAL and foreign keys."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{db_path}", echo=False, future=True)

    @event.listens_for(engine, "connect")
    def _configure(conn, _record):
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def new_session(engine: Engine) -> Session:
    return Session(engine, expire_on_commit=False)
