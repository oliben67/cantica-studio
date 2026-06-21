"""Access records — named collections of provider credentials."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class ProviderCredentials:
    """API keys and tokens for LLM / tool providers."""

    anthropic_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""
    github_token: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "anthropic_api_key": self.anthropic_api_key,
            "openai_api_key": self.openai_api_key,
            "gemini_api_key": self.gemini_api_key,
            "github_token": self.github_token,
        }

    def presence(self) -> dict[str, bool]:
        """Return which credentials are non-empty, without exposing values."""
        return {k: bool(v) for k, v in self.to_dict().items()}


LOCAL_ACCESS_ID = "local"


@dataclass
class AccessRecord:
    """A named set of provider credentials."""

    id: str
    name: str
    credentials: ProviderCredentials = field(default_factory=ProviderCredentials)
    readonly: bool = False

    def to_response(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "readonly": self.readonly,
            "credentials": self.credentials.presence(),
        }


class AccessStore:
    """Manages named access records.

    In local mode a single read-only record is auto-created from environment
    variables.  Mutation is disallowed in local mode.
    """

    def __init__(self, *, local_mode: bool = True) -> None:
        self._local_mode = local_mode
        self._records: dict[str, AccessRecord] = {}
        if local_mode:
            self._records[LOCAL_ACCESS_ID] = AccessRecord(
                id=LOCAL_ACCESS_ID,
                name="Local Settings",
                readonly=True,
                credentials=ProviderCredentials(
                    anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
                    openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
                    gemini_api_key=os.environ.get("GEMINI_API_KEY", ""),
                    github_token=os.environ.get("GITHUB_TOKEN", ""),
                ),
            )

    @property
    def local_mode(self) -> bool:
        return self._local_mode

    def list(self) -> list[AccessRecord]:
        return list(self._records.values())

    def get(self, access_id: str) -> AccessRecord | None:
        return self._records.get(access_id)

    def put(self, record: AccessRecord) -> None:
        if self._local_mode:
            raise ValueError("Access records are read-only in local mode")
        existing = self._records.get(record.id)
        if existing is not None and existing.readonly:
            raise ValueError(f"Access record {record.id!r} is read-only")
        self._records[record.id] = record

    def delete(self, access_id: str) -> None:
        if self._local_mode:
            raise ValueError("Access records are read-only in local mode")
        record = self._records.get(access_id)
        if record is None:
            raise KeyError(access_id)
        if record.readonly:
            raise ValueError(f"Access record {access_id!r} is read-only")
        del self._records[access_id]
