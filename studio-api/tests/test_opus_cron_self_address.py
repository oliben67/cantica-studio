"""Examples: Claude 3 Opus actor with a self-addressing cron every 2 minutes.

Three test groups illustrate the pattern from different angles:

API tests       POST /v1/runtime/actors — start the actor and probe via HTTP
Runtime tests   ActorRuntime unit tests — verify cron wiring and self-instruct
MCP tests       fire_event MCP tool — fire the time-check event and read the reply
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest
from fastapi.testclient import TestClient
from fastmcp import Client

import studio_api.mcp_server as mcp_mod
from studio_api.mcp_server import mcp
from studio_api.runtime import ActorDef, ActorRuntime
from studio_api.workspace_fs import WorkspaceFS

# ── shared helpers ────────────────────────────────────────────────────────────

OPUS_MODEL = "claude-3-opus-20240229"
CRON_EVERY_TWO = "*/2 * * * *"
TIME_PROMPT = "What time is it?"


def _actor_def(**kwargs) -> ActorDef:
    defaults = dict(
        id="urn:cantica:studio:actor:time-checker",
        name="time-checker",
        define_prompt="You are a helpful assistant. Answer concisely.",
        provider="claude",
        model=OPUS_MODEL,
    )
    defaults.update(kwargs)
    return ActorDef(**defaults)


def _mock_connector() -> MagicMock:
    m = MagicMock()
    m.resolve_uri_sync.return_value = "You are a helpful assistant. Answer concisely."
    return m


# ── API tests (via HTTP TestClient) ──────────────────────────────────────────


def test_start_opus_actor_with_self_addressing_cron(
    client: TestClient, mock_runtime: ActorRuntime
) -> None:
    """POST /v1/runtime/actors starts a Claude 3 Opus actor with a */2 cron."""
    mock_runtime.start = MagicMock()
    body = {
        "name": "time-checker",
        "define_prompt": "You are a helpful assistant. Answer concisely.",
        "provider": "claude",
        "model": OPUS_MODEL,
        "cron_jobs": [{"schedule": CRON_EVERY_TWO, "prompt": TIME_PROMPT, "name": "what-time"}],
    }

    r = client.post("/v1/runtime/actors", json=body)

    assert r.status_code == 201
    assert r.json()["name"] == "time-checker"
    assert r.json()["status"] == "running"

    defn: ActorDef = mock_runtime.start.call_args[0][0]
    assert defn.model == OPUS_MODEL
    assert defn.provider == "claude"
    assert len(defn.cron_jobs) == 1
    assert defn.cron_jobs[0]["schedule"] == CRON_EVERY_TWO
    assert defn.cron_jobs[0]["prompt"] == TIME_PROMPT


def test_instruct_opus_actor_with_time_question(
    client: TestClient, mock_runtime: ActorRuntime
) -> None:
    """POST /v1/runtime/actors/{name}/instruct — actor replies to 'What time is it?'."""
    mock_runtime.instruct = MagicMock(return_value="It is 14:00 UTC.")

    r = client.post(
        "/v1/runtime/actors/time-checker/instruct",
        json={"instruction": TIME_PROMPT},
    )

    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "time-checker"
    assert "14:00" in data["output"]
    mock_runtime.instruct.assert_called_once_with("time-checker", TIME_PROMPT)


def test_instruct_examines_response_contains_time_marker(
    client: TestClient, mock_runtime: ActorRuntime
) -> None:
    """Response from a time query must include a time-like string."""
    mock_runtime.instruct = MagicMock(return_value="The current time is 09:42 AM.")

    r = client.post(
        "/v1/runtime/actors/time-checker/instruct",
        json={"instruction": TIME_PROMPT},
    )

    output: str = r.json()["output"]
    assert any(c.isdigit() for c in output), "Response should contain a time value"
    assert ":" in output, "Response should contain a colon (HH:MM format)"


def test_list_actors_shows_running_time_checker(
    client: TestClient, mock_runtime: ActorRuntime
) -> None:
    """GET /v1/runtime/actors — time-checker appears once started."""
    mock_runtime.list_running.return_value = ["time-checker"]

    r = client.get("/v1/runtime/actors")

    assert r.status_code == 200
    assert "time-checker" in r.json()


def test_stop_opus_actor(client: TestClient, mock_runtime: ActorRuntime) -> None:
    """DELETE /v1/runtime/actors/{name} — stops the time-checker actor."""
    mock_runtime.stop = MagicMock()

    r = client.delete("/v1/runtime/actors/time-checker")

    assert r.status_code == 204
    mock_runtime.stop.assert_called_once_with("time-checker")


# ── Runtime unit tests ────────────────────────────────────────────────────────


def test_runtime_starts_opus_actor_with_correct_model() -> None:
    """ActorRuntime stores the Opus model in the actor class attributes."""
    rt = ActorRuntime()
    connector = _mock_connector()

    ref = MagicMock()
    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_actor_def(), connector)

    assert "time-checker" in rt.list_running()
    defn = rt._defs["time-checker"]
    assert defn.model == OPUS_MODEL
    rt.stop_all()


def test_cron_registered_for_every_two_minutes() -> None:
    """*/2 * * * * schedule produces exactly one APScheduler job."""
    rt = ActorRuntime()
    connector = _mock_connector()

    ref = MagicMock()
    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(
            _actor_def(cron_jobs=[{"schedule": CRON_EVERY_TWO, "prompt": TIME_PROMPT, "name": "what-time"}]),
            connector,
        )

    jobs = rt._scheduler.get_jobs()
    assert len(jobs) == 1
    assert jobs[0].id.startswith("cron-time-checker-")
    rt.stop_all()


def test_cron_fires_instruct_with_time_prompt_on_self() -> None:
    """When the cron fires, it calls instruct(TIME_PROMPT) on the actor itself."""
    rt = ActorRuntime()
    connector = _mock_connector()

    proxy = MagicMock()
    proxy.instruct.return_value.get.return_value = "It is 14:02 UTC."
    ref = MagicMock()
    ref.proxy.return_value = proxy

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(
            _actor_def(cron_jobs=[{"schedule": CRON_EVERY_TWO, "prompt": TIME_PROMPT, "name": "what-time"}]),
            connector,
        )

    # Manually trigger the cron callback (simulates the 2-minute tick)
    job = rt._scheduler.get_jobs()[0]
    job.func()

    proxy.instruct.assert_called_once_with(TIME_PROMPT)
    response: str = proxy.instruct.return_value.get.return_value
    assert "14:02" in response
    rt.stop_all()


def test_cron_self_address_no_target_actor() -> None:
    """No targetActor configured — output stays on the actor itself (self-loop)."""
    rt = ActorRuntime()
    connector = _mock_connector()

    proxy = MagicMock()
    proxy.instruct.return_value.get.return_value = "It is noon."
    ref = MagicMock()
    ref.proxy.return_value = proxy

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(
            _actor_def(
                cron_jobs=[{"schedule": CRON_EVERY_TWO, "prompt": TIME_PROMPT, "name": "what-time"}]
            ),
            connector,
        )

    job = rt._scheduler.get_jobs()[0]
    job.func()

    # instruct was called exactly once (on self); no forwarding call to a second actor
    assert proxy.instruct.call_count == 1
    assert proxy.instruct.call_args == call(TIME_PROMPT)
    rt.stop_all()


def test_runtime_instruct_returns_opus_response() -> None:
    """ActorRuntime.instruct("time-checker", ...) returns the LLM reply."""
    rt = ActorRuntime()
    connector = _mock_connector()

    proxy = MagicMock()
    proxy.instruct.return_value.get.return_value = "It is 10:30 AM."
    ref = MagicMock()
    ref.proxy.return_value = proxy

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_actor_def(), connector)

    response = rt.instruct("time-checker", TIME_PROMPT)

    assert response == "It is 10:30 AM."
    proxy.instruct.assert_called_once_with(TIME_PROMPT)
    rt.stop_all()


# ── MCP tests (via fire_event tool) ──────────────────────────────────────────


@pytest.fixture
def mcp_with_opus_actor(tmp_path: Path) -> ActorRuntime:
    """MCP env with a running Opus actor that has a 'what-time' prompt event."""
    rt = ActorRuntime()
    connector = _mock_connector()

    proxy = MagicMock()
    proxy.instruct.return_value.get.return_value = "It is 16:00 UTC."
    ref = MagicMock()
    ref.proxy.return_value = proxy

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(
            _actor_def(
                prompt_events=[{"name": "what-time", "prompt": TIME_PROMPT}],
                cron_jobs=[{"schedule": CRON_EVERY_TWO, "prompt": TIME_PROMPT, "name": "what-time"}],
            ),
            connector,
        )

    fs = WorkspaceFS(tmp_path)
    mcp_mod.init(fs, rt)
    yield rt
    mcp_mod._fs = None
    mcp_mod._rt = None
    rt.stop_all()


async def test_mcp_fire_event_sends_time_prompt(mcp_with_opus_actor: ActorRuntime) -> None:
    """MCP fire_event('time-checker', 'what-time') triggers the actor and returns its reply."""
    async with Client(mcp) as client:
        result = await client.call_tool(
            "fire_event",
            {"actor_name": "time-checker", "event_name": "what-time", "context": ""},
        )

    assert "16:00" in result.data


async def test_mcp_fire_event_with_context(mcp_with_opus_actor: ActorRuntime) -> None:
    """Extra context is appended to the prompt before the actor sees it."""
    async with Client(mcp) as client:
        result = await client.call_tool(
            "fire_event",
            {
                "actor_name": "time-checker",
                "event_name": "what-time",
                "context": "User is in Europe/Paris timezone.",
            },
        )

    assert result.data is not None


async def test_mcp_fire_event_unknown_actor_raises(mcp_with_opus_actor: ActorRuntime) -> None:
    """Firing an event on a non-existent actor raises a ToolError."""
    from fastmcp.exceptions import ToolError  # noqa: PLC0415

    async with Client(mcp) as client:
        with pytest.raises(ToolError):
            await client.call_tool(
                "fire_event",
                {"actor_name": "ghost", "event_name": "what-time"},
            )


async def test_mcp_fire_event_unknown_event_raises(mcp_with_opus_actor: ActorRuntime) -> None:
    """Firing an unknown event name on a known actor raises an error from the MCP layer."""
    async with Client(mcp) as client:
        with pytest.raises((Exception,)):
            await client.call_tool(
                "fire_event",
                {"actor_name": "time-checker", "event_name": "no-such-event"},
            )
