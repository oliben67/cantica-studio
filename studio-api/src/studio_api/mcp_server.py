"""FastMCP server — workspace file-system tools + agent resource access."""

from __future__ import annotations

import collections
import functools
import time
import threading
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

# Thread-safe ring buffer of recent MCP tool calls.
_mcp_log: collections.deque[dict] = collections.deque(maxlen=200)
_mcp_log_lock = threading.Lock()


def drain_mcp_log() -> list[dict]:
    """Return and clear all accumulated MCP tool-call log entries."""
    with _mcp_log_lock:
        items = list(_mcp_log)
        _mcp_log.clear()
    return items


def _logged_tool(fn):
    """Decorator that records each MCP tool call into _mcp_log."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        t0 = time.time()
        status = "ok"
        try:
            return fn(*args, **kwargs)
        except Exception:
            status = "error"
            raise
        finally:
            entry = {
                "ts": int(t0 * 1000),
                "tool": fn.__name__,
                "durationMs": int((time.time() - t0) * 1000),
                "status": status,
                "args": {k: str(v)[:120] for k, v in kwargs.items()},
            }
            with _mcp_log_lock:
                _mcp_log.append(entry)
    return wrapper


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
@_logged_tool
def read_file(path: str) -> str:
    """Read a file from the workspace. path is relative to the workspace root."""
    return _get_fs().read(path)


@mcp.tool()
@_logged_tool
def write_file(path: str, content: str) -> str:
    """Write content to a file in the workspace. Creates parent directories as needed."""
    _get_fs().write(path, content)
    return f"Written: {path}"


@mcp.tool()
@_logged_tool
def list_files(directory: str = ".") -> list[str]:
    """List files and directories inside a workspace directory."""
    return _get_fs().list(directory)


@mcp.tool()
@_logged_tool
def search_files(pattern: str) -> list[str]:
    """Search for files matching a glob pattern within the workspace."""
    return _get_fs().search(pattern)


# ── Agent resource tools ──────────────────────────────────────────────────────

# ── Code-actor lifecycle tools ────────────────────────────────────────────────

@mcp.tool()
@_logged_tool
def start_code_actor(
    actor_name: str,
    script_path: str,
    actor_type: str = "python",
    script_command: str = "",
) -> str:
    """Start a Python or TypeScript code actor.

    actor_name:     unique name for this actor instance
    script_path:    path to the script file (absolute or workspace-relative)
    actor_type:     "python" or "typescript" (default "python")
    script_command: optional runtime override (e.g. "bun", "ts-node")
    """
    from studio_api.runtime import ActorDef  # noqa: PLC0415
    defn = ActorDef(
        name=actor_name,
        define_prompt="",
        actor_type=actor_type,
        script_path=script_path,
        script_command=script_command,
    )
    rt = _get_rt()
    rt.start(defn, None)  # type: ignore[arg-type]
    return f"Started {actor_type} code actor '{actor_name}'"


@mcp.tool()
@_logged_tool
def stop_code_actor(actor_name: str) -> str:
    """Stop a running code actor.

    actor_name: the name used when starting the actor
    """
    _get_rt().stop(actor_name)
    return f"Stopped code actor '{actor_name}'"


@mcp.tool()
@_logged_tool
def list_code_actor_events(actor_name: str) -> list[dict]:
    """Return the events exposed by a running code actor.

    These are the event names the code actor handles internally; AI actors can
    fire them via fire_event().
    """
    return _get_rt().get_actor_events(actor_name)


@mcp.tool()
@_logged_tool
def list_code_actor_crons(actor_name: str) -> list[dict]:
    """Return the cron jobs registered by a running code actor."""
    return _get_rt().get_actor_crons(actor_name)


# ── Event tools ───────────────────────────────────────────────────────────────

@mcp.tool()
@_logged_tool
def fire_event(actor_name: str, event_name: str, context: str = "") -> str:
    """Fire a named event on an actor.

    Runs the event's configured prompt on the actor and forwards the output
    to all target actors defined for that event.  Call this from within an
    actor's own instruction to trigger configured event routing.

    actor_name: name of the actor that owns the event
    event_name: name of the event to fire
    context:    optional extra context appended to the event's prompt
    """
    return _get_rt().fire_event(actor_name, event_name, context)["output"]


# ── Agent resource tools ──────────────────────────────────────────────────────

@mcp.tool()
@_logged_tool
def list_actor_resources(actor_name: str) -> list[dict]:
    """List all MCP resources accessible to an actor (owned + shared with it)."""
    return _get_rt().get_accessible_resources(actor_name)


@mcp.tool()
@_logged_tool
def read_actor_resource(actor_name: str, resource_id: str) -> str:
    """Read the content of an actor resource by ID.

    - file      → returns workspace file content
    - directory → returns a newline-separated listing of directory entries
    - text      → returns the uri field as inline content
    - api       → returns the URI so the agent can call it
    - other     → returns the URI
    """
    resources = _get_rt().get_accessible_resources(actor_name)
    match = next((r for r in resources if r["id"] == resource_id), None)
    if match is None:
        raise KeyError(f"Resource {resource_id!r} not accessible by {actor_name!r}")
    rtype = match.get("type", "other")
    uri = match.get("uri", "")
    if rtype == "file":
        return _get_fs().read(uri)
    if rtype == "directory":
        return "\n".join(_get_fs().list(uri))
    return uri  # text inline / api URL / other URI


@mcp.tool()
@_logged_tool
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
@_logged_tool
def share_actor_resource(actor_name: str, resource_id: str, target_actor: str) -> dict:
    """Share a resource with another actor (locks it)."""
    return _get_rt().share_resource(actor_name, resource_id, target_actor)


@mcp.tool()
@_logged_tool
def delete_actor_resource(actor_name: str, resource_id: str) -> str:
    """Delete a dynamic unshared resource. Raises if the resource is locked."""
    _get_rt().delete_resource(actor_name, resource_id)
    return f"Deleted resource {resource_id}"
