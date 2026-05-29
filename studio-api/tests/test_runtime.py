"""Tests for studio_api.runtime — ActorDef, ActorRuntime, helpers."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from studio_api.actor import PromptEventDef, StudioActor
from studio_api.runtime import ActorDef, ActorRuntime, _make_provider, _resolve


# ── ActorDef ──────────────────────────────────────────────────────────────────


def test_actor_def_defaults():
    d = ActorDef(id="urn:x", name="bot", define_prompt="You are a bot.")
    assert d.prompt_events == []
    assert d.cron_jobs == []
    assert d.outbox == {}


def test_actor_def_stores_fields():
    d = ActorDef(
        id="urn:x", name="bot", define_prompt="p",
        provider="gpt", model="gpt-4o", max_tokens=2048, max_history=5,
        prompt_events=[{"name": "e", "prompt": "ep"}],
        cron_jobs=[{"schedule": "* * * * *", "prompt": "cp"}],
        outbox={"other": "msg {output}"},
    )
    assert d.provider == "gpt"
    assert d.model == "gpt-4o"
    assert d.max_tokens == 2048
    assert d.max_history == 5
    assert d.prompt_events[0]["name"] == "e"
    assert d.cron_jobs[0]["schedule"] == "* * * * *"
    assert d.outbox["other"] == "msg {output}"


# ── _make_provider ────────────────────────────────────────────────────────────


def test_make_provider_claude():
    from actor_ai import Claude  # noqa: PLC0415
    p = _make_provider("claude", "claude-sonnet-4-6")
    assert isinstance(p, Claude)


def test_make_provider_gpt(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-for-unit-tests")
    from actor_ai import GPT  # noqa: PLC0415
    p = _make_provider("gpt", "gpt-4o")
    assert isinstance(p, GPT)


def test_make_provider_openai_alias(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-for-unit-tests")
    from actor_ai import GPT  # noqa: PLC0415
    p = _make_provider("openai", "gpt-4o")
    assert isinstance(p, GPT)


def test_make_provider_gemini(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-for-unit-tests")
    from actor_ai import Gemini  # noqa: PLC0415
    p = _make_provider("gemini", "gemini-pro")
    assert isinstance(p, Gemini)


def test_make_provider_unknown_falls_back_to_claude():
    from actor_ai import Claude  # noqa: PLC0415
    p = _make_provider("unknown-provider", "some-model")
    assert isinstance(p, Claude)


# ── _resolve ──────────────────────────────────────────────────────────────────


def test_resolve_raw_content_passthrough():
    connector = MagicMock()
    result = _resolve("You are a helpful assistant.", connector)
    assert result == "You are a helpful assistant."
    connector.resolve_uri_sync.assert_not_called()


def test_resolve_cantica_uri_delegates():
    connector = MagicMock()
    connector.resolve_uri_sync.return_value = "Resolved prompt content"
    result = _resolve("cantica://ns/name@v1", connector)
    assert result == "Resolved prompt content"
    connector.resolve_uri_sync.assert_called_once_with("cantica://ns/name@v1")


# ── ActorRuntime ──────────────────────────────────────────────────────────────


def _mock_connector(content: str = "System prompt from Cantica") -> MagicMock:
    m = MagicMock()
    m.resolve_uri_sync.return_value = content
    return m


def _actor_def(
    name: str = "test-actor",
    define_prompt: str = "You are a test actor.",
    **kwargs,
) -> ActorDef:
    return ActorDef(id=f"urn:x:{name}", name=name, define_prompt=define_prompt, **kwargs)


def test_list_running_empty():
    rt = ActorRuntime()
    assert rt.list_running() == []
    rt.stop_all()


def test_start_actor_appears_in_list():
    rt = ActorRuntime()
    connector = _mock_connector()

    with patch("studio_api.runtime._make_provider", return_value=None):
        defn = _actor_def()

        # Patch the dynamically-created subclass to avoid real pykka actors
        started_ref = MagicMock()
        started_ref.proxy.return_value = MagicMock()

        with patch("pykka.ThreadingActor.start", return_value=started_ref):
            rt.start(defn, connector)

        assert "test-actor" in rt.list_running()
    rt.stop_all()


def test_start_duplicate_raises():
    rt = ActorRuntime()
    connector = _mock_connector()

    started_ref = MagicMock()
    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=started_ref):
        rt.start(_actor_def(), connector)
        with pytest.raises(ValueError, match="already running"):
            rt.start(_actor_def(), connector)
    rt.stop_all()


def test_stop_removes_from_list():
    rt = ActorRuntime()
    connector = _mock_connector()

    started_ref = MagicMock()
    started_ref.stop = MagicMock()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=started_ref):
        rt.start(_actor_def(), connector)
        rt.stop("test-actor")

    assert "test-actor" not in rt.list_running()
    rt.stop_all()


def test_stop_unknown_raises():
    rt = ActorRuntime()
    with pytest.raises(KeyError, match="not running"):
        rt.stop("ghost-actor")
    rt.stop_all()


def test_stop_all_clears_list():
    rt = ActorRuntime()
    connector = _mock_connector()

    started_ref = MagicMock()
    started_ref.stop = MagicMock()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=started_ref):
        rt.start(_actor_def("a"), connector)
        rt.start(_actor_def("b"), connector)
        rt.stop_all()

    assert rt.list_running() == []


def test_instruct_calls_proxy():
    rt = ActorRuntime()
    connector = _mock_connector()

    proxy_mock = MagicMock()
    proxy_mock.instruct.return_value.get.return_value = "Great reply"
    started_ref = MagicMock()
    started_ref.proxy.return_value = proxy_mock

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=started_ref):
        rt.start(_actor_def(), connector)
        result = rt.instruct("test-actor", "Hello!")

    assert result == "Great reply"
    proxy_mock.instruct.assert_called_once_with("Hello!")
    rt.stop_all()


def test_instruct_unknown_actor_raises():
    rt = ActorRuntime()
    with pytest.raises(KeyError):
        rt.instruct("ghost", "hi")
    rt.stop_all()


def test_fire_event_calls_proxy():
    rt = ActorRuntime()
    connector = _mock_connector()

    proxy_mock = MagicMock()
    proxy_mock.fire_event.return_value.get.return_value = "Event output"
    started_ref = MagicMock()
    started_ref.proxy.return_value = proxy_mock

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=started_ref):
        rt.start(_actor_def(), connector)
        result = rt.fire_event("test-actor", "on-review", "some context")

    assert result == "Event output"
    proxy_mock.fire_event.assert_called_once_with("on-review", "some context")
    rt.stop_all()


def test_fire_event_unknown_actor_raises():
    rt = ActorRuntime()
    with pytest.raises(KeyError):
        rt.fire_event("ghost", "event", "ctx")
    rt.stop_all()


def test_prompt_resolution_at_start():
    """Cron and event prompts containing cantica:// URIs are resolved at startup."""
    rt = ActorRuntime()
    connector = _mock_connector("Resolved system prompt")

    defn = _actor_def(
        define_prompt="cantica://ns/role@v1",
        prompt_events=[{"name": "e", "prompt": "cantica://ns/evt@v1"}],
        cron_jobs=[{"schedule": "0 * * * *", "prompt": "cantica://ns/cron@v1"}],
    )

    started_ref = MagicMock()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=started_ref):
        rt.start(defn, connector)

    # Connector should have been called for define_prompt, event prompt, cron prompt
    assert connector.resolve_uri_sync.call_count == 3
    rt.stop_all()


def test_cron_schedule_parsing_five_fields():
    """Valid 5-field cron expression is registered without error."""
    rt = ActorRuntime()
    connector = _mock_connector()
    defn = _actor_def(cron_jobs=[{"schedule": "30 8 * * 1-5", "prompt": "morning brief"}])

    started_ref = MagicMock()
    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=started_ref):
        rt.start(defn, connector)  # must not raise

    assert rt._scheduler.get_jobs()  # at least one job registered
    rt.stop_all()
