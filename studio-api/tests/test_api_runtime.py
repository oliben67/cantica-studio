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
    mock_runtime.start = MagicMock()
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
    mock_runtime.start.assert_called_once()


def test_start_actor_duplicate_returns_409(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.start = MagicMock(side_effect=ValueError("already running"))
    r = client.post("/v1/runtime/actors", json={"name": "bot", "define_prompt": "p"})
    assert r.status_code == 409


def test_start_actor_internal_error_returns_500(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.start = MagicMock(side_effect=RuntimeError("boom"))
    r = client.post("/v1/runtime/actors", json={"name": "bot", "define_prompt": "p"})
    assert r.status_code == 500


def test_start_actor_with_events_and_crons(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.start = MagicMock()
    body = {
        "name": "complex-bot",
        "define_prompt": "p",
        "prompt_events": [{"name": "on-save", "prompt": "Check this"}],
        "cron_jobs": [{"schedule": "0 9 * * 1-5", "prompt": "Morning brief"}],
        "outbox": {"reviewer": "Review: {output}"},
    }
    r = client.post("/v1/runtime/actors", json=body)
    assert r.status_code == 201
    call_args = mock_runtime.start.call_args[0][0]
    assert call_args.name == "complex-bot"
    assert len(call_args.prompt_events) == 1
    assert len(call_args.cron_jobs) == 1
    assert call_args.outbox == {"reviewer": "Review: {output}"}


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
    mock_runtime.fire_event = MagicMock(return_value="Event output")
    r = client.post("/v1/runtime/actors/bot/event/on-review", json={"context": "main.py"})
    assert r.status_code == 200
    assert r.json()["output"] == "Event output"
    assert r.json()["name"] == "bot"
    assert r.json()["event"] == "on-review"
    mock_runtime.fire_event.assert_called_once_with("bot", "on-review", "main.py")


def test_fire_event_no_context(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.fire_event = MagicMock(return_value="ok")
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
