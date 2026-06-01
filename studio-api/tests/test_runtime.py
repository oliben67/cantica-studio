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


# ── ActorDef None-field defaulting ────────────────────────────────────────────


def test_actor_def_none_prompt_events_becomes_empty_list():
    d = ActorDef(id="urn:x", name="b", define_prompt="p", prompt_events=None)
    assert d.prompt_events == []


def test_actor_def_none_cron_jobs_becomes_empty_list():
    d = ActorDef(id="urn:x", name="b", define_prompt="p", cron_jobs=None)
    assert d.cron_jobs == []


def test_actor_def_none_outbox_becomes_empty_dict():
    d = ActorDef(id="urn:x", name="b", define_prompt="p", outbox=None)
    assert d.outbox == {}


def test_actor_def_none_resources_becomes_empty_list():
    d = ActorDef(id="urn:x", name="b", define_prompt="p", resources=None)
    assert d.resources == []


def test_actor_def_code_fields():
    d = ActorDef(
        id="urn:x", name="w", define_prompt="",
        actor_type="python", script_path="/a/b.py", script_command="python3",
    )
    assert d.actor_type == "python"
    assert d.script_path == "/a/b.py"
    assert d.script_command == "python3"


# ── fire_event routing to target actor ────────────────────────────────────────


def test_fire_event_routes_output_to_target_actor():
    """When an event has targetActor, the output is forwarded there."""
    rt = ActorRuntime()
    connector = _mock_connector()

    proxy_a = MagicMock()
    proxy_a.fire_event.return_value.get.return_value = "source-output"
    proxy_b = MagicMock()
    proxy_b.instruct.return_value.get.return_value = "target-reply"

    ref_a = MagicMock()
    ref_a.proxy.return_value = proxy_a
    ref_b = MagicMock()
    ref_b.proxy.return_value = proxy_b

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", side_effect=[ref_a, ref_b]):
        rt.start(
            _actor_def(
                "source",
                prompt_events=[{"name": "process", "prompt": "p",
                                "targetActor": "target", "targetEvent": ""}],
            ),
            connector,
        )
        rt.start(_actor_def("target"), connector)

    result = rt.fire_event("source", "process", "ctx")
    assert result == "target-reply"
    proxy_b.instruct.assert_called_once_with("source-output")
    rt.stop_all()


def test_fire_event_routes_to_target_event():
    """targetActor + targetEvent causes fire_event on the target."""
    rt = ActorRuntime()
    connector = _mock_connector()

    proxy_a = MagicMock()
    proxy_a.fire_event.return_value.get.return_value = "a-output"
    proxy_b = MagicMock()
    proxy_b.fire_event.return_value.get.return_value = "b-event-reply"

    ref_a = MagicMock()
    ref_a.proxy.return_value = proxy_a
    ref_b = MagicMock()
    ref_b.proxy.return_value = proxy_b

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", side_effect=[ref_a, ref_b]):
        rt.start(
            _actor_def(
                "source",
                prompt_events=[{"name": "process", "prompt": "p",
                                "targetActor": "target", "targetEvent": "on-input"}],
            ),
            connector,
        )
        rt.start(_actor_def("target"), connector)

    result = rt.fire_event("source", "process", "ctx")
    assert result == "b-event-reply"
    rt.stop_all()


def test_fire_event_unknown_actor_raises():
    rt = ActorRuntime()
    with pytest.raises(KeyError):
        rt.fire_event("ghost", "event")
    rt.stop_all()


# ── Python code actor TypeScript branch ───────────────────────────────────────


def test_start_typescript_code_actor(tmp_path):
    """TypeScript actor path is exercised (subprocess is mocked)."""
    import json, queue  # noqa: PLC0415
    from unittest.mock import patch  # noqa: PLC0415

    class _FakeProc:
        def __init__(self):
            self._q = queue.Queue()
            self._q.put(json.dumps({"type": "ready", "events": [{"name": "ping"}], "crons": []}) + "\n")
            self.stdin = self
            self.stderr = __import__("io").StringIO("")
        @property
        def stdout(self): return self
        def __iter__(self):
            while True:
                line = self._q.get()
                if line is None: return
                yield line
        def write(self, d): pass
        def flush(self): pass
        def terminate(self): self._q.put(None)
        def wait(self, timeout=None): return 0

    proc = _FakeProc()
    rt = ActorRuntime()
    defn = ActorDef(
        id="urn:x:ts",
        name="ts-worker",
        define_prompt="",
        actor_type="typescript",
        script_path="/fake/script.js",
        script_command="node",
    )
    with patch("studio_api.code_actor.subprocess.Popen", return_value=proc):
        rt.start(defn, MagicMock())

    assert "ts-worker" in rt.list_running()
    assert rt.get_actor_type("ts-worker") == "typescript"
    events = rt.get_actor_events("ts-worker")
    assert any(e["name"] == "ping" for e in events)
    rt.stop_all()


# ── Code cron registration ────────────────────────────────────────────────────


def test_code_cron_invalid_schedule_warns(tmp_path):
    """An invalid cron schedule is caught and logged as a warning (no crash)."""
    p = tmp_path / "act.py"
    p.write_text(
        "from actor_ai.code_actor import cron\n"
        "@cron('not-a-valid-cron')\ndef job(): return ''\n",
        encoding="utf-8",
    )
    rt = ActorRuntime()
    rt.start(
        ActorDef(id="urn:x", name="bad-cron", define_prompt="", actor_type="python",
                 script_path=str(p)),
        MagicMock(),
    )
    # No exception raised — bad cron is warned and skipped
    assert "bad-cron" in rt.list_running()
    rt.stop_all()


# ── get_actor_logs for AI actor returns empty string ─────────────────────────


def test_get_actor_logs_ai_actor_returns_empty():
    rt = ActorRuntime()
    connector = _mock_connector()

    proxy_mock = MagicMock()
    proxy_mock.get_logs.return_value.get.return_value = ""
    started_ref = MagicMock()
    started_ref.proxy.return_value = proxy_mock

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=started_ref):
        rt.start(_actor_def(), connector)
        result = rt.get_actor_logs("test-actor")

    # get_logs is attempted; returns empty string
    assert result == ""
    rt.stop_all()


# ── Invalid cron in AI actor schedule ────────────────────────────────────────


def test_invalid_ai_cron_schedule_warns_not_raises():
    rt = ActorRuntime()
    connector = _mock_connector()
    defn = _actor_def(cron_jobs=[{"schedule": "not-valid", "prompt": "p"}])

    started_ref = MagicMock()
    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=started_ref):
        rt.start(defn, connector)  # must not raise

    assert "test-actor" in rt.list_running()
    rt.stop_all()
