"""FastMCP server — workspace file-system tools + agent resource access."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastmcp import FastMCP

if TYPE_CHECKING:
    from studio_api.runtime import ActorRuntime
    from studio_api.workspace_fs import WorkspaceFS

mcp = FastMCP(
    "Cantica Studio",
    instructions=(
        "Workspace file-system access and agent resource management for AI actors "
        "running in the Studio. All file paths are relative to the workspace root."
    ),
)

_fs: WorkspaceFS | None = None
_rt: ActorRuntime | None = None


def init(fs: WorkspaceFS, runtime: ActorRuntime | None = None) -> None:
    global _fs, _rt
    _fs = fs
    _rt = runtime


def _get_fs() -> WorkspaceFS:
    if _fs is None:
        raise RuntimeError("WorkspaceFS not initialised — call mcp_server.init() first")
    return _fs


def _get_rt() -> ActorRuntime:
    if _rt is None:
        raise RuntimeError("ActorRuntime not initialised — call mcp_server.init() first")
    return _rt


# ── Workspace file tools ──────────────────────────────────────────────────────

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
    """Search for files matching a glob pattern within the workspace."""
    return _get_fs().search(pattern)


# ── Agent resource tools ──────────────────────────────────────────────────────

@mcp.tool()
def list_actor_resources(actor_name: str) -> list[dict]:
    """List all MCP resources accessible to an actor (owned + shared with it)."""
    return _get_rt().get_accessible_resources(actor_name)


@mcp.tool()
def read_actor_resource(actor_name: str, resource_id: str) -> str:
    """Read the content of an actor resource by ID.

    - file  → returns workspace file content
    - text  → returns the uri field as inline content
    - api   → returns the URI so the agent can call it
    - other → returns the URI
    """
    resources = _get_rt().get_accessible_resources(actor_name)
    match = next((r for r in resources if r["id"] == resource_id), None)
    if match is None:
        raise KeyError(f"Resource {resource_id!r} not accessible by {actor_name!r}")
    rtype = match.get("type", "other")
    uri = match.get("uri", "")
    if rtype == "file":
        return _get_fs().read(uri)
    return uri  # text inline / api URL / other URI


@mcp.tool()
def add_actor_resource(
    actor_name: str,
    name: str,
    resource_type: str,
    uri: str,
    description: str = "",
) -> dict:
    """Add a dynamic resource to a running actor. resource_type: file|api|text|other."""
    return _get_rt().add_resource(actor_name, {
        "name": name,
        "type": resource_type,
        "uri": uri,
        "description": description,
    })


@mcp.tool()
def share_actor_resource(actor_name: str, resource_id: str, target_actor: str) -> dict:
    """Share a resource with another actor (locks it)."""
    return _get_rt().share_resource(actor_name, resource_id, target_actor)


@mcp.tool()
def delete_actor_resource(actor_name: str, resource_id: str) -> str:
    """Delete a dynamic unshared resource. Raises if the resource is locked."""
    _get_rt().delete_resource(actor_name, resource_id)
    return f"Deleted resource {resource_id}"
