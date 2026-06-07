"""Runtime endpoints — start/stop/instruct running actor instances."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from studio_api.runtime import ActorDef, ActorRuntime
from studio_api.cantica_client import CanticaConnector

_log = logging.getLogger(__name__)
router = APIRouter()

_runtime: ActorRuntime | None = None
_connector: CanticaConnector | None = None


def init(runtime: ActorRuntime, connector: CanticaConnector) -> None:
    global _runtime, _connector
    _runtime = runtime
    _connector = connector


def _rt() -> ActorRuntime:
    if _runtime is None:
        raise RuntimeError("ActorRuntime not initialised")
    return _runtime


def _cn() -> CanticaConnector:
    if _connector is None:
        raise RuntimeError("CanticaConnector not initialised")
    return _connector


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
def list_actors() -> list[str]:
    return _rt().list_running()


@router.post("/actors", status_code=201)
async def start_actor(body: StartActorRequest) -> dict:
    defn = ActorDef(
        id=f"urn:cantica:studio:actor:{body.name}",
        name=body.name,
        actor_type=body.actor_type,
        script_path=body.script_path,
        script_command=body.script_command,
        define_prompt=body.define_prompt,
        provider=body.provider,
        model=body.model,
        max_tokens=body.max_tokens,
        max_history=body.max_history,
        prompt_events=body.prompt_events,
        cron_jobs=body.cron_jobs,
        outbox=body.outbox,
        resources=body.resources,
        directory=body.directory,
    )
    try:
        loop = asyncio.get_event_loop()
        initial_output = await loop.run_in_executor(None, _rt().start, defn, _cn())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    result: dict = {"name": body.name, "status": "running", "actor_type": body.actor_type}
    if initial_output:
        result["initial_output"] = initial_output
    return result


@router.post("/actors/{name}/pause")
def pause_actor(name: str) -> dict:
    try:
        _rt().pause(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"name": name, "status": "paused"}


@router.post("/actors/{name}/resume")
def resume_actor(name: str) -> dict:
    try:
        flushed = _rt().resume(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"name": name, "status": "running", "queued_flushed": flushed}


@router.delete("/actors/{name}", status_code=204)
async def stop_actor(name: str) -> None:
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _rt().stop, name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/actors/{name}/instruct")
async def instruct_actor(name: str, body: InstructRequest) -> dict:
    try:
        loop = asyncio.get_event_loop()
        output = await loop.run_in_executor(
            None, _rt().instruct, name, body.instruction
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"name": name, "output": output}


@router.post("/actors/{name}/event/{event_name}")
async def fire_event(name: str, event_name: str, body: EventRequest) -> dict:
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, _rt().fire_event, name, event_name, body.context
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"name": name, "event": event_name, "output": result["output"], "forwarded": result.get("forwarded", [])}


@router.get("/actors/{name}/events")
def list_actor_events(name: str) -> list[dict]:
    """Return events declared by a code actor (empty for AI actors)."""
    try:
        return _rt().get_actor_events(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/actors/{name}/crons")
def list_actor_crons(name: str) -> list[dict]:
    """Return cron jobs declared by a code actor (empty for AI actors)."""
    try:
        return _rt().get_actor_crons(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/actors/{name}/chat")
async def get_actor_chat(name: str) -> dict:
    """Return captured chat/log output from a code actor."""
    try:
        loop = asyncio.get_event_loop()
        chat = await loop.run_in_executor(None, _rt().get_actor_chat, name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"name": name, "chat": chat}


@router.get("/notifications")
def drain_notifications() -> list[dict]:
    """Drain and return accumulated actor-to-actor forwarded-prompt notifications.

    Each item has ``{"name": str, "prompt": str, "output": str}``.
    The extension calls this after every ``instructActor`` call to push
    forwarded prompts to the receiver's chat panel in the webview.
    """
    return _rt().drain_notifications()


@router.get("/actors/{name}/type")
def get_actor_type(name: str) -> dict:
    """Return the type of a running actor: 'ai', 'python', or 'typescript'."""
    try:
        actor_type = _rt().get_actor_type(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"name": name, "actor_type": actor_type}
