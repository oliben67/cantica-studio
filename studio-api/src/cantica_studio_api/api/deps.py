"""FastAPI dependency helpers for Cantica Studio API."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from cantica.services.version_store import VersionStore
from cantica_studio_api.config import Settings, get_settings


@lru_cache
def get_store() -> VersionStore:
    """Return the process-wide ``VersionStore`` singleton."""
    settings = get_settings()
    settings.vault_path.mkdir(parents=True, exist_ok=True)
    settings.templates_path.mkdir(parents=True, exist_ok=True)
    return VersionStore(settings.vault_path)


StoreDep = Annotated[VersionStore, Depends(get_store)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
