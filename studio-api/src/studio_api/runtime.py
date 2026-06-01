"""ActorRuntime — manages pykka actor lifecycle, cron jobs, and agent resources."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from studio_api.actor import AgentResource, CronJobDef, PromptEventDef, StudioActor
from studio_api.cantica_client import CanticaConnector

_log = logging.getLogger(__name__)


@dataclass
class ActorDef:
    """Serialised form of an actor from the JSON-LD graph."""

    id: str
    name: str
    define_prompt: str
    actor_type: str = "ai"              # "ai" | "python" | "typescript"
    script_path: str = ""               # path to the script (code actors only)
    script_command: str = ""            # runtime command override (typescript actors)
    provider: str = "claude"
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 4096
    max_history: int = 10
    prompt_events: list[dict] = field(default_factory=list)
    cron_jobs: list[dict] = field(default_factory=list)
    outbox: dict[str, str] = field(default_factory=dict)
    resources: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.prompt_events is None:
            self.prompt_events = []
        if self.cron_jobs is None:
            self.cron_jobs = []
        if self.outbox is None:
            self.outbox = {}
        if self.resources is None:
            self.resources = []


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
    if prompt.startswith("cantica://"):
        return connector.resolve_uri_sync(prompt)
    return prompt


class ActorRuntime:
    """Manages running actor instances (AI and code), cron schedules, and agent resources."""

    def __init__(self) -> None:
        self._refs: dict[str, Any] = {}
        self._defs: dict[str, ActorDef] = {}                  # name → ActorDef
        self._resources: dict[str, list[AgentResource]] = {}  # name → resources
        self._code_events: dict[str, list[dict]] = {}         # name → discovered events
        self._code_crons: dict[str, list[dict]] = {}          # name → discovered crons
        self._scheduler = BackgroundScheduler()
        self._scheduler.start()

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self, defn: ActorDef, connector: CanticaConnector) -> None:
        if defn.name in self._refs:
            raise ValueError(f"Actor {defn.name!r} is already running")

        if defn.actor_type in ("python", "typescript"):
            self._start_code_actor(defn)
        else:
            self._start_ai_actor(defn, connector)

    def _start_ai_actor(self, defn: ActorDef, connector: CanticaConnector) -> None:
        system_prompt = _resolve(defn.define_prompt, connector)

        resolved_events = [
            PromptEventDef(
                name=e["name"],
                prompt=_resolve(e.get("prompt", ""), connector),
                file_pattern=e.get("filePattern"),
                target_actor=e.get("targetActor") or None,
                target_event=e.get("targetEvent") or None,
            )
            for e in defn.prompt_events
        ]

        resolved_crons = [
            CronJobDef(
                schedule=c["schedule"],
                prompt=_resolve(c.get("prompt", ""), connector),
                target_actor=c.get("targetActor") or None,
                target_event=c.get("targetEvent") or None,
            )
            for c in defn.cron_jobs
        ]

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
        self._defs[defn.name] = defn
        self._resources[defn.name] = [AgentResource.from_dict(r) for r in defn.resources]
        self._register_crons(defn.name, resolved_crons)
        _log.info("Started AI actor %r", defn.name)

    def _start_code_actor(self, defn: ActorDef) -> None:
        if defn.actor_type == "python":
            from actor_ai import PythonCodeActor  # noqa: PLC0415
            actor_cls = type(
                defn.name,
                (PythonCodeActor,),
                {"script_path": defn.script_path, "actor_name": defn.name},
            )
        else:  # typescript
            from studio_api.code_actor import TypeScriptCodeActor  # noqa: PLC0415
            actor_cls = type(
                defn.name,
                (TypeScriptCodeActor,),
                {
                    "script_path": defn.script_path,
                    "actor_name": defn.name,
                    "script_command": defn.script_command or "node",
                },
            )

        ref = actor_cls.start()
        self._refs[defn.name] = ref
        self._defs[defn.name] = defn
        self._resources[defn.name] = [AgentResource.from_dict(r) for r in defn.resources]

        # Discover events and crons from the running actor (available after on_start).
        proxy = ref.proxy()
        self._code_events[defn.name] = proxy.get_events().get(timeout=15)
        code_crons = proxy.get_crons().get(timeout=15)
        self._code_crons[defn.name] = code_crons
        self._register_code_crons(defn.name, code_crons)
        _log.info("Started %s code actor %r", defn.actor_type, defn.name)

    def stop(self, name: str) -> None:
        ref = self._refs.pop(name, None)
        if ref is None:
            raise KeyError(f"Actor {name!r} is not running")
        self._defs.pop(name, None)
        self._code_events.pop(name, None)
        self._code_crons.pop(name, None)
        try:
            for job in self._scheduler.get_jobs():
                if job.id.startswith(f"cron-{name}-"):
                    self._scheduler.remove_job(job.id)
        except Exception:
            pass
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

    # ── Messaging ─────────────────────────────────────────────────────────────

    def instruct(self, name: str, text: str) -> str:
        proxy = self._get_proxy(name)
        return proxy.instruct(text).get(timeout=120)

    def fire_event(self, name: str, event_name: str, context: str = "") -> str:
        """Fire a named event on an actor, routing to a target actor if configured."""
        defn = self._defs.get(name)
        if defn and defn.actor_type == "ai":
            for e in defn.prompt_events:
                if e["name"] == event_name:
                    target_actor = (e.get("targetActor") or "").strip()
                    target_event = (e.get("targetEvent") or "").strip()
                    if target_actor and target_actor in self._refs:
                        output = self._get_proxy(name).fire_event(event_name, context).get(timeout=120)
                        if target_event:
                            return self.fire_event(target_actor, target_event, output)
                        return self.instruct(target_actor, output)
                    break
        return self._get_proxy(name).fire_event(event_name, context).get(timeout=120)

    def list_running(self) -> list[str]:
        return list(self._refs)

    # ── Code actor introspection ───────────────────────────────────────────────

    def get_actor_type(self, name: str) -> str:
        if name not in self._refs:
            raise KeyError(f"Actor {name!r} is not running")
        defn = self._defs.get(name)
        return defn.actor_type if defn else "ai"

    def get_actor_events(self, name: str) -> list[dict]:
        """Return the discovered events for a code actor (empty list for AI actors)."""
        if name not in self._refs:
            raise KeyError(f"Actor {name!r} is not running")
        return list(self._code_events.get(name, []))

    def get_actor_crons(self, name: str) -> list[dict]:
        """Return the discovered cron jobs for a code actor (empty list for AI actors)."""
        if name not in self._refs:
            raise KeyError(f"Actor {name!r} is not running")
        return list(self._code_crons.get(name, []))

    def get_actor_logs(self, name: str) -> str:
        """Return captured log output for a code actor (empty string for AI actors)."""
        proxy = self._get_proxy(name)
        try:
            return proxy.get_logs().get(timeout=10)
        except Exception:
            return ""

    # ── Agent resources ───────────────────────────────────────────────────────

    def get_resources(self, name: str) -> list[dict]:
        return [r.to_dict() for r in self._resources.get(name, [])]

    def get_accessible_resources(self, actor_name: str) -> list[dict]:
        """Resources owned by the actor plus resources shared with it by others."""
        result = list(self._resources.get(actor_name, []))
        for owner, resources in self._resources.items():
            if owner == actor_name:
                continue
            for r in resources:
                if actor_name in r.shared_with:
                    result.append(r)
        return [r.to_dict() for r in result]

    def add_resource(self, actor_name: str, data: dict) -> dict:
        """Add a dynamic resource to a running actor."""
        if actor_name not in self._refs:
            raise KeyError(f"Actor {actor_name!r} is not running")
        r = AgentResource(
            id=str(uuid.uuid4()),
            name=data.get("name", ""),
            type=data.get("type", "other"),
            uri=data.get("uri", ""),
            description=data.get("description", ""),
            dynamic=True,
            shared_with=[],
        )
        self._resources.setdefault(actor_name, []).append(r)
        _log.info("Actor %r added resource %r", actor_name, r.id)
        return r.to_dict()

    def delete_resource(self, actor_name: str, resource_id: str) -> None:
        """Delete a dynamic, unshared resource (raises if locked)."""
        resources = self._resources.get(actor_name, [])
        for i, r in enumerate(resources):
            if r.id == resource_id:
                if r.locked:
                    raise PermissionError(
                        f"Resource {resource_id!r} is locked "
                        f"({'static' if not r.dynamic else 'shared'})"
                    )
                resources.pop(i)
                _log.info("Actor %r deleted resource %r", actor_name, resource_id)
                return
        raise KeyError(f"Resource {resource_id!r} not found on actor {actor_name!r}")

    def share_resource(self, actor_name: str, resource_id: str, target_actor: str) -> dict:
        """Share a resource with another actor (locks it)."""
        for r in self._resources.get(actor_name, []):
            if r.id == resource_id:
                if target_actor not in r.shared_with:
                    r.shared_with.append(target_actor)
                _log.info("Actor %r shared resource %r with %r", actor_name, resource_id, target_actor)
                return r.to_dict()
        raise KeyError(f"Resource {resource_id!r} not found on actor {actor_name!r}")

    # ── Private helpers ───────────────────────────────────────────────────────

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
                target_actor = cron.target_actor
                target_event = cron.target_event
                prompt = cron.prompt

                def _run(
                    actor_name: str = name,
                    p: str = prompt,
                    ta: str | None = target_actor,
                    te: str | None = target_event,
                ) -> None:
                    try:
                        proxy = self._refs[actor_name].proxy()
                        output = proxy.instruct(p).get(timeout=120)
                        if ta and ta in self._refs:
                            if te:
                                self.fire_event(ta, te, output)
                            else:
                                self.instruct(ta, output)
                    except Exception as exc:
                        _log.error("Cron job for %r failed: %s", actor_name, exc)

                self._scheduler.add_job(_run, trigger, id=job_id, replace_existing=True)
            except Exception as exc:
                _log.warning("Could not register cron %r for actor %r: %s", cron.schedule, name, exc)

    def _register_code_crons(self, name: str, crons: list[dict]) -> None:
        for crn in crons:
            cron_name = crn.get("name", "")
            schedule = crn.get("schedule", "")
            job_id = f"cron-{name}-code-{cron_name}"
            try:
                parts = schedule.split()
                trigger = CronTrigger(
                    minute=parts[0] if len(parts) > 0 else "*",
                    hour=parts[1] if len(parts) > 1 else "*",
                    day=parts[2] if len(parts) > 2 else "*",
                    month=parts[3] if len(parts) > 3 else "*",
                    day_of_week=parts[4] if len(parts) > 4 else "*",
                )

                def _run(actor_name: str = name, cn: str = cron_name) -> None:
                    try:
                        proxy = self._refs[actor_name].proxy()
                        proxy.run_cron(cn).get(timeout=120)
                    except Exception as exc:
                        _log.error("Code cron %r for actor %r failed: %s", cn, actor_name, exc)

                self._scheduler.add_job(_run, trigger, id=job_id, replace_existing=True)
            except Exception as exc:
                _log.warning(
                    "Could not register code cron %r for actor %r: %s", cron_name, name, exc
                )
