"""Runtime endpoints — start/stop/instruct running actor instances."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from studio_api.api.v1.deps import ConnectorDep, RuntimeDep
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


class InstructRequest(BaseModel):
    instruction: str


class EventRequest(BaseModel):
    context: str = ""


@router.get("/actors")
def list_actors(rt: RuntimeDep) -> list[str]:
    return rt.list_running()


@router.post("/actors", status_code=201)
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
    resolved_model = rt.pop_resolved_model(body.name)
    if resolved_model:
        result["resolved_model"] = resolved_model
    return result


@router.post("/actors/{name}/pause")
def pause_actor(name: str, rt: RuntimeDep) -> dict:
    try:
        rt.pause(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"name": name, "status": "paused"}


@router.post("/actors/{name}/resume")
def resume_actor(name: str, rt: RuntimeDep) -> dict:
    try:
        flushed = rt.resume(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"name": name, "status": "running", "queued_flushed": flushed}


@router.delete("/actors", status_code=200)
async def stop_all_actors(rt: RuntimeDep) -> dict:
    """Stop all running actors at once (same effect as a failed health check)."""
    stopped = rt.list_running()
    await asyncio.to_thread(rt.stop_all)
    return {"stopped": stopped}


@router.delete("/actors/{name}", status_code=204)
async def stop_actor(name: str, rt: RuntimeDep) -> None:
    try:
        await asyncio.to_thread(rt.stop, name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/actors/{name}/model")
def get_actor_model(name: str, rt: RuntimeDep) -> dict:
    """Return the resolved model name for a Copilot 'auto' actor (once available)."""
    resolved_model = rt.pop_resolved_model(name)
    return {"resolved_model": resolved_model}


@router.post("/actors/{name}/instruct")
async def instruct_actor(name: str, body: InstructRequest, rt: RuntimeDep) -> dict:
    try:
        output = await asyncio.to_thread(rt.instruct, name, body.instruction)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    result: dict = {"name": name, "output": output}
    resolved_model = rt.pop_resolved_model(name)
    _log.info("pop_resolved_model(%r) → %r", name, resolved_model)
    if resolved_model:
        result["resolved_model"] = resolved_model
    return result


@router.post("/actors/{name}/event/{event_name}")
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


@router.get("/actors/{name}/events")
def list_actor_events(name: str, rt: RuntimeDep) -> list[dict]:
    """Return events declared by a code actor (empty for AI actors)."""
    try:
        return rt.get_actor_events(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/actors/{name}/crons")
def list_actor_crons(name: str, rt: RuntimeDep) -> list[dict]:
    """Return cron jobs declared by a code actor (empty for AI actors)."""
    try:
        return rt.get_actor_crons(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/actors/{name}/chat")
async def get_actor_chat(name: str, rt: RuntimeDep) -> dict:
    """Return captured chat/log output from a code actor."""
    try:
        chat = await asyncio.to_thread(rt.get_actor_chat, name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"name": name, "chat": chat}


@router.get("/notifications")
def drain_notifications(rt: RuntimeDep) -> list[dict]:
    """Drain and return accumulated actor-to-actor forwarded-prompt notifications."""
    return rt.drain_notifications()


@router.get("/mcp-log")
def drain_mcp_log() -> list[dict]:
    """Drain and return accumulated MCP tool-call log entries."""
    from studio_api.mcp_server import drain_mcp_log as _drain  # noqa: PLC0415
    return _drain()


@router.get("/actors/{name}/type")
def get_actor_type(name: str, rt: RuntimeDep) -> dict:
    """Return the type of a running actor: 'ai', 'python', or 'typescript'."""
    try:
        actor_type = rt.get_actor_type(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"name": name, "actor_type": actor_type}
