"""Coverage gap tests — targets previously uncovered lines and branches.

Grouped by source module:
  api/v1/graph.py      save_graph write-failure 500 path
  api/v1/*.py          uninitialised-guard functions (_get, _rt, _cn)
  cantica_client.py    PromptInfo, network-exception handlers
  main.py              main() and __main__ guard
  mcp_server.py        code-actor lifecycle tools
  runtime.py           stop exception handlers, fire_event branches,
                       resource CRUD edge cases, cron routing / error paths
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from fastmcp import Client

import studio_api.mcp_server as mcp_mod
from studio_api.cantica_client import CanticaConnector, PromptInfo
from studio_api.config import CanticaServerConfig
from studio_api.mcp_server import mcp
from studio_api.runtime import ActorDef, ActorRuntime
from studio_api.workspace_fs import WorkspaceFS


# ── helpers ───────────────────────────────────────────────────────────────────


def _adef(name: str = "test-actor", **kw) -> ActorDef:
    return ActorDef(id=f"urn:x:{name}", name=name, define_prompt="You are a bot.", **kw)


def _conn(content: str = "System prompt") -> MagicMock:
    m = MagicMock()
    m.resolve_uri_sync.return_value = content
    return m


def _ref(proxy: MagicMock | None = None) -> MagicMock:
    r = MagicMock()
    r.proxy.return_value = proxy or MagicMock()
    return r


# ── api/v1/graph.py:39-40 — save_graph write failure ─────────────────────────


def test_save_graph_returns_500_on_write_error(client: TestClient) -> None:
    """PUT /v1/graph → 500 when Path.write_text raises."""
    with patch("pathlib.Path.write_text", side_effect=OSError("disk full")):
        r = client.put("/v1/graph", json={"data": {}})
    assert r.status_code == 500
    assert "disk full" in r.json()["detail"]


# ── api/v1/prompts.py:22 — _get() guard ──────────────────────────────────────


def test_prompts_connector_guard_raises() -> None:
    """_get() raises RuntimeError when _connector is None."""
    import studio_api.api.v1.prompts as mod  # noqa: PLC0415

    saved, mod._connector = mod._connector, None
    try:
        with pytest.raises(RuntimeError, match="not initialised"):
            mod._get()
    finally:
        mod._connector = saved


# ── api/v1/resources.py:25 — _rt() guard ─────────────────────────────────────


def test_resources_rt_guard_raises_503() -> None:
    """_rt() in resources endpoint raises HTTPException(503) when None."""
    import studio_api.api.v1.resources as mod  # noqa: PLC0415

    saved, mod._runtime = mod._runtime, None
    try:
        with pytest.raises(HTTPException) as exc:
            mod._rt()
        assert exc.value.status_code == 503
    finally:
        mod._runtime = saved


# ── api/v1/runtime.py:29,35 — _rt() and _cn() guards ─────────────────────────


def test_runtime_rt_guard_raises() -> None:
    """_rt() in runtime endpoint raises RuntimeError when None."""
    import studio_api.api.v1.runtime as mod  # noqa: PLC0415

    saved, mod._runtime = mod._runtime, None
    try:
        with pytest.raises(RuntimeError, match="not initialised"):
            mod._rt()
    finally:
        mod._runtime = saved


def test_runtime_cn_guard_raises() -> None:
    """_cn() in runtime endpoint raises RuntimeError when None."""
    import studio_api.api.v1.runtime as mod  # noqa: PLC0415

    saved, mod._connector = mod._connector, None
    try:
        with pytest.raises(RuntimeError, match="not initialised"):
            mod._cn()
    finally:
        mod._connector = saved


# ── cantica_client.py:22-25 — PromptInfo ─────────────────────────────────────


def test_prompt_info_stores_all_fields() -> None:
    """PromptInfo constructor populates all instance attributes."""
    p = PromptInfo("my-ns", "my-prompt", "A helpful assistant", ["ai", "v1"])
    assert p.namespace == "my-ns"
    assert p.name == "my-prompt"
    assert p.description == "A helpful assistant"
    assert p.tags == ["ai", "v1"]


# ── cantica_client.py:65-66 — list_prompts network exception ─────────────────


async def test_list_prompts_skips_server_on_network_error() -> None:
    """ConnectError during list_prompts is caught, warned, and empty list returned."""
    import httpx  # noqa: PLC0415
    import respx  # noqa: PLC0415

    connector = CanticaConnector([CanticaServerConfig("http://gone.test")])

    with respx.mock:
        respx.get("http://gone.test/v1/prompts").mock(
            side_effect=httpx.ConnectError("unreachable")
        )
        results = await connector.list_prompts()

    assert results == []


# ── cantica_client.py:114-115 — resolve_uri_sync network exception ────────────


def test_resolve_uri_sync_raises_value_error_after_network_failure() -> None:
    """Network error in resolve_uri_sync is caught/logged; ValueError propagates."""
    import httpx  # noqa: PLC0415
    import respx  # noqa: PLC0415

    connector = CanticaConnector([CanticaServerConfig("http://gone.test")])

    with respx.mock:
        respx.post("http://gone.test/v1/resolve").mock(
            side_effect=httpx.ConnectError("unreachable")
        )
        with pytest.raises(ValueError, match="Could not resolve"):
            connector.resolve_uri_sync("cantica://ns/name")


# ── main.py:96-97 — main() calls uvicorn.run ─────────────────────────────────


def test_main_delegates_to_uvicorn() -> None:
    """main() calls uvicorn.run with the studio_api.main:app target."""
    from studio_api.main import main  # noqa: PLC0415

    with patch("studio_api.main.uvicorn.run") as mock_run:
        main()

    mock_run.assert_called_once()
    assert "studio_api.main:app" in mock_run.call_args[0]


# ── main.py:107 — __main__ guard ─────────────────────────────────────────────


def test_main_module_guard_invokes_main() -> None:
    """The ``if __name__ == '__main__': main()`` guard at EOF calls main()."""
    from studio_api import main as main_mod  # noqa: PLC0415

    with patch.object(main_mod, "main") as mock_main:
        code = compile(
            "if __name__ == '__main__': main()",
            "<guard-test>",
            "exec",
        )
        exec(code, {"__name__": "__main__", "main": mock_main})  # noqa: S102

    mock_main.assert_called_once()


# ── runtime.py — stop() exception handlers ────────────────────────────────────


def test_stop_skips_jobs_belonging_to_other_actors() -> None:
    """stop() loops over ALL scheduler jobs; non-matching IDs are skipped (185->184)."""
    rt = ActorRuntime()
    conn = _conn()
    ra, rb = _ref(), _ref()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", side_effect=[ra, rb]):
        rt.start(_adef("alpha", cron_jobs=[{"schedule": "*/5 * * * *", "prompt": "p", "name": "five-min"}]), conn)
        rt.start(_adef("beta",  cron_jobs=[{"schedule": "*/10 * * * *", "prompt": "q", "name": "ten-min"}]), conn)

    rt.stop("beta")          # alpha's job stays; loop sees it but 185 False-branch fires
    assert "beta" not in rt.list_running()
    assert "alpha" in rt.list_running()
    rt.stop_all()


def test_stop_handles_scheduler_get_jobs_exception() -> None:
    """scheduler.get_jobs() raising in stop() is caught silently (lines 187-188)."""
    rt = ActorRuntime()
    ref = _ref()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_adef(), _conn())

    rt._scheduler.get_jobs = MagicMock(side_effect=RuntimeError("scheduler dead"))
    rt.stop("test-actor")    # must not raise
    rt.stop_all()


def test_stop_handles_ref_stop_exception() -> None:
    """ref.stop() raising in stop() is caught silently (lines 191-192)."""
    rt = ActorRuntime()
    ref = _ref()
    ref.stop = MagicMock(side_effect=RuntimeError("actor already dead"))

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_adef(), _conn())

    rt.stop("test-actor")    # must not raise
    rt.stop_all()


def test_stop_all_swallows_per_actor_stop_exception() -> None:
    """Exception raised by stop() inside stop_all() is caught (lines 199-200)."""
    rt = ActorRuntime()
    ref = _ref()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_adef(), _conn())

    with patch.object(rt, "stop", side_effect=RuntimeError("stop failed")):
        rt.stop_all()        # must not raise


def test_stop_all_swallows_scheduler_shutdown_exception() -> None:
    """scheduler.shutdown() raising in stop_all() is caught (lines 203-204)."""
    rt = ActorRuntime()
    ref = _ref()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_adef(), _conn())

    rt._scheduler.shutdown = MagicMock(side_effect=RuntimeError("already stopped"))
    rt.stop_all()            # must not raise


# ── runtime.py — fire_event target not running (225->224 branch) ─────────────


def test_fire_event_target_not_running_is_silently_skipped() -> None:
    """Target in targetActors that is not running is skipped (225 False branch)."""
    rt = ActorRuntime()
    proxy = MagicMock()
    proxy.instruct.return_value.get.return_value = "result"
    ref = _ref(proxy)

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(
            _adef(prompt_events=[{"name": "check", "prompt": "p",
                                   "targetActors": ["ghost-actor"]}]),
            _conn(),
        )

    result = rt.fire_event("test-actor", "check")
    assert result == "result"
    assert proxy.instruct.call_count == 1   # only called on self; ghost skipped
    rt.stop_all()


# ── runtime.py — get_actor_logs exception handler (258-259) ──────────────────


def test_get_actor_logs_returns_empty_string_on_proxy_exception() -> None:
    """proxy.get_logs().get() raising is caught; returns '' (lines 258-259)."""
    rt = ActorRuntime()
    proxy = MagicMock()
    proxy.get_logs.return_value.get.side_effect = RuntimeError("dead")
    ref = _ref(proxy)

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_adef(), _conn())

    assert rt.get_actor_logs("test-actor") == ""
    rt.stop_all()


# ── runtime.py — get_resources (line 264) ────────────────────────────────────


def test_get_resources_returns_empty_for_actor_with_no_resources() -> None:
    """get_resources returns [] when the actor was started with no resources."""
    rt = ActorRuntime()
    ref = _ref()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_adef(), _conn())

    assert rt.get_resources("test-actor") == []
    rt.stop_all()


# ── runtime.py — get_accessible_resources shared branch (272-274) ────────────


def test_get_accessible_resources_includes_resources_shared_by_another_actor() -> None:
    """Resources shared from 'owner' appear in 'reader's accessible list."""
    rt = ActorRuntime()
    conn = _conn()
    ra, rb = _ref(), _ref()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", side_effect=[ra, rb]):
        rt.start(_adef("owner"), conn)
        rt.start(_adef("reader"), conn)

    res = rt.add_resource("owner", {"name": "data.txt", "type": "file", "uri": "data.txt"})
    rt.share_resource("owner", res["id"], "reader")

    accessible = rt.get_accessible_resources("reader")
    assert any(r["id"] == res["id"] for r in accessible)
    rt.stop_all()


# ── runtime.py — add_resource KeyError (line 280) ────────────────────────────


def test_add_resource_raises_key_error_for_unknown_actor() -> None:
    """add_resource raises KeyError when the actor is not running."""
    rt = ActorRuntime()
    with pytest.raises(KeyError, match="not running"):
        rt.add_resource("ghost", {"name": "f", "type": "file", "uri": "f.txt"})
    rt.stop_all()


# ── runtime.py — delete_resource locked (line 300) ───────────────────────────


def test_delete_resource_raises_permission_error_for_static_resource() -> None:
    """delete_resource raises PermissionError when the resource is static (locked)."""
    rt = ActorRuntime()
    ref = _ref()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(
            _adef(resources=[{
                "id": "static-1", "name": "code.py", "type": "file",
                "uri": "code.py", "description": "", "dynamic": False, "sharedWith": [],
            }]),
            _conn(),
        )

    with pytest.raises(PermissionError, match="locked"):
        rt.delete_resource("test-actor", "static-1")
    rt.stop_all()


# ── runtime.py — delete_resource not found (line 307) ────────────────────────


def test_delete_resource_raises_key_error_for_missing_resource() -> None:
    """delete_resource raises KeyError when the resource ID does not exist."""
    rt = ActorRuntime()
    ref = _ref()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_adef(), _conn())

    with pytest.raises(KeyError, match="not found"):
        rt.delete_resource("test-actor", "no-such-id")
    rt.stop_all()


# ── runtime.py — share_resource already shared (313->315 branch) ─────────────


def test_share_resource_idempotent_when_already_shared() -> None:
    """Sharing the same resource twice does not duplicate the sharedWith entry."""
    rt = ActorRuntime()
    conn = _conn()
    ra, rb = _ref(), _ref()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", side_effect=[ra, rb]):
        rt.start(_adef("owner"), conn)
        rt.start(_adef("reader"), conn)

    res = rt.add_resource("owner", {"name": "f", "type": "file", "uri": "f.txt"})
    rt.share_resource("owner", res["id"], "reader")
    result = rt.share_resource("owner", res["id"], "reader")   # second share — idempotent

    assert result["sharedWith"].count("reader") == 1
    rt.stop_all()


# ── runtime.py — share_resource not found (line 317) ─────────────────────────


def test_share_resource_raises_key_error_for_missing_resource() -> None:
    """share_resource raises KeyError when the resource ID does not exist."""
    rt = ActorRuntime()
    ref = _ref()

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_adef(), _conn())

    with pytest.raises(KeyError, match="not found"):
        rt.share_resource("test-actor", "no-such-id", "other")
    rt.stop_all()


# ── runtime.py — cron routing to target with targetEvent (lines 354-355) ──────


def test_cron_routes_to_target_via_fire_event_when_target_event_set() -> None:
    """Cron with targetActor + targetEvent calls fire_event on the target (lines 354-355)."""
    rt = ActorRuntime()
    conn = _conn()

    proxy_src = MagicMock()
    proxy_src.instruct.return_value.get.return_value = "cron-out"
    proxy_tgt = MagicMock()
    proxy_tgt.instruct.return_value.get.return_value = "event-reply"
    ref_src, ref_tgt = _ref(proxy_src), _ref(proxy_tgt)

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", side_effect=[ref_src, ref_tgt]):
        rt.start(
            _adef("source", cron_jobs=[{
                "schedule": "*/2 * * * *",
                "prompt": "What time is it?",
                "name": "time-check",
                "targetActor": "target",
                "targetEvent": "on-time",
            }]),
            conn,
        )
        rt.start(
            _adef("target", prompt_events=[{"name": "on-time", "prompt": "Handle time."}]),
            conn,
        )

    rt._scheduler.get_jobs()[0].func()

    proxy_src.instruct.assert_called_once_with("What time is it?")
    proxy_tgt.instruct.assert_called_once()   # forwarded via fire_event
    rt.stop_all()


def test_cron_routes_to_target_via_instruct_when_no_target_event() -> None:
    """Cron with targetActor but no targetEvent calls instruct on target (lines 356-357)."""
    rt = ActorRuntime()
    conn = _conn()

    proxy_src = MagicMock()
    proxy_src.instruct.return_value.get.return_value = "cron-out"
    proxy_tgt = MagicMock()
    proxy_tgt.instruct.return_value.get.return_value = "ok"
    ref_src, ref_tgt = _ref(proxy_src), _ref(proxy_tgt)

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", side_effect=[ref_src, ref_tgt]):
        rt.start(
            _adef("source", cron_jobs=[{
                "schedule": "*/2 * * * *",
                "prompt": "What time is it?",
                "name": "time-check",
                "targetActor": "target",
            }]),
            conn,
        )
        rt.start(_adef("target"), conn)

    rt._scheduler.get_jobs()[0].func()

    proxy_src.instruct.assert_called_once_with("What time is it?")
    proxy_tgt.instruct.assert_called_once_with("cron-out")
    rt.stop_all()


def test_cron_exception_is_logged_not_propagated() -> None:
    """Exception inside cron callback is caught and logged; does not re-raise (358-359)."""
    rt = ActorRuntime()
    proxy = MagicMock()
    proxy.instruct.return_value.get.side_effect = RuntimeError("LLM timeout")
    ref = _ref(proxy)

    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(_adef(cron_jobs=[{"schedule": "*/2 * * * *", "prompt": "ping", "name": "ping"}]), _conn())

    rt._scheduler.get_jobs()[0].func()   # must not raise

    proxy.instruct.assert_called_once_with("ping")
    rt.stop_all()


# ── runtime.py — code cron _run (lines 381-385) ───────────────────────────────


def test_code_cron_fires_run_cron_on_proxy() -> None:
    """Code cron callback calls proxy.run_cron(name) (lines 381-383)."""
    rt = ActorRuntime()
    proxy = MagicMock()
    proxy.run_cron.return_value.get.return_value = "tick"
    ref = _ref(proxy)
    rt._refs["code-worker"] = ref

    rt._register_code_crons("code-worker", [{"name": "tick", "schedule": "0 9 * * *"}])
    rt._scheduler.get_jobs()[0].func()

    proxy.run_cron.assert_called_once_with("tick")
    rt.stop_all()


def test_code_cron_exception_is_logged_not_propagated() -> None:
    """Exception inside code cron callback is caught and logged (lines 384-385)."""
    rt = ActorRuntime()
    proxy = MagicMock()
    proxy.run_cron.return_value.get.side_effect = RuntimeError("script crashed")
    ref = _ref(proxy)
    rt._refs["code-worker"] = ref

    rt._register_code_crons("code-worker", [{"name": "daily", "schedule": "0 9 * * *"}])
    rt._scheduler.get_jobs()[0].func()   # must not raise

    proxy.run_cron.assert_called_once_with("daily")
    rt.stop_all()


# ── mcp_server.py — code actor lifecycle tools ────────────────────────────────


@pytest.fixture
def mcp_rt(tmp_path: Path):
    """MCP env backed by a real ActorRuntime (no actors started yet)."""
    rt = ActorRuntime()
    fs = WorkspaceFS(tmp_path)
    mcp_mod.init(fs, rt)
    yield rt, tmp_path
    mcp_mod._fs = None
    mcp_mod._rt = None
    rt.stop_all()


def _simple_script(tmp_path: Path, name: str = "actor.py") -> Path:
    p = tmp_path / name
    p.write_text(
        "from actor_ai.code_actor import on_message\n"
        "@on_message\ndef handle(text): return text\n",
        encoding="utf-8",
    )
    return p


async def test_mcp_start_code_actor(mcp_rt) -> None:
    """start_code_actor MCP tool starts a Python actor (lines 88-99)."""
    rt, tmp = mcp_rt
    script = _simple_script(tmp)

    async with Client(mcp) as c:
        result = await c.call_tool(
            "start_code_actor",
            {"actor_name": "py-a", "script_path": str(script), "actor_type": "python"},
        )

    assert "py-a" in result.data
    assert "py-a" in rt.list_running()


async def test_mcp_stop_code_actor(mcp_rt) -> None:
    """stop_code_actor MCP tool stops a running actor (lines 108-109)."""
    rt, tmp = mcp_rt
    script = _simple_script(tmp)

    async with Client(mcp) as c:
        await c.call_tool("start_code_actor",
                          {"actor_name": "py-b", "script_path": str(script)})
        result = await c.call_tool("stop_code_actor", {"actor_name": "py-b"})

    assert "py-b" in result.data
    assert "py-b" not in rt.list_running()


async def test_mcp_list_code_actor_events(mcp_rt) -> None:
    """list_code_actor_events MCP tool returns events from a code actor (line 119)."""
    rt, tmp = mcp_rt
    script = tmp / "evt.py"
    script.write_text(
        "from actor_ai.code_actor import on_message, event\n"
        "@on_message\ndef handle(text): return text\n"
        "@event('analyze')\ndef on_analyze(ctx): return 'done'\n",
        encoding="utf-8",
    )

    async with Client(mcp) as c:
        await c.call_tool("start_code_actor",
                          {"actor_name": "evt-a", "script_path": str(script)})
        result = await c.call_tool("list_code_actor_events", {"actor_name": "evt-a"})

    names = [e.get("name") for e in result.data]
    assert "analyze" in names


async def test_mcp_list_code_actor_crons(mcp_rt) -> None:
    """list_code_actor_crons MCP tool returns crons from a code actor (line 125)."""
    rt, tmp = mcp_rt
    script = tmp / "crn.py"
    script.write_text(
        "from actor_ai.code_actor import on_message, cron\n"
        "@on_message\ndef handle(text): return text\n"
        "@cron('0 9 * * *')\ndef daily(): return 'done'\n",
        encoding="utf-8",
    )

    async with Client(mcp) as c:
        await c.call_tool("start_code_actor",
                          {"actor_name": "crn-a", "script_path": str(script)})
        result = await c.call_tool("list_code_actor_crons", {"actor_name": "crn-a"})

    names = [c_item.get("name") for c_item in result.data]
    assert "daily" in names
