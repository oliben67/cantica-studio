"""HTTP client for fetching prompts from one or more Cantica servers."""

from __future__ import annotations

import logging
import re

import httpx

from studio_api.config import CanticaServerConfig

_log = logging.getLogger(__name__)

# cantica://[host/]namespace/name[@ref]
_URI_RE = re.compile(
    r"^cantica://(?:(?P<host>[^/]+)/)?(?P<ns>[^/@]+)/(?P<name>[^@]+)(?:@(?P<ref>.+))?$"
)


class PromptInfo:
    def __init__(self, namespace: str, name: str, description: str, tags: list[str]) -> None:
        self.namespace = namespace
        self.name = name
        self.description = description
        self.tags = tags


class CanticaConnector:
    """Aggregates prompts from multiple Cantica servers."""

    def __init__(self, servers: list[CanticaServerConfig]) -> None:
        self._servers = servers

    def _headers(self, server: CanticaServerConfig) -> dict[str, str]:
        h: dict[str, str] = {"Accept": "application/json"}
        if server.auth_token:
            h["Authorization"] = f"Bearer {server.auth_token}"
        return h

    # ── Async (for FastAPI endpoints) ──────────────────────────────────────────

    async def list_prompts(
        self,
        q: str | None = None,
        tag: str | None = None,
    ) -> list[dict]:
        results: list[dict] = []
        async with httpx.AsyncClient(timeout=10) as client:
            for server in self._servers:
                try:
                    params: dict[str, str] = {}
                    if q:
                        params["q"] = q
                    if tag:
                        params["tag"] = tag
                    r = await client.get(
                        f"{server.url}/v1/prompts",
                        params=params,
                        headers=self._headers(server),
                    )
                    if r.status_code == 200:
                        for p in r.json():
                            p["_server"] = server.url
                            results.append(p)
                except Exception as exc:
                    _log.warning("Failed to list prompts from %s: %s", server.url, exc)
        return results

    async def get_prompt_content(
        self,
        server_url: str,
        namespace: str,
        name: str,
        ref: str = "latest",
    ) -> str:
        server = next((s for s in self._servers if s.url == server_url), None)
        if server is None:
            raise ValueError(f"Unknown server: {server_url!r}")
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{server.url}/v1/resolve",
                params={"slug": f"{namespace}/{name}", "ref": ref},
                headers=self._headers(server),
            )
            r.raise_for_status()
            return r.json().get("content", "")

    # ── Sync (called from pykka actor on_start threads) ────────────────────────

    def resolve_uri_sync(self, uri: str) -> str:
        """Resolve a cantica:// URI to prompt content, trying all servers."""
        m = _URI_RE.match(uri)
        if not m:
            raise ValueError(f"Invalid cantica:// URI: {uri!r}")
        host = m.group("host")
        ns = m.group("ns")
        name = m.group("name")
        ref = m.group("ref") or "latest"

        servers = self._servers
        if host:
            servers = [s for s in servers if host in s.url] or self._servers

        for server in servers:
            try:
                with httpx.Client(timeout=15) as client:
                    r = client.post(
                        f"{server.url}/v1/resolve",
                        params={"slug": f"{ns}/{name}", "ref": ref},
                        headers=self._headers(server),
                    )
                    if r.status_code == 200:
                        return r.json().get("content", "")
            except Exception as exc:
                _log.warning("Failed to resolve %s from %s: %s", uri, server.url, exc)

        raise ValueError(f"Could not resolve URI {uri!r} from any configured server")
