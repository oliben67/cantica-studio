"""Tests for studio_api.config — Settings and CanticaServerConfig."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from studio_api.config import CanticaServerConfig, Settings


# ── CanticaServerConfig ───────────────────────────────────────────────────────


def test_server_config_strips_trailing_slash():
    s = CanticaServerConfig("http://localhost:8042/")
    assert s.url == "http://localhost:8042"


def test_server_config_no_trailing_slash():
    s = CanticaServerConfig("http://localhost:8042")
    assert s.url == "http://localhost:8042"


def test_server_config_stores_auth_token():
    s = CanticaServerConfig("http://example.com", "my-token")
    assert s.auth_token == "my-token"


def test_server_config_empty_auth_token_default():
    s = CanticaServerConfig("http://example.com")
    assert s.auth_token == ""


# ── Settings ──────────────────────────────────────────────────────────────────


def test_settings_default_port():
    s = Settings()
    assert s.port == 8043


def test_settings_default_host():
    s = Settings()
    assert s.host == "127.0.0.1"


def test_settings_default_log_level():
    s = Settings()
    assert s.log_level == "info"


def test_settings_workspace_resolved(tmp_path: Path):
    s = Settings(workspace=tmp_path)
    assert s.workspace == tmp_path.resolve()


def test_settings_workspace_resolves_string():
    s = Settings(workspace=Path("."))
    assert s.workspace.is_absolute()


def test_settings_cantica_servers_empty_by_default():
    s = Settings(cantica_servers_raw="[]")
    assert s.cantica_servers == []


def test_settings_cantica_servers_parses_valid_json():
    raw = json.dumps([{"url": "http://localhost:8042", "auth_token": "tok"}])
    s = Settings(cantica_servers_raw=raw)
    servers = s.cantica_servers
    assert len(servers) == 1
    assert servers[0].url == "http://localhost:8042"
    assert servers[0].auth_token == "tok"


def test_settings_cantica_servers_ignores_missing_url():
    raw = json.dumps([{"auth_token": "tok"}])
    s = Settings(cantica_servers_raw=raw)
    assert s.cantica_servers == []


def test_settings_cantica_servers_ignores_malformed_json():
    s = Settings(cantica_servers_raw="not-json{{{")
    assert s.cantica_servers == []


def test_settings_cantica_servers_multiple():
    raw = json.dumps([
        {"url": "http://a.example.com"},
        {"url": "http://b.example.com", "auth_token": "abc"},
    ])
    s = Settings(cantica_servers_raw=raw)
    servers = s.cantica_servers
    assert len(servers) == 2
    assert servers[0].url == "http://a.example.com"
    assert servers[1].auth_token == "abc"


def test_settings_graph_path_relative(tmp_path: Path):
    s = Settings(workspace=tmp_path, graph_file=".vscode/actors.jsonld")
    assert s.graph_path == tmp_path / ".vscode" / "actors.jsonld"


def test_settings_graph_path_absolute(tmp_path: Path):
    abs_path = tmp_path / "my-graph.jsonld"
    s = Settings(workspace=tmp_path, graph_file=str(abs_path))
    assert s.graph_path == abs_path


def test_get_settings_returns_singleton():
    from studio_api.config import get_settings, _settings
    import studio_api.config as cfg_mod

    # Reset singleton for isolated test
    cfg_mod._settings = None
    s1 = get_settings()
    s2 = get_settings()
    assert s1 is s2
    cfg_mod._settings = None  # cleanup
