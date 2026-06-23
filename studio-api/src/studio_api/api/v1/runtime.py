"""Runtime endpoints — start/stop/instruct running actor instances."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from studio_api.api.v1.deps import ConnectorDep, RuntimeDep, require_permission
from studio_api.runtime import ActorDef

_log = logging.getLogger(__name__)
router = APIRouter()


class StartActorRequest(BaseModel):
    name: str
    actor_type: str = "ai"          # "ai" | "python" | "typescript"
    script_path: str = ""           # required for python / typescript actors
    script_command: str = ""        # optional runtime override (e.g. "ts-node", "bun")
    define_prompt: str = ""
    provider: str = "claude"
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 4096
    max_history: int = 10
    prompt_events: list[dict] = []
    cron_jobs: list[dict] = []
    outbox: dict[str, str] = {}
    resources: list[dict] = []
    directory: str = ""
    songbook_file: str = ""


class InstructRequest(BaseModel):
    instruction: str


class EventRequest(BaseModel):
    context: str = ""


@router.get("/actors/summary", dependencies=[require_permission("runtime:read")])
def get_actors_summary(rt: RuntimeDep) -> list[dict]:
    return rt.get_actors_summary()


@router.get("/actors", dependencies=[require_permission("runtime:read")])
def list_actors(rt: RuntimeDep) -> list[str]:
    return rt.list_running()


@router.post("/actors", status_code=201, dependencies=[require_permission("runtime:start")])
async def start_actor(body: StartActorRequest, rt: RuntimeDep, cn: ConnectorDep) -> dict:
    defn = ActorDef(**body.model_dump())
    try:
        initial_output = await asyncio.to_thread(rt.start, defn, cn)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    result: dict = {"name": body.name, "status": "running", "actor_type": body.actor_type}
    if initial_output:
        result["initial_output"] = initial_output
    return result


@router.post("/actors/{name}/pause", dependencies=[require_permission("runtime:start")])
def pause_actor(name: str, rt: RuntimeDep) -> dict:
    try:
        rt.pause(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"name": name, "status": "paused"}


@router.post("/actors/{name}/resume", dependencies=[require_permission("runtime:start")])
def resume_actor(name: str, rt: RuntimeDep) -> dict:
    try:
        flushed = rt.resume(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"name": name, "status": "running", "queued_flushed": flushed}


@router.delete("/actors", dependencies=[require_permission("runtime:stop")])
async def stop_all_actors(rt: RuntimeDep) -> dict:
    running = rt.list_running()
    for name in list(running):
        try:
            await asyncio.to_thread(rt.stop, name)
        except Exception:
            pass
    return {"stopped": running}


@router.delete("/actors/{name}", status_code=204, dependencies=[require_permission("runtime:stop")])
async def stop_actor(name: str, rt: RuntimeDep) -> None:
    try:
        await asyncio.to_thread(rt.stop, name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/actors/{name}/instruct", dependencies=[require_permission("runtime:instruct")])
async def instruct_actor(name: str, body: InstructRequest, rt: RuntimeDep) -> dict:
    try:
        output = await asyncio.to_thread(rt.instruct, name, body.instruction)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    result: dict = {"name": name, "output": output}
    try:
        resolved = rt.get_resolved_model(name)
        if resolved:
            result["resolved_model"] = resolved
    except Exception:
        pass  # Non-fatal — model badge updates via polling endpoint
    return result


@router.get("/actors/{name}/model", dependencies=[require_permission("runtime:read")])
def get_actor_model(name: str, rt: RuntimeDep) -> dict:
    """Return the model Copilot resolved 'auto' to. Null until the first inference completes."""
    try:
        resolved = rt.get_resolved_model(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"name": name, "resolved_model": resolved}


@router.post("/actors/{name}/event/{event_name}", dependencies=[require_permission("runtime:instruct")])
async def fire_event(name: str, event_name: str, body: EventRequest, rt: RuntimeDep) -> dict:
    try:
        result = await asyncio.to_thread(rt.fire_event, name, event_name, body.context)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"name": name, "event": event_name, "output": result["output"], "forwarded": result.get("forwarded", [])}


@router.get("/actors/{name}/events", dependencies=[require_permission("runtime:read")])
def list_actor_events(name: str, rt: RuntimeDep) -> list[dict]:
    """Return events declared by a code actor (empty for AI actors)."""
    try:
        return rt.get_actor_events(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/actors/{name}/crons", dependencies=[require_permission("runtime:read")])
def list_actor_crons(name: str, rt: RuntimeDep) -> list[dict]:
    """Return cron jobs declared by a code actor (empty for AI actors)."""
    try:
        return rt.get_actor_crons(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/actors/{name}/chat", dependencies=[require_permission("runtime:read")])
async def get_actor_chat(name: str, rt: RuntimeDep) -> dict:
    """Return captured chat/log output from a code actor."""
    try:
        chat = await asyncio.to_thread(rt.get_actor_chat, name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"name": name, "chat": chat}


@router.get("/notifications", dependencies=[require_permission("runtime:read")])
def drain_notifications(rt: RuntimeDep) -> list[dict]:
    """Drain and return accumulated actor-to-actor forwarded-prompt notifications."""
    return rt.drain_notifications()


@router.get("/mcp-log", dependencies=[require_permission("runtime:read")])
def drain_mcp_log() -> list[dict]:
    """Drain and return accumulated MCP tool-call log entries."""
    from studio_api.mcp_server import drain_mcp_log as _drain  # noqa: PLC0415
    return _drain()


@router.get("/actors/{name}/type", dependencies=[require_permission("runtime:read")])
def get_actor_type(name: str, rt: RuntimeDep) -> dict:
    """Return the type of a running actor: 'ai', 'python', or 'typescript'."""
    try:
        actor_type = rt.get_actor_type(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"name": name, "actor_type": actor_type}
