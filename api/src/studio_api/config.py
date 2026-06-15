"""Settings loaded from environment variables (prefix: STUDIO_)."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class CanticaServerConfig:
    """One Cantica server the studio can fetch prompts from."""

    def __init__(self, url: str, auth_token: str = "") -> None:
        self.url = url.rstrip("/")
        self.auth_token = auth_token


class Settings(BaseSettings):
    """Studio API configuration."""

    workspace: Path = Path(".")
    port: int = 8043
    host: str = "127.0.0.1"
    log_level: str = "info"
    auth_enabled: bool = False  # set STUDIO_AUTH_ENABLED=true to enforce RS256 JWT

    # JSON string: '[{"url": "http://...", "auth_token": "..."}]'
    cantica_servers_raw: str = "[]"

    # Path to actor graph JSON-LD (relative to workspace)
    graph_file: str = ".vscode/actors.jsonld"

    model_config = SettingsConfigDict(env_prefix="STUDIO_")

    @field_validator("workspace", mode="before")
    @classmethod
    def resolve_workspace(cls, v: object) -> Path:
        return Path(str(v)).resolve()

    @property
    def cantica_servers(self) -> list[CanticaServerConfig]:
        try:
            raw = json.loads(self.cantica_servers_raw)
        except json.JSONDecodeError:
            return []
        return [
            CanticaServerConfig(s.get("url", ""), s.get("auth_token", ""))
            for s in raw
            if isinstance(s, dict) and s.get("url")
        ]

    @property
    def graph_path(self) -> Path:
        p = Path(self.graph_file)
        return p if p.is_absolute() else self.workspace / p


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
