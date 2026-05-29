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
    define_prompt: str = ""
    provider: str = "claude"
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 4096
    max_history: int = 10
    prompt_events: list[dict] = []
    cron_jobs: list[dict] = []
    outbox: dict[str, str] = {}


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
        define_prompt=body.define_prompt,
        provider=body.provider,
        model=body.model,
        max_tokens=body.max_tokens,
        max_history=body.max_history,
        prompt_events=body.prompt_events,
        cron_jobs=body.cron_jobs,
        outbox=body.outbox,
    )
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _rt().start, defn, _cn())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"name": body.name, "status": "running"}


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
        output = await loop.run_in_executor(
            None, _rt().fire_event, name, event_name, body.context
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"name": name, "event": event_name, "output": output}
