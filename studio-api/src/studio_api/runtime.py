"""ActorRuntime — manages pykka actor lifecycle and APScheduler cron jobs."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from studio_api.actor import CronJobDef, PromptEventDef, StudioActor
from studio_api.cantica_client import CanticaConnector

_log = logging.getLogger(__name__)


@dataclass
class ActorDef:
    """Serialised form of an actor from the JSON-LD graph."""

    id: str
    name: str
    define_prompt: str          # cantica:// URI or raw content
    provider: str = "claude"
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 4096
    max_history: int = 10
    prompt_events: list[dict] = None   # type: ignore[assignment]
    cron_jobs: list[dict] = None       # type: ignore[assignment]
    outbox: dict[str, str] = None      # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.prompt_events is None:
            self.prompt_events = []
        if self.cron_jobs is None:
            self.cron_jobs = []
        if self.outbox is None:
            self.outbox = {}


def _make_provider(provider: str, model: str) -> Any:
    from actor_ai import Claude, GPT, Gemini  # noqa: PLC0415

    p = provider.lower()
    if p == "claude":
        return Claude(model)
    if p in ("gpt", "openai"):
        return GPT(model)
    if p == "gemini":
        return Gemini(model)
    return Claude(model)


def _resolve(prompt: str, connector: CanticaConnector) -> str:
    """Resolve a cantica:// URI to content, or pass through raw content."""
    if prompt.startswith("cantica://"):
        return connector.resolve_uri_sync(prompt)
    return prompt


class ActorRuntime:
    """Manages running StudioActor instances and their cron schedules."""

    def __init__(self) -> None:
        self._refs: dict[str, Any] = {}          # name → pykka ActorRef
        self._scheduler = BackgroundScheduler()
        self._scheduler.start()

    def start(self, defn: ActorDef, connector: CanticaConnector) -> None:
        if defn.name in self._refs:
            raise ValueError(f"Actor {defn.name!r} is already running")

        # Resolve all prompts up front so the actor never needs the connector
        system_prompt = _resolve(defn.define_prompt, connector)

        resolved_events = [
            PromptEventDef(
                name=e["name"],
                prompt=_resolve(e.get("prompt", ""), connector),
                file_pattern=e.get("filePattern"),
            )
            for e in defn.prompt_events
        ]

        resolved_crons = [
            CronJobDef(
                schedule=c["schedule"],
                prompt=_resolve(c.get("prompt", ""), connector),
            )
            for c in defn.cron_jobs
        ]

        # Build a per-actor subclass so class-level attributes are isolated
        actor_cls = type(
            defn.name,
            (StudioActor,),
            {
                "system_prompt": system_prompt,
                "actor_name": defn.name,
                "provider": _make_provider(defn.provider, defn.model),
                "max_tokens": defn.max_tokens,
                "max_history": defn.max_history,
                "prompt_events": resolved_events,
                "cron_jobs": resolved_crons,
                "outbox": dict(defn.outbox),
            },
        )

        ref = actor_cls.start()
        self._refs[defn.name] = ref
        self._register_crons(defn.name, resolved_crons)
        _log.info("Started actor %r", defn.name)

    def stop(self, name: str) -> None:
        ref = self._refs.pop(name, None)
        if ref is None:
            raise KeyError(f"Actor {name!r} is not running")
        self._scheduler.remove_job(f"cron-{name}", jobstore=None)  # ignore if absent
        try:
            ref.stop()
        except Exception:
            pass
        _log.info("Stopped actor %r", name)

    def stop_all(self) -> None:
        for name in list(self._refs):
            try:
                self.stop(name)
            except Exception:
                pass
        try:
            self._scheduler.shutdown(wait=False)
        except Exception:
            pass

    def instruct(self, name: str, text: str) -> str:
        proxy = self._get_proxy(name)
        return proxy.instruct(text).get(timeout=120)

    def fire_event(self, name: str, event_name: str, context: str = "") -> str:
        proxy = self._get_proxy(name)
        return proxy.fire_event(event_name, context).get(timeout=120)

    def list_running(self) -> list[str]:
        return list(self._refs)

    def _get_proxy(self, name: str) -> Any:
        ref = self._refs.get(name)
        if ref is None:
            raise KeyError(f"Actor {name!r} is not running")
        return ref.proxy()

    def _register_crons(self, name: str, crons: list[CronJobDef]) -> None:
        for i, cron in enumerate(crons):
            job_id = f"cron-{name}-{i}"
            try:
                parts = cron.schedule.split()
                trigger = CronTrigger(
                    minute=parts[0] if len(parts) > 0 else "*",
                    hour=parts[1] if len(parts) > 1 else "*",
                    day=parts[2] if len(parts) > 2 else "*",
                    month=parts[3] if len(parts) > 3 else "*",
                    day_of_week=parts[4] if len(parts) > 4 else "*",
                )
                prompt = cron.prompt

                def _run(actor_name: str = name, p: str = prompt) -> None:
                    try:
                        proxy = self._refs[actor_name].proxy()
                        proxy.instruct(p).get(timeout=120)
                    except Exception as exc:
                        _log.error("Cron job for %r failed: %s", actor_name, exc)

                self._scheduler.add_job(_run, trigger, id=job_id, replace_existing=True)
            except Exception as exc:
                _log.warning("Could not register cron %r for actor %r: %s", cron.schedule, name, exc)
