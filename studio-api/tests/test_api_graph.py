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
