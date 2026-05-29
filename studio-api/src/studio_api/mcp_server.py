"""fastmcp server exposing workspace file-system tools to AI agents."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastmcp import FastMCP

if TYPE_CHECKING:
    from studio_api.workspace_fs import WorkspaceFS

mcp = FastMCP(
    "Cantica Studio",
    instructions=(
        "Workspace file-system access for AI actors running in the Studio. "
        "All paths are relative to the current workspace root. "
        "Use read_file / write_file for content, list_files / search_files for discovery."
    ),
)

# Injected at startup by main.py
_fs: WorkspaceFS | None = None


def init(fs: WorkspaceFS) -> None:
    """Wire the workspace FS singleton into the MCP tools."""
    global _fs
    _fs = fs


def _get_fs() -> WorkspaceFS:
    if _fs is None:
        raise RuntimeError("WorkspaceFS not initialised — call mcp_server.init() first")
    return _fs


@mcp.tool()
def read_file(path: str) -> str:
    """Read a file from the workspace. path is relative to the workspace root."""
    return _get_fs().read(path)


@mcp.tool()
def write_file(path: str, content: str) -> str:
    """Write content to a file in the workspace. Creates parent directories as needed."""
    _get_fs().write(path, content)
    return f"Written: {path}"


@mcp.tool()
def list_files(directory: str = ".") -> list[str]:
    """List files and directories inside a workspace directory."""
    return _get_fs().list(directory)


@mcp.tool()
def search_files(pattern: str) -> list[str]:
    """Search for files matching a glob pattern (e.g. '*.py') within the workspace."""
    return _get_fs().search(pattern)
