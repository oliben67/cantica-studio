"""Tests for /v1/prompts endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from studio_api.api.v1 import prompts as prompts_ep


def test_list_prompts_returns_empty(client: TestClient, mock_connector):
    mock_connector.list_prompts = AsyncMock(return_value=[])
    r = client.get("/v1/prompts")
    assert r.status_code == 200
    assert r.json() == []


def test_list_prompts_returns_results(client: TestClient, mock_connector):
    mock_connector.list_prompts = AsyncMock(return_value=[
        {"name": "arch", "namespace": "community", "_server": "http://s.test"},
        {"name": "reviewer", "namespace": "acme", "_server": "http://s.test"},
    ])
    r = client.get("/v1/prompts")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert data[0]["name"] == "arch"


def test_list_prompts_passes_q_param(client: TestClient, mock_connector):
    mock_connector.list_prompts = AsyncMock(return_value=[])
    client.get("/v1/prompts?q=hello&tag=code")
    mock_connector.list_prompts.assert_called_once_with(q="hello", tag="code")


def test_list_prompts_passes_no_params(client: TestClient, mock_connector):
    mock_connector.list_prompts = AsyncMock(return_value=[])
    client.get("/v1/prompts")
    mock_connector.list_prompts.assert_called_once_with(q=None, tag=None)


def test_get_prompt_no_servers_returns_503(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    # Patch get_settings at the import site used by the prompts endpoint
    import studio_api.api.v1.prompts as prompts_ep  # noqa: PLC0415
    from studio_api.config import Settings  # noqa: PLC0415

    monkeypatch.setattr(prompts_ep, "get_settings", lambda: Settings(cantica_servers_raw="[]"))
    r = client.get("/v1/prompts/ns/name")
    assert r.status_code == 503


def test_get_prompt_success(client: TestClient, mock_connector, monkeypatch: pytest.MonkeyPatch):
    mock_connector.get_prompt_content = AsyncMock(return_value="You are an architect.")

    import studio_api.api.v1.prompts as prompts_ep  # noqa: PLC0415
    from studio_api.config import Settings  # noqa: PLC0415

    monkeypatch.setattr(
        prompts_ep, "get_settings",
        lambda: Settings(cantica_servers_raw='[{"url": "http://test.test"}]'),
    )
    r = client.get("/v1/prompts/community/architect")
    assert r.status_code == 200
    assert r.json()["content"] == "You are an architect."
    assert r.json()["namespace"] == "community"
    assert r.json()["name"] == "architect"


def test_get_prompt_upstream_error_returns_502(
    client: TestClient, mock_connector, monkeypatch: pytest.MonkeyPatch
):
    mock_connector.get_prompt_content = AsyncMock(side_effect=RuntimeError("upstream down"))

    import studio_api.api.v1.prompts as prompts_ep  # noqa: PLC0415
    from studio_api.config import Settings  # noqa: PLC0415

    monkeypatch.setattr(
        prompts_ep, "get_settings",
        lambda: Settings(cantica_servers_raw='[{"url": "http://test.test"}]'),
    )
    r = client.get("/v1/prompts/ns/name")
    assert r.status_code == 502
