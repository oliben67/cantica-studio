"""Tests for /v1/resources/actors/* endpoints."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from studio_api.runtime import ActorRuntime


# ── GET /v1/resources/actors/{name}/resources ─────────────────────────────────


def test_list_resources_empty(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_resources.return_value = []
    r = client.get("/v1/resources/actors/bot/resources")
    assert r.status_code == 200
    assert r.json() == []
    mock_runtime.get_resources.assert_called_once_with("bot")


def test_list_resources_returns_items(client: TestClient, mock_runtime: ActorRuntime):
    resource = {
        "id": "r1", "name": "code.py", "type": "file",
        "uri": "code.py", "description": "", "dynamic": False, "sharedWith": [],
    }
    mock_runtime.get_resources.return_value = [resource]
    r = client.get("/v1/resources/actors/bot/resources")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["id"] == "r1"


# ── GET /v1/resources/actors/{name}/resources/accessible ─────────────────────


def test_list_accessible_resources(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_accessible_resources.return_value = [
        {"id": "r1", "name": "n", "type": "file", "uri": "a.py", "description": "", "dynamic": False, "sharedWith": []},
    ]
    r = client.get("/v1/resources/actors/bot/resources/accessible")
    assert r.status_code == 200
    assert r.json()[0]["id"] == "r1"
    mock_runtime.get_accessible_resources.assert_called_once_with("bot")


def test_list_accessible_resources_empty(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.get_accessible_resources.return_value = []
    r = client.get("/v1/resources/actors/bot/resources/accessible")
    assert r.status_code == 200
    assert r.json() == []


# ── POST /v1/resources/actors/{name}/resources ────────────────────────────────


def test_add_resource_success(client: TestClient, mock_runtime: ActorRuntime):
    created = {"id": "r2", "name": "out.txt", "type": "file", "uri": "out.txt",
               "description": "", "dynamic": True, "sharedWith": []}
    mock_runtime.add_resource.return_value = created
    body = {"name": "out.txt", "type": "file", "uri": "out.txt"}
    r = client.post("/v1/resources/actors/bot/resources", json=body)
    assert r.status_code == 201
    assert r.json()["id"] == "r2"
    mock_runtime.add_resource.assert_called_once()


def test_add_resource_actor_not_found_returns_404(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.add_resource.side_effect = KeyError("not running")
    r = client.post("/v1/resources/actors/ghost/resources",
                    json={"name": "f", "type": "file", "uri": "f.txt"})
    assert r.status_code == 404


# ── DELETE /v1/resources/actors/{name}/resources/{resource_id} ────────────────


def test_delete_resource_success(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.delete_resource = MagicMock()
    r = client.delete("/v1/resources/actors/bot/resources/r1")
    assert r.status_code == 204
    mock_runtime.delete_resource.assert_called_once_with("bot", "r1")


def test_delete_resource_not_found_returns_404(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.delete_resource = MagicMock(side_effect=KeyError("not found"))
    r = client.delete("/v1/resources/actors/bot/resources/ghost-id")
    assert r.status_code == 404


def test_delete_resource_locked_returns_403(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.delete_resource = MagicMock(side_effect=PermissionError("locked"))
    r = client.delete("/v1/resources/actors/bot/resources/locked-id")
    assert r.status_code == 403


# ── POST /v1/resources/actors/{name}/resources/{resource_id}/share ────────────


def test_share_resource_success(client: TestClient, mock_runtime: ActorRuntime):
    shared = {"id": "r1", "name": "n", "type": "file", "uri": "a.py",
              "description": "", "dynamic": True, "sharedWith": ["other-bot"]}
    mock_runtime.share_resource.return_value = shared
    r = client.post("/v1/resources/actors/bot/resources/r1/share",
                    json={"target_actor": "other-bot"})
    assert r.status_code == 200
    assert "other-bot" in r.json()["sharedWith"]
    mock_runtime.share_resource.assert_called_once_with("bot", "r1", "other-bot")


def test_share_resource_not_found_returns_404(client: TestClient, mock_runtime: ActorRuntime):
    mock_runtime.share_resource.side_effect = KeyError("not found")
    r = client.post("/v1/resources/actors/bot/resources/ghost/share",
                    json={"target_actor": "other"})
    assert r.status_code == 404
