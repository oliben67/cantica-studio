"""Providers endpoint — returns available models per configured provider."""

from __future__ import annotations

import logging

from fastapi import APIRouter

_log = logging.getLogger(__name__)
router = APIRouter()


def _models_for(provider_key: str) -> list[str]:
    from actor_ai import Claude, Copilot, Gemini, GPT, Mistral  # noqa: PLC0415

    try:
        p: object
        if provider_key == "claude":
            p = Claude("claude-sonnet-4-6")
        elif provider_key == "gpt":
            p = GPT("gpt-4o")
        elif provider_key == "gemini":
            p = Gemini("gemini-2.0-flash")
        elif provider_key == "copilot":
            p = Copilot("gpt-4o", use_sdk=True)
        elif provider_key == "mistral":
            p = Mistral("mistral-large-latest")
        else:
            return []
        return p.available_models()  # type: ignore[union-attr]
    except Exception as exc:
        _log.warning("available_models failed for %r: %s", provider_key, exc)
        return []


_PROVIDERS = ["claude", "gpt", "gemini", "copilot", "mistral"]


@router.get("/models")
async def provider_models() -> dict[str, list[str]]:
    """Return available model IDs for every configured provider."""
    import asyncio  # noqa: PLC0415

    loop = asyncio.get_event_loop()
    results = await asyncio.gather(
        *[loop.run_in_executor(None, _models_for, key) for key in _PROVIDERS]
    )
    return {key: models for key, models in zip(_PROVIDERS, results)}
