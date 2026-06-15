"""Tests for /v1/runtime/actors endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from studio_api.runtime import ActorRuntime


# ── GET /v1/runtime/actors ────────────────────────────────────────────────────


def test_list_actors_empty(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.list_running.return_value = []
    r = client.get("/v1/runtime/actors")
    assert r.status_code == 200
    assert r.json() == []


def test_list_actors_running(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.list_running.return_value = ["architect", "reviewer"]
    r = client.get("/v1/runtime/actors")
    assert r.status_code == 200
    assert r.json() == ["architect", "reviewer"]


# ── POST /v1/runtime/actors ───────────────────────────────────────────────────


def test_start_actor_success(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.start = MagicMock(return_value=None)
    body = {
        "name": "bot",
        "define_prompt": "You are a bot.",
        "provider": "claude",
        "model": "claude-sonnet-4-6",
    }
    r = client.post("/v1/runtime/actors", json=body)
    assert r.status_code == 201
    assert r.json()["name"] == "bot"
    assert r.json()["status"] == "running"
    assert "initial_output" not in r.json()
    mock_runtime.start.assert_called_once()


def test_start_actor_returns_initial_output(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.start = MagicMock(return_value="I am ready to help.")
    r = client.post("/v1/runtime/actors", json={"name": "bot", "define_prompt": "You are a bot."})
    assert r.status_code == 201
    assert r.json()["initial_output"] == "I am ready to help."


def test_start_actor_duplicate_returns_409(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.start = MagicMock(side_effect=ValueError("already running"))
    r = client.post("/v1/runtime/actors", json={"name": "bot", "define_prompt": "p"})
    assert r.status_code == 409


def test_start_actor_internal_error_returns_500(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.start = MagicMock(side_effect=RuntimeError("boom"))
    r = client.post("/v1/runtime/actors", json={"name": "bot", "define_prompt": "p"})
    assert r.status_code == 500


def test_start_actor_with_events_and_crons(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.start = MagicMock(return_value=None)
    body = {
        "name": "complex-bot",
        "define_prompt": "p",
        "prompt_events": [{"name": "on-save", "prompt": "Check this"}],
        "cron_jobs": [{"schedule": "0 9 * * 1-5", "prompt": "Morning brief", "name": "morning-brief"}],
        "outbox": {"reviewer": "Review: {output}"},
    }
    r = client.post("/v1/runtime/actors", json=body)
    assert r.status_code == 201
    call_args = mock_runtime.start.call_args[0][0]
    assert call_args.name == "complex-bot"
    assert len(call_args.prompt_events) == 1
    assert len(call_args.cron_jobs) == 1
    assert call_args.outbox == {"reviewer": "Review: {output}"}


def test_start_actor_with_directory(client: TestClient, mock_runtime: ActorRuntime):
    """directory field is forwarded to ActorDef and included in response."""
    mock_runtime.start = MagicMock(return_value=None)
    r = client.post("/v1/runtime/actors", json={
        "name": "scoped-bot",
        "define_prompt": "p",
        "directory": "src/agents",
    })
    assert r.status_code == 201
    defn = mock_runtime.start.call_args[0][0]
    assert defn.directory == "src/agents"


def test_start_actor_without_directory_defaults_to_empty(client: TestClient, mock_runtime: ActorRuntime):
    """Omitting directory in the request leaves ActorDef.directory as ''."""
    mock_runtime.start = MagicMock(return_value=None)
    r = client.post("/v1/runtime/actors", json={"name": "plain-bot", "define_prompt": "p"})
    assert r.status_code == 201
    defn = mock_runtime.start.call_args[0][0]
    assert defn.directory == ""


# ── DELETE /v1/runtime/actors/{name} ─────────────────────────────────────────


def test_stop_actor_success(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.stop = MagicMock()
    r = client.delete("/v1/runtime/actors/bot")
    assert r.status_code == 204
    mock_runtime.stop.assert_called_once_with("bot")


def test_stop_actor_not_found_returns_404(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.stop = MagicMock(side_effect=KeyError("not running"))
    r = client.delete("/v1/runtime/actors/ghost")
    assert r.status_code == 404


# ── POST /v1/runtime/actors/{name}/instruct ───────────────────────────────────


def test_instruct_actor_success(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.instruct = MagicMock(return_value="Great response")
    r = client.post("/v1/runtime/actors/bot/instruct", json={"instruction": "Hello!"})
    assert r.status_code == 200
    assert r.json()["output"] == "Great response"
    assert r.json()["name"] == "bot"
    mock_runtime.instruct.assert_called_once_with("bot", "Hello!")


def test_instruct_actor_not_found_returns_404(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.instruct = MagicMock(side_effect=KeyError("not running"))
    r = client.post("/v1/runtime/actors/ghost/instruct", json={"instruction": "hi"})
    assert r.status_code == 404


def test_instruct_actor_internal_error_returns_500(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.instruct = MagicMock(side_effect=RuntimeError("LLM timeout"))
    r = client.post("/v1/runtime/actors/bot/instruct", json={"instruction": "hi"})
    assert r.status_code == 500


# ── POST /v1/runtime/actors/{name}/event/{event_name} ────────────────────────


def test_fire_event_success(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.fire_event = MagicMock(return_value={"output": "Event output", "forwarded": []})
    r = client.post("/v1/runtime/actors/bot/event/on-review", json={"context": "main.py"})
    assert r.status_code == 200
    assert r.json()["output"] == "Event output"
    assert r.json()["name"] == "bot"
    assert r.json()["event"] == "on-review"
    mock_runtime.fire_event.assert_called_once_with("bot", "on-review", "main.py")


def test_fire_event_no_context(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.fire_event = MagicMock(return_value={"output": "ok", "forwarded": []})
    r = client.post("/v1/runtime/actors/bot/event/ping", json={})
    assert r.status_code == 200
    mock_runtime.fire_event.assert_called_once_with("bot", "ping", "")


def test_fire_event_actor_not_found_returns_404(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.fire_event = MagicMock(side_effect=KeyError("not running"))
    r = client.post("/v1/runtime/actors/ghost/event/evt", json={})
    assert r.status_code == 404


def test_fire_event_unknown_event_returns_422(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.fire_event = MagicMock(side_effect=ValueError("Unknown event"))
    r = client.post("/v1/runtime/actors/bot/event/bad-event", json={})
    assert r.status_code == 422


def test_fire_event_internal_error_returns_500(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.fire_event = MagicMock(side_effect=RuntimeError("crash"))
    r = client.post("/v1/runtime/actors/bot/event/evt", json={})
    assert r.status_code == 500


# ── GET /v1/runtime/actors/{name}/events ─────────────────────────────────────


def test_list_actor_events_success(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_events.return_value = [{"name": "analyze"}, {"name": "review"}]
    r = client.get("/v1/runtime/actors/bot/events")
    assert r.status_code == 200
    names = [e["name"] for e in r.json()]
    assert "analyze" in names
    assert "review" in names
    mock_runtime.get_actor_events.assert_called_once_with("bot")


def test_list_actor_events_empty(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_events.return_value = []
    r = client.get("/v1/runtime/actors/ai-bot/events")
    assert r.status_code == 200
    assert r.json() == []


def test_list_actor_events_not_found_returns_404(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_events.side_effect = KeyError("not running")
    r = client.get("/v1/runtime/actors/ghost/events")
    assert r.status_code == 404


# ── GET /v1/runtime/actors/{name}/crons ──────────────────────────────────────


def test_list_actor_crons_success(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_crons.return_value = [{"name": "daily", "schedule": "0 9 * * *"}]
    r = client.get("/v1/runtime/actors/bot/crons")
    assert r.status_code == 200
    assert r.json()[0]["name"] == "daily"
    mock_runtime.get_actor_crons.assert_called_once_with("bot")


def test_list_actor_crons_not_found_returns_404(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_crons.side_effect = KeyError("not running")
    r = client.get("/v1/runtime/actors/ghost/crons")
    assert r.status_code == 404


# ── GET /v1/runtime/actors/{name}/chat ───────────────────────────────────────


def test_get_actor_chat_success(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_chat.return_value = "line1\nline2"
    r = client.get("/v1/runtime/actors/bot/chat")
    assert r.status_code == 200
    assert r.json()["chat"] == "line1\nline2"
    assert r.json()["name"] == "bot"
    mock_runtime.get_actor_chat.assert_called_once_with("bot")


def test_get_actor_chat_not_found_returns_404(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_chat.side_effect = KeyError("not running")
    r = client.get("/v1/runtime/actors/ghost/chat")
    assert r.status_code == 404


def test_get_actor_chat_error_returns_500(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_chat.side_effect = RuntimeError("timeout")
    r = client.get("/v1/runtime/actors/bot/chat")
    assert r.status_code == 500


# ── GET /v1/runtime/actors/{name}/type ───────────────────────────────────────


def test_get_actor_type_ai(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_type.return_value = "ai"
    r = client.get("/v1/runtime/actors/ai-bot/type")
    assert r.status_code == 200
    assert r.json() == {"name": "ai-bot", "actor_type": "ai"}


def test_get_actor_type_python(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_type.return_value = "python"
    r = client.get("/v1/runtime/actors/worker/type")
    assert r.status_code == 200
    assert r.json()["actor_type"] == "python"


def test_get_actor_type_not_found_returns_404(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_actor_type.side_effect = KeyError("not running")
    r = client.get("/v1/runtime/actors/ghost/type")
    assert r.status_code == 404


# ── POST /v1/runtime/actors — actor_type field ───────────────────────────────


def test_start_actor_includes_actor_type_in_response(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.start = MagicMock(return_value=None)
    r = client.post("/v1/runtime/actors", json={
        "name": "worker", "actor_type": "python", "script_path": "/tmp/w.py",
    })
    assert r.status_code == 201
    assert r.json()["actor_type"] == "python"


def test_start_actor_passes_script_fields(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.start = MagicMock(return_value=None)
    r = client.post("/v1/runtime/actors", json={
        "name": "ts-worker", "actor_type": "typescript",
        "script_path": "/app/worker.js", "script_command": "bun",
    })
    assert r.status_code == 201
    call_args = mock_runtime.start.call_args[0][0]
    assert call_args.actor_type == "typescript"
    assert call_args.script_path == "/app/worker.js"
    assert call_args.script_command == "bun"


# ── GET /v1/runtime/notifications ────────────────────────────────────────────


def test_drain_notifications_empty(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.drain_notifications = MagicMock(return_value=[])
    r = client.get("/v1/runtime/notifications")
    assert r.status_code == 200
    assert r.json() == []


def test_drain_notifications_returns_log(client: TestClient, mock_runtime: ActorRuntime):
    notes = [{"name": "bot-b", "prompt": "hello", "output": "world"}]
    mock_runtime.drain_notifications = MagicMock(return_value=notes)
    r = client.get("/v1/runtime/notifications")
    assert r.status_code == 200
    assert r.json() == notes
    mock_runtime.drain_notifications.assert_called_once()
