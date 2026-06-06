"""Providers endpoint — returns available models per configured provider."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query

_log = logging.getLogger(__name__)
router = APIRouter()


def _models_for(provider_key: str, refresh: bool = False) -> list[str]:
    from actor_ai import Claude, Copilot, Gemini, GPT, Mistral  # noqa: PLC0415

    try:
        if provider_key == "copilot":
            # available_models is a classmethod — no instance needed.
            # Always use_sdk=True; fall back to MODELS if the SDK call fails.
            try:
                return Copilot.available_models(refresh=refresh, use_sdk=True)
            except Exception as sdk_exc:
                _log.warning("Copilot SDK available_models failed: %s", sdk_exc)
                return sorted(Copilot.MODELS)

        p: object
        if provider_key == "claude":
            p = Claude("claude-sonnet-4-6")
        elif provider_key == "gpt":
            p = GPT("gpt-4o")
        elif provider_key == "gemini":
            p = Gemini("gemini-2.0-flash")
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
async def provider_models(
    refresh: bool = Query(default=False, description="Clear server-side cache before fetching"),
) -> dict[str, list[str]]:
    """Return available model IDs for every configured provider."""
    import asyncio  # noqa: PLC0415

    loop = asyncio.get_event_loop()
    results = await asyncio.gather(
        *[loop.run_in_executor(None, _models_for, key, refresh) for key in _PROVIDERS]
    )
    return {key: models for key, models in zip(_PROVIDERS, results)}
