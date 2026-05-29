"""Tests for studio_api.cantica_client — CanticaConnector and URI parsing."""

from __future__ import annotations

import pytest
import httpx

from studio_api.cantica_client import CanticaConnector, _URI_RE
from studio_api.config import CanticaServerConfig


# ── URI regex ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("uri,expected", [
    ("cantica://ns/name", {"host": None, "ns": "ns", "name": "name", "ref": None}),
    ("cantica://ns/name@latest", {"host": None, "ns": "ns", "name": "name", "ref": "latest"}),
    ("cantica://ns/name@v1.0", {"host": None, "ns": "ns", "name": "name", "ref": "v1.0"}),
    ("cantica://host.example/ns/name", {"host": "host.example", "ns": "ns", "name": "name", "ref": None}),
    ("cantica://host.example/ns/name@abc123", {"host": "host.example", "ns": "ns", "name": "name", "ref": "abc123"}),
])
def test_uri_regex_valid(uri: str, expected: dict):
    m = _URI_RE.match(uri)
    assert m is not None
    for k, v in expected.items():
        assert m.group(k) == v, f"field {k!r}: expected {v!r}, got {m.group(k)!r}"


@pytest.mark.parametrize("uri", [
    "cantica://",
    "cantica://ns",
    "http://ns/name",
    "cantica:ns/name",
    "",
])
def test_uri_regex_invalid(uri: str):
    assert _URI_RE.match(uri) is None


# ── _headers ──────────────────────────────────────────────────────────────────


def test_headers_without_token():
    server = CanticaServerConfig("http://example.com")
    connector = CanticaConnector([server])
    h = connector._headers(server)
    assert "Authorization" not in h
    assert h["Accept"] == "application/json"


def test_headers_with_token():
    server = CanticaServerConfig("http://example.com", "my-token")
    connector = CanticaConnector([server])
    h = connector._headers(server)
    assert h["Authorization"] == "Bearer my-token"


# ── list_prompts ──────────────────────────────────────────────────────────────


async def test_list_prompts_aggregates_servers(respx_mock=None):
    """list_prompts merges results from all servers."""
    import respx  # noqa: PLC0415

    servers = [
        CanticaServerConfig("http://server-a.test"),
        CanticaServerConfig("http://server-b.test"),
    ]
    connector = CanticaConnector(servers)

    with respx.mock:
        respx.get("http://server-a.test/v1/prompts").mock(
            return_value=httpx.Response(200, json=[{"name": "p1", "namespace": "ns"}])
        )
        respx.get("http://server-b.test/v1/prompts").mock(
            return_value=httpx.Response(200, json=[{"name": "p2", "namespace": "ns"}])
        )
        results = await connector.list_prompts()

    names = [r["name"] for r in results]
    assert "p1" in names
    assert "p2" in names
    assert results[0].get("_server") == "http://server-a.test"


async def test_list_prompts_skips_failed_server():
    import respx  # noqa: PLC0415

    servers = [
        CanticaServerConfig("http://good.test"),
        CanticaServerConfig("http://bad.test"),
    ]
    connector = CanticaConnector(servers)

    with respx.mock:
        respx.get("http://good.test/v1/prompts").mock(
            return_value=httpx.Response(200, json=[{"name": "ok", "namespace": "ns"}])
        )
        respx.get("http://bad.test/v1/prompts").mock(
            return_value=httpx.Response(500)
        )
        results = await connector.list_prompts()

    assert len(results) == 1
    assert results[0]["name"] == "ok"


async def test_list_prompts_with_query():
    import respx  # noqa: PLC0415

    server = CanticaServerConfig("http://s.test")
    connector = CanticaConnector([server])

    with respx.mock:
        route = respx.get("http://s.test/v1/prompts").mock(
            return_value=httpx.Response(200, json=[])
        )
        await connector.list_prompts(q="hello", tag="code")

    assert route.called
    req = route.calls.last.request
    assert b"q=hello" in req.url.query
    assert b"tag=code" in req.url.query


async def test_list_prompts_empty_when_no_servers():
    connector = CanticaConnector([])
    results = await connector.list_prompts()
    assert results == []


# ── get_prompt_content ────────────────────────────────────────────────────────


async def test_get_prompt_content_success():
    import respx  # noqa: PLC0415

    server = CanticaServerConfig("http://s.test", "tok")
    connector = CanticaConnector([server])

    with respx.mock:
        respx.post("http://s.test/v1/resolve").mock(
            return_value=httpx.Response(200, json={"content": "You are an architect."})
        )
        content = await connector.get_prompt_content("http://s.test", "ns", "arch", "v1")

    assert content == "You are an architect."


async def test_get_prompt_content_unknown_server():
    connector = CanticaConnector([CanticaServerConfig("http://known.test")])
    with pytest.raises(ValueError, match="Unknown server"):
        await connector.get_prompt_content("http://unknown.test", "ns", "name")


# ── resolve_uri_sync ──────────────────────────────────────────────────────────


def test_resolve_uri_sync_success():
    import respx  # noqa: PLC0415

    server = CanticaServerConfig("http://s.test")
    connector = CanticaConnector([server])

    with respx.mock:
        respx.post("http://s.test/v1/resolve").mock(
            return_value=httpx.Response(200, json={"content": "Prompt content here."})
        )
        content = connector.resolve_uri_sync("cantica://ns/name@latest")

    assert content == "Prompt content here."


def test_resolve_uri_sync_invalid_uri():
    connector = CanticaConnector([CanticaServerConfig("http://s.test")])
    with pytest.raises(ValueError, match="Invalid cantica://"):
        connector.resolve_uri_sync("not-a-cantica-uri")


def test_resolve_uri_sync_all_servers_fail():
    import respx  # noqa: PLC0415

    server = CanticaServerConfig("http://s.test")
    connector = CanticaConnector([server])

    with respx.mock:
        respx.post("http://s.test/v1/resolve").mock(
            return_value=httpx.Response(404)
        )
        with pytest.raises(ValueError, match="Could not resolve"):
            connector.resolve_uri_sync("cantica://ns/name")


def test_resolve_uri_sync_host_filters_servers():
    """When URI contains a host, only matching servers are tried first."""
    import respx  # noqa: PLC0415

    servers = [
        CanticaServerConfig("http://primary.test"),
        CanticaServerConfig("http://secondary.test"),
    ]
    connector = CanticaConnector(servers)

    with respx.mock:
        respx.post("http://secondary.test/v1/resolve").mock(
            return_value=httpx.Response(200, json={"content": "from secondary"})
        )
        content = connector.resolve_uri_sync("cantica://secondary.test/ns/name")

    assert content == "from secondary"
