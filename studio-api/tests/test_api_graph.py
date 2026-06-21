"""Tests for /v1/graph endpoints."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from studio_api.api.v1.graph import _empty_graph


# ── _empty_graph ──────────────────────────────────────────────────────────────


def test_empty_graph_structure():
    g = _empty_graph()
    assert g["@type"] == "ActorGraph"
    assert g["actors"] == []
    assert g["edges"] == []
    assert "@context" in g
    assert "@id" in g


# ── GET /v1/graph ─────────────────────────────────────────────────────────────


def test_load_graph_returns_empty_when_no_file(client: TestClient):
    r = client.get("/v1/graph")
    assert r.status_code == 200
    data = r.json()
    assert data["@type"] == "ActorGraph"
    assert data["actors"] == []


def test_load_graph_returns_file_contents(client: TestClient, tmp_workspace: Path):
    graph = {"@type": "ActorGraph", "name": "My Workflow", "actors": [], "edges": []}
    graph_path = tmp_workspace / ".vscode" / "actors.jsonld"
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    r = client.get("/v1/graph")
    assert r.status_code == 200
    assert r.json()["name"] == "My Workflow"


def test_load_graph_500_on_malformed_json(client: TestClient, tmp_workspace: Path):
    graph_path = tmp_workspace / ".vscode" / "actors.jsonld"
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    graph_path.write_text("NOT JSON {{{{", encoding="utf-8")

    r = client.get("/v1/graph")
    assert r.status_code == 500


# ── PUT /v1/graph ─────────────────────────────────────────────────────────────


def test_save_graph_persists_to_disk(client: TestClient, tmp_workspace: Path):
    payload = {
        "data": {
            "@type": "ActorGraph",
            "name": "Saved Workflow",
            "actors": [],
            "edges": [],
        }
    }
    r = client.put("/v1/graph", json=payload)
    assert r.status_code == 200
    assert r.json() == {"status": "saved"}

    graph_path = tmp_workspace / ".vscode" / "actors.jsonld"
    assert graph_path.exists()
    saved = json.loads(graph_path.read_text())
    assert saved["name"] == "Saved Workflow"


def test_save_graph_creates_parent_dirs(client: TestClient, tmp_workspace: Path):
    payload = {"data": {"@type": "ActorGraph", "actors": [], "edges": []}}
    r = client.put("/v1/graph", json=payload)
    assert r.status_code == 200
    assert (tmp_workspace / ".vscode" / "actors.jsonld").exists()


def test_save_then_load_round_trip(client: TestClient, tmp_workspace: Path):
    payload = {
        "data": {
            "@type": "ActorGraph",
            "name": "Round-trip",
            "actors": [{"@type": "AIActor", "name": "bot"}],
            "edges": [],
        }
    }
    client.put("/v1/graph", json=payload)
    r = client.get("/v1/graph")
    assert r.json()["name"] == "Round-trip"
    assert len(r.json()["actors"]) == 1


# ── GET /v1/graph/lock ────────────────────────────────────────────────────────


def test_list_locks_empty_initially(client: TestClient):
    r = client.get("/v1/graph/lock")
    assert r.status_code == 200
    assert r.json() == []


# ── POST /v1/graph/lock ───────────────────────────────────────────────────────


def test_claim_lock_succeeds(client: TestClient):
    r = client.post("/v1/graph/lock", json={
        "path": "/home/user/songs/my.jsonld",
        "client_id": "electron-uuid-1",
        "client_label": "Cantica Studio",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["locked"] is True
    assert data["path"] == "/home/user/songs/my.jsonld"
    assert data["client_id"] == "electron-uuid-1"
    assert data["client_label"] == "Cantica Studio"
    assert data["client_host"]     # non-empty
    assert data["opened_at"]       # ISO timestamp


def test_claim_lock_idempotent_same_client(client: TestClient):
    """The same client may re-claim a lock it already holds."""
    body = {"path": "/a/b.jsonld", "client_id": "client-A", "client_label": "App"}
    client.post("/v1/graph/lock", json=body)
    r = client.post("/v1/graph/lock", json=body)
    assert r.status_code == 200
    assert r.json()["locked"] is True


def test_claim_lock_rejected_for_different_client(client: TestClient):
    """A second client cannot open a file already locked by the first."""
    client.post("/v1/graph/lock", json={
        "path": "/shared/file.jsonld",
        "client_id": "client-A",
        "client_label": "Electron",
    })
    r = client.post("/v1/graph/lock", json={
        "path": "/shared/file.jsonld",
        "client_id": "client-B",
        "client_label": "VS Code",
    })
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["lock"]["client_id"] == "client-A"
    assert detail["lock"]["path"] == "/shared/file.jsonld"


def test_different_files_can_be_locked_by_different_clients(client: TestClient):
    """Two clients may hold locks on two different files simultaneously."""
    r1 = client.post("/v1/graph/lock", json={"path": "/file-a.jsonld", "client_id": "A"})
    r2 = client.post("/v1/graph/lock", json={"path": "/file-b.jsonld", "client_id": "B"})
    assert r1.status_code == 200
    assert r2.status_code == 200

    locks = client.get("/v1/graph/lock").json()
    paths = {l["path"] for l in locks}
    assert paths == {"/file-a.jsonld", "/file-b.jsonld"}


# ── DELETE /v1/graph/lock ─────────────────────────────────────────────────────


def test_release_lock_removes_entry(client: TestClient):
    client.post("/v1/graph/lock", json={"path": "/f.jsonld", "client_id": "X"})
    r = client.request("DELETE", "/v1/graph/lock", json={"path": "/f.jsonld", "client_id": "X"})
    assert r.status_code == 200
    assert r.json()["locked"] is False

    assert client.get("/v1/graph/lock").json() == []


def test_release_lock_noop_when_not_locked(client: TestClient):
    r = client.request("DELETE", "/v1/graph/lock", json={"path": "/nope.jsonld", "client_id": "X"})
    assert r.status_code == 200
    assert r.json()["locked"] is False


def test_release_lock_forbidden_for_different_client(client: TestClient):
    client.post("/v1/graph/lock", json={"path": "/owned.jsonld", "client_id": "owner"})
    r = client.request("DELETE", "/v1/graph/lock", json={"path": "/owned.jsonld", "client_id": "intruder"})
    assert r.status_code == 403
    assert "owner" in r.json()["detail"]["lock"]["client_id"]
