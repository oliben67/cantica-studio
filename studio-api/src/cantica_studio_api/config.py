"""
Configuration for Cantica Studio API.

All settings are read from environment variables prefixed with ``CANTICA_``.

Key variables
-------------
``CANTICA_HOME``   (Path, default ``~/.cantica``)
    Root of the Cantica home directory.  Sub-paths derived automatically:

    * ``CANTICA_HOME/vault``      — SQLite DB and blob store
    * ``CANTICA_HOME/templates``  — AIActor prompt templates (future)
    * ``CANTICA_HOME/auth.yaml``  — auth configuration (future)

``CANTICA_PORT``   (int, default 8043)
    Bind port for the studio server (separate from cantica-api at 8042).

``CANTICA_HOST``   (str, default "127.0.0.1")
    Bind address.  Defaults to localhost-only for the studio container.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment (prefix: ``CANTICA_``)."""

    home: Path = Path.home() / ".cantica"
    port: int = 8043
    host: str = "127.0.0.1"
    log_level: str = "info"

    model_config = SettingsConfigDict(env_prefix="CANTICA_", env_file=".env")

    @property
    def vault_path(self) -> Path:
        """Path to the SQLite/blob-store vault."""
        return self.home / "vault"

    @property
    def templates_path(self) -> Path:
        """Path to the AIActor template directory (read at runtime)."""
        return self.home / "templates"


@lru_cache
def get_settings() -> Settings:
    """Return the cached ``Settings`` singleton."""
    return Settings()
