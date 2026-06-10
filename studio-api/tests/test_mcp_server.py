"""Tests for studio_api.mcp_server — MCP tools backed by WorkspaceFS."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastmcp import Client

import studio_api.mcp_server as mcp_mod
from studio_api.mcp_server import mcp
from studio_api.workspace_fs import WorkspaceFS


@pytest.fixture
def fs(tmp_path: Path) -> WorkspaceFS:
    return WorkspaceFS(tmp_path)


@pytest.fixture
def mcp_env(fs: WorkspaceFS, monkeypatch: pytest.MonkeyPatch) -> WorkspaceFS:
    mcp_mod.init(fs)
    yield fs
    mcp_mod._fs = None  # reset after each test


# ── init / _get_fs guard ──────────────────────────────────────────────────────


def test_get_fs_raises_before_init():
    mcp_mod._fs = None
    with pytest.raises(RuntimeError, match="not initialised"):
        mcp_mod._get_fs()


def test_init_sets_fs(fs: WorkspaceFS):
    mcp_mod._fs = None
    mcp_mod.init(fs)
    assert mcp_mod._fs is fs
    mcp_mod._fs = None


# ── read_file ─────────────────────────────────────────────────────────────────


async def test_read_file_tool(mcp_env: WorkspaceFS, tmp_path: Path):
    (tmp_path / "hello.txt").write_text("world", encoding="utf-8")
    async with Client(mcp) as client:
        result = await client.call_tool("read_file", {"path": "hello.txt"})
    assert result.data == "world"


async def test_read_file_not_found_raises(mcp_env: WorkspaceFS):
    from fastmcp.exceptions import ToolError  # noqa: PLC0415

    async with Client(mcp) as client:
        with pytest.raises(ToolError):
            await client.call_tool("read_file", {"path": "missing.txt"})


async def test_read_file_traversal_raises(mcp_env: WorkspaceFS):
    from fastmcp.exceptions import ToolError  # noqa: PLC0415

    async with Client(mcp) as client:
        with pytest.raises(ToolError):
            await client.call_tool("read_file", {"path": "../../etc/passwd"})


# ── write_file ────────────────────────────────────────────────────────────────


async def test_write_file_tool(mcp_env: WorkspaceFS, tmp_path: Path):
    async with Client(mcp) as client:
        result = await client.call_tool("write_file", {"path": "out.txt", "content": "data"})
    assert (tmp_path / "out.txt").read_text() == "data"
    assert "out.txt" in result.data


async def test_write_file_creates_dirs(mcp_env: WorkspaceFS, tmp_path: Path):
    async with Client(mcp) as client:
        await client.call_tool("write_file", {"path": "a/b/c.txt", "content": "deep"})
    assert (tmp_path / "a" / "b" / "c.txt").exists()


async def test_write_file_traversal_raises(mcp_env: WorkspaceFS):
    from fastmcp.exceptions import ToolError  # noqa: PLC0415

    async with Client(mcp) as client:
        with pytest.raises(ToolError):
            await client.call_tool("write_file", {"path": "../../evil.txt", "content": "bad"})


# ── list_files ────────────────────────────────────────────────────────────────


async def test_list_files_tool(mcp_env: WorkspaceFS, tmp_path: Path):
    (tmp_path / "a.txt").write_text("a")
    (tmp_path / "b.txt").write_text("b")
    async with Client(mcp) as client:
        result = await client.call_tool("list_files", {})
    assert any("a.txt" in e for e in result.data)
    assert any("b.txt" in e for e in result.data)


async def test_list_files_empty(mcp_env: WorkspaceFS):
    async with Client(mcp) as client:
        result = await client.call_tool("list_files", {})
    assert result.data == []


async def test_list_files_subdirectory(mcp_env: WorkspaceFS, tmp_path: Path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "f.py").write_text("x=1")
    async with Client(mcp) as client:
        result = await client.call_tool("list_files", {"directory": "sub"})
    assert any("f.py" in e for e in result.data)


# ── search_files ──────────────────────────────────────────────────────────────


async def test_search_files_tool(mcp_env: WorkspaceFS, tmp_path: Path):
    (tmp_path / "main.py").write_text("x=1")
    (tmp_path / "readme.md").write_text("docs")
    async with Client(mcp) as client:
        result = await client.call_tool("search_files", {"pattern": "*.py"})
    assert any("main.py" in e for e in result.data)
    assert not any("readme.md" in e for e in result.data)


async def test_search_files_no_match(mcp_env: WorkspaceFS):
    async with Client(mcp) as client:
        result = await client.call_tool("search_files", {"pattern": "*.rb"})
    assert result.data == []


# ── Agent resource MCP tools ──────────────────────────────────────────────────


@pytest.fixture
def mcp_with_rt(fs: WorkspaceFS, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """MCP env with a real ActorRuntime that has one running actor."""
    from studio_api.runtime import ActorRuntime, ActorDef  # noqa: PLC0415
    from unittest.mock import MagicMock  # noqa: PLC0415

    rt = ActorRuntime()

    # Start a Python code actor with one resource
    py_script = tmp_path / "res_actor.py"
    py_script.write_text(
        "from actor_ai.code_actor import on_message\n"
        "@on_message\ndef handle(t): return t\n",
        encoding="utf-8",
    )
    defn = ActorDef(
        name="res-actor",
        define_prompt="",
        actor_type="python",
        script_path=str(py_script),
        resources=[{"id": "file-1", "name": "data.txt", "type": "file",
                    "uri": "data.txt", "description": "", "dynamic": False, "sharedWith": []}],
    )
    rt.start(defn, MagicMock())

    mcp_mod.init(fs, rt)
    yield rt, fs
    mcp_mod._fs = None
    mcp_mod._rt = None
    rt.stop_all()


def test_get_rt_raises_before_init():
    import studio_api.mcp_server as mod  # noqa: PLC0415
    original = mod._rt
    mod._rt = None
    try:
        with pytest.raises(RuntimeError, match="not initialised"):
            mod._get_rt()
    finally:
        mod._rt = original


async def test_list_actor_resources_via_mcp(mcp_with_rt, tmp_path: Path):
    rt, fs = mcp_with_rt
    (tmp_path / "data.txt").write_text("hello", encoding="utf-8")
    async with Client(mcp) as client:
        result = await client.call_tool("list_actor_resources", {"actor_name": "res-actor"})
    assert isinstance(result.data, list)
    assert any(r["id"] == "file-1" for r in result.data)


async def test_read_actor_resource_file(mcp_with_rt, tmp_path: Path):
    rt, fs = mcp_with_rt
    (tmp_path / "data.txt").write_text("file content", encoding="utf-8")
    async with Client(mcp) as client:
        result = await client.call_tool(
            "read_actor_resource", {"actor_name": "res-actor", "resource_id": "file-1"}
        )
    assert result.data == "file content"


async def test_read_actor_resource_not_found_raises(mcp_with_rt):
    from fastmcp.exceptions import ToolError  # noqa: PLC0415
    async with Client(mcp) as client:
        with pytest.raises(ToolError):
            await client.call_tool(
                "read_actor_resource", {"actor_name": "res-actor", "resource_id": "missing"}
            )


async def test_read_actor_resource_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """read_actor_resource for type='directory' returns a newline-separated file listing."""
    from studio_api.runtime import ActorRuntime, ActorDef  # noqa: PLC0415
    from unittest.mock import MagicMock, patch  # noqa: PLC0415

    # Create a workspace sub-directory with known files
    sub = tmp_path / "docs"
    sub.mkdir()
    (sub / "readme.md").write_text("hello", encoding="utf-8")
    (sub / "guide.txt").write_text("world", encoding="utf-8")

    rt = ActorRuntime()
    defn = ActorDef(
        name="dir-actor",
        define_prompt="",
        directory="docs",
    )
    ref = MagicMock()
    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=ref):
        rt.start(defn, MagicMock())

    ws = WorkspaceFS(tmp_path)
    mcp_mod.init(ws, rt)
    try:
        async with Client(mcp) as client:
            result = await client.call_tool(
                "read_actor_resource",
                {"actor_name": "dir-actor", "resource_id": "directory"},
            )
        entries = result.data.split("\n") if result.data else []
        assert any("readme.md" in e for e in entries)
        assert any("guide.txt" in e for e in entries)
    finally:
        mcp_mod._fs = None
        mcp_mod._rt = None
        rt.stop_all()


async def test_add_actor_resource_via_mcp(mcp_with_rt):
    async with Client(mcp) as client:
        result = await client.call_tool(
            "add_actor_resource",
            {
                "actor_name": "res-actor",
                "name": "new-file.txt",
                "resource_type": "file",
                "uri": "new-file.txt",
                "description": "A new file",
            },
        )
    assert result.data["name"] == "new-file.txt"
    assert result.data["dynamic"] is True


async def test_share_actor_resource_via_mcp(mcp_with_rt, tmp_path: Path):
    """Share the static resource after adding a dynamic one to share."""
    rt, fs = mcp_with_rt
    # Add a second actor to receive the share
    py_script2 = tmp_path / "actor2.py"
    py_script2.write_text(
        "from actor_ai.code_actor import on_message\n@on_message\ndef h(t): return t\n",
        encoding="utf-8",
    )
    from studio_api.runtime import ActorDef  # noqa: PLC0415
    from unittest.mock import MagicMock  # noqa: PLC0415
    rt.start(
        ActorDef(name="actor2", define_prompt="", actor_type="python",
                 script_path=str(py_script2)),
        MagicMock(),
    )
    # First add a dynamic resource to res-actor, then share it
    async with Client(mcp) as client:
        add_result = await client.call_tool(
            "add_actor_resource",
            {"actor_name": "res-actor", "name": "shared.txt", "resource_type": "text",
             "uri": "shared-content", "description": ""},
        )
        resource_id = add_result.data["id"]
        share_result = await client.call_tool(
            "share_actor_resource",
            {"actor_name": "res-actor", "resource_id": resource_id, "target_actor": "actor2"},
        )
    assert "actor2" in share_result.data["sharedWith"]


async def test_delete_actor_resource_via_mcp(mcp_with_rt):
    """Add a dynamic resource then delete it."""
    async with Client(mcp) as client:
        add_result = await client.call_tool(
            "add_actor_resource",
            {"actor_name": "res-actor", "name": "tmp.txt", "resource_type": "file",
             "uri": "tmp.txt", "description": ""},
        )
        resource_id = add_result.data["id"]
        del_result = await client.call_tool(
            "delete_actor_resource",
            {"actor_name": "res-actor", "resource_id": resource_id},
        )
    assert resource_id in del_result.data


async def test_read_actor_resource_non_file_returns_uri(mcp_with_rt):
    """A 'text' or 'api' resource returns the URI directly."""
    async with Client(mcp) as client:
        add_result = await client.call_tool(
            "add_actor_resource",
            {"actor_name": "res-actor", "name": "endpoint", "resource_type": "api",
             "uri": "https://example.com/api", "description": ""},
        )
        resource_id = add_result.data["id"]
        read_result = await client.call_tool(
            "read_actor_resource",
            {"actor_name": "res-actor", "resource_id": resource_id},
        )
    assert read_result.data == "https://example.com/api"
