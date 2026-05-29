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
