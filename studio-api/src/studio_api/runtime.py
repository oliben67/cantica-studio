"""ActorRuntime — manages pykka actor lifecycle, cron jobs, and agent resources."""

from __future__ import annotations

import json
import logging
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from studio_api.actor import AgentResource, CronJobDef, PromptEventDef, StudioActor
from studio_api.cantica_client import CanticaConnector

_log = logging.getLogger(__name__)


@dataclass
class ActorDef:
    """Serialised form of an actor from the JSON-LD graph."""

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
    directory: str = ""                  # optional working directory exposed via MCP filesystem
    songbook_file: str = ""              # path to the .jsonld file this actor was started from


@dataclass
class _ActorState:
    """All runtime state for a single actor, keyed by name in ActorRuntime._actors."""

    ref: Any
    defn: ActorDef
    resources: list[AgentResource] = field(default_factory=list)
    ai_events: list[PromptEventDef] = field(default_factory=list)
    code_events: list[dict] = field(default_factory=list)
    code_crons: list[dict] = field(default_factory=list)
    paused: bool = False
    queued: list[str] = field(default_factory=list)
    # AI-only: reference to the provider object so we can read resolved_model after inference.
    provider: Any | None = None


def _make_provider(provider: str, model: str, api_key: str | None = None) -> Any:
    from actor_ai import GPT, Claude, Copilot, Gemini, Mistral  # noqa: PLC0415

    p = provider.lower()
    if p == "claude":
        return Claude(model, api_key=api_key) if api_key else Claude(model)
    if p in ("gpt", "openai"):
        return GPT(model, api_key=api_key) if api_key else GPT(model)
    if p == "gemini":
        return Gemini(model, api_key=api_key) if api_key else Gemini(model)
    if p == "copilot":
        return Copilot(model, use_sdk=True, timeout=300.0, api_key=api_key)
    if p == "mistral":
        return Mistral(model, api_key=api_key) if api_key else Mistral(model)
    raise ValueError(
        f"Unknown provider {provider!r}. "
        "Expected one of: claude, gpt, openai, gemini, copilot, mistral."
    )


def _make_event_provider(provider: str, model: str, api_key: str | None = None) -> Any:
    """Return a stateless provider for fire_event's nested LLM call.

    The SDK-mode Copilot provider uses a subprocess-based session; calling it
    concurrently from inside an active tool dispatch creates two overlapping CLI
    sessions that share state → 400 "Duplicate function-call ID" errors.
    Using the OpenAI-compatible HTTP endpoint (use_sdk=False) for the nested
    call sidesteps the subprocess entirely.  All other providers are stateless
    HTTP by default and can reuse the same factory.
    """
    from actor_ai import GPT, Claude, Copilot, Gemini, Mistral  # noqa: PLC0415

    p = provider.lower()
    if p == "copilot":
        return Copilot(model, use_sdk=False, timeout=300.0, api_key=api_key)
    if p == "claude":
        return Claude(model, api_key=api_key) if api_key else Claude(model)
    if p in ("gpt", "openai"):
        return GPT(model, api_key=api_key) if api_key else GPT(model)
    if p == "gemini":
        return Gemini(model, api_key=api_key) if api_key else Gemini(model)
    if p == "mistral":
        return Mistral(model, api_key=api_key) if api_key else Mistral(model)
    raise ValueError(f"Unknown provider {provider!r}")


def _make_cron_trigger(schedule: str) -> CronTrigger:
    return CronTrigger.from_crontab(schedule)


def _resolve(prompt: str, connector: CanticaConnector) -> str:
    if prompt.startswith("cantica://"):
        return connector.resolve_uri_sync(prompt)
    return prompt


class ActorRuntime:
    """Manages running actor instances (AI and code), cron schedules, and agent resources."""

    def __init__(self, sessions_dir: Path | None = None, db_engine: Engine | None = None) -> None:
        self._actors: dict[str, _ActorState] = {}
        self._sessions_dir = sessions_dir
        self._db_engine = db_engine
        self._scheduler = BackgroundScheduler()
        self._scheduler.start()
        # Thread-safe log of actor-to-actor forwarded calls (populated by _instruct_actor
        # wrappers, drained by the extension after each API call).
        self._forwarded_log: list[dict] = []
        self._forwarded_log_lock = threading.Lock()

    def _token_for_provider(self, provider_type: str) -> str | None:
        """Look up the first active token for a provider type from the DB."""
        if self._db_engine is None:
            return None
        try:
            # Third party imports:
            from sqlalchemy import select  # noqa: PLC0415
            from sqlalchemy.orm import Session  # noqa: PLC0415

            # Local imports:
            from studio_api.orm.models import Provider, ProviderToken  # noqa: PLC0415

            with Session(self._db_engine) as session:
                return session.scalar(
                    select(ProviderToken.token)
                    .join(Provider, ProviderToken.provider_id == Provider.id)
                    .where(
                        Provider.type == provider_type,
                        Provider.is_active.is_(True),
                        ProviderToken.is_active.is_(True),
                    )
                    .limit(1)
                )
        except Exception as exc:
            _log.debug("Could not look up token for %r: %s", provider_type, exc)
            return None

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self, defn: ActorDef, connector: CanticaConnector) -> str | None:
        """Start an actor. Returns the warm-up output when a fresh AI actor is initialised."""
        if defn.name in self._actors:
            raise ValueError(f"Actor {defn.name!r} is already running")

        if defn.actor_type in ("python", "typescript"):
            self._start_code_actor(defn)
            return None
        return self._start_ai_actor(defn, connector)

    def _start_ai_actor(self, defn: ActorDef, connector: CanticaConnector) -> str | None:
        system_prompt = _resolve(defn.define_prompt, connector)
        # Inject routing instructions for events that forward to other actors.
        # Without this, the LLM has no reason to call the fire_event tool.
        routing_lines = []
        for e in defn.prompt_events:
            targets = e.get("targetActors") or ([e["targetActor"]] if e.get("targetActor") else [])
            if targets:
                event_name = e["name"]
                target_list = ", ".join(targets)
                routing_lines.append(
                    f'- After your response, call fire_event(event_name="{event_name}", context="<your response>") → forwards to: {target_list}'
                )
        if routing_lines:
            system_prompt = system_prompt + "\n\n## Output routing\nThis actor is connected to other actors. You MUST call fire_event after every response:\n" + "\n".join(routing_lines)

        resolved_events = [
            PromptEventDef(
                name=e["name"],
                prompt=_resolve(e.get("prompt", ""), connector),
                file_pattern=e.get("filePattern"),
                # Support both new targetActors[] and legacy single targetActor string.
                target_actors=e.get("targetActors") or (
                    [e["targetActor"]] if e.get("targetActor") else []
                ),
                send_response=bool(e.get("sendResponse", False)),
            )
            for e in defn.prompt_events
        ]

        resolved_crons = [
            CronJobDef(
                schedule=c["schedule"],
                prompt=_resolve(c.get("prompt", ""), connector),
                name=c.get("name", ""),
                target_actor=c.get("targetActor") or None,
                target_event=c.get("targetEvent") or None,
                send_response=bool(c.get("sendResponse", False)),
            )
            for c in defn.cron_jobs
        ]

        # Look up the provider token from the DB (populated by syncProviderKeys from VS Code).
        # This lets the actor use the stored token even if the env var wasn't set at startup.
        api_key = self._token_for_provider(defn.provider.lower())

        # For sendResponse=True events: create a stateless HTTP clone of the provider
        # so that fire_event's nested LLM call doesn't run concurrently with the outer
        # SDK session (which would produce duplicate function-call IDs).  Non-fatal —
        # the actor's main provider is used as fallback if this fails (e.g. missing token).
        try:
            event_provider: Any | None = _make_event_provider(defn.provider, defn.model, api_key)
        except Exception as exc:
            _log.warning("Could not create event provider for %r — falling back: %s", defn.name, exc)
            event_provider = None

        main_provider = _make_provider(defn.provider, defn.model, api_key)
        actor_cls = type(
            defn.name,
            (StudioActor,),
            {
                "system_prompt": system_prompt,
                "actor_name": defn.name,
                "provider": main_provider,
                "_event_provider": event_provider,
                "max_tokens": defn.max_tokens,
                "max_history": defn.max_history,
                "prompt_events": resolved_events,
                "cron_jobs": resolved_crons,
                "outbox": dict(defn.outbox),
                # Wraps instruct() so that actor-to-actor forwards triggered by the
                # LLM's fire_event tool are recorded in _forwarded_log.  The extension
                # drains this log after each API call and pushes actorOutput messages
                # to the webview so the receiver's chat panel shows the incoming prompt.
                # staticmethod prevents Python's descriptor protocol from binding the
                # actor instance as the first argument when accessed via self._instruct_actor.
                "_instruct_actor": staticmethod(self._make_instruct_actor()),
            },
        )

        ref = actor_cls.start()
        self._actors[defn.name] = _ActorState(
            ref=ref,
            defn=defn,
            resources=self._build_resources(defn),
            ai_events=resolved_events,
            provider=main_provider,
        )
        self._register_crons(defn.name, resolved_crons)

        proxy = ref.proxy()
        saved_session = self._load_session(defn.name)
        if saved_session:
            proxy.restore_session(saved_session).get(timeout=5)
            _log.info("Restored %d message(s) for actor %r", len(saved_session), defn.name)

        # Proactively resolve Copilot 'auto' model in a daemon thread.
        # When done, push an actorModelResolved notification so the frontend
        # updates without needing a separate client-side poll.
        if defn.provider.lower() == "copilot" and defn.model == "auto":
            actor_name = defn.name
            provider_ref = main_provider

            def _probe_and_notify() -> None:
                try:
                    resolved = provider_ref.probe_resolved_model()
                    if resolved and actor_name in self._actors:
                        with self._forwarded_log_lock:
                            self._forwarded_log.append({
                                "type": "actorModelResolved",
                                "name": actor_name,
                                "model": resolved,
                            })
                        _log.info("Actor %r: probed resolved model %r", actor_name, resolved)
                except Exception as exc:
                    _log.debug("Actor %r: model probe failed: %s", actor_name, exc)

            threading.Thread(target=_probe_and_notify, daemon=True).start()

        _log.info("Started AI actor %r", defn.name)
        return None

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
        proxy = ref.proxy()
        code_events = proxy.get_events().get(timeout=15)
        code_crons = proxy.get_crons().get(timeout=15)
        self._actors[defn.name] = _ActorState(
            ref=ref,
            defn=defn,
            resources=self._build_resources(defn),
            code_events=code_events,
            code_crons=code_crons,
        )
        self._register_code_crons(defn.name, code_crons)
        _log.info("Started %s code actor %r", defn.actor_type, defn.name)

    def pause(self, name: str) -> None:
        if name not in self._actors:
            raise KeyError(f"Actor {name!r} is not running")
        self._actors[name].paused = True
        _log.info("Paused actor %r", name)

    def resume(self, name: str) -> int:
        """Unpause an actor and flush its queued instructions. Returns the number flushed."""
        if name not in self._actors:
            raise KeyError(f"Actor {name!r} is not running")
        state = self._actors[name]
        state.paused = False
        queued = state.queued[:]
        state.queued.clear()
        for instruction in queued:
            try:
                self._actors[name].ref.proxy().instruct(instruction).get(timeout=360)
            except Exception as exc:
                _log.error("Failed to flush queued instruction for %r: %s", name, exc)
        _log.info("Resumed actor %r, flushed %d queued instruction(s)", name, len(queued))
        return len(queued)

    def is_paused(self, name: str) -> bool:
        state = self._actors.get(name)
        return state.paused if state else False

    def stop(self, name: str) -> None:
        state = self._actors.pop(name, None)
        if state is None:
            raise KeyError(f"Actor {name!r} is not running")
        try:
            for job in self._scheduler.get_jobs():
                if job.id.startswith(f"cron-{name}-"):
                    self._scheduler.remove_job(job.id)
        except Exception:
            pass
        try:
            session = state.ref.proxy().get_session().get(timeout=5)
            if session:
                self._save_session(name, session)
        except Exception as exc:
            _log.warning("Could not save session for actor %r: %s", name, exc)
        try:
            state.ref.stop()
        except Exception:
            pass
        _log.info("Stopped actor %r", name)

    def stop_all(self) -> None:
        for name in list(self._actors):
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
        state = self._actors.get(name)
        if state is None:
            raise KeyError(f"Actor {name!r} is not running")
        if state.paused:
            state.queued.append(text)
            _log.info("Actor %r is paused — queued instruction (%d total)", name, len(state.queued))
            return f"⏸ Queued (actor is paused — {len(state.queued)} instruction(s) pending)"
        was_resolved = getattr(state.provider, "resolved_model", None)
        result = state.ref.proxy().instruct(text).get(timeout=360)
        now_resolved = getattr(state.provider, "resolved_model", None)
        if now_resolved and now_resolved != was_resolved:
            with self._forwarded_log_lock:
                self._forwarded_log.append({
                    "type": "actorModelResolved",
                    "name": name,
                    "model": now_resolved,
                })
        return result

    def fire_event(self, name: str, event_name: str, context: str = "") -> dict:
        """Fire a named event on an actor, routing output to all configured target actors.

        Returns {"output": str, "forwarded": [{"name": str, "prompt": str, "output": str}]}.
        For AI actors: runs the event's resolved prompt via instruct() on self, then
        forwards the output to every target actor listed in target_actors.  If no
        target actors are configured the output is returned to the caller (self-loop).
        For code actors (or when the event is not found) delegates to proxy.fire_event.
        """
        state = self._actors.get(name)
        if state:
            for evt in state.ai_events:
                if evt.name == event_name:
                    instruction = f"{evt.prompt}\n\n{context}" if context else evt.prompt
                    output = state.ref.proxy().instruct(instruction).get(timeout=360)
                    forwarded = []
                    for target in evt.target_actors:
                        if target and target in self._actors:
                            target_output = self.instruct(target, output)
                            forwarded.append({"name": target, "prompt": output, "output": target_output})
                    return {"output": output, "forwarded": forwarded}
        output = self._get_proxy(name).fire_event(event_name, context).get(timeout=360)
        return {"output": output, "forwarded": []}

    def list_running(self) -> list[str]:
        return list(self._actors)

    def get_actors_summary(self) -> list[dict]:
        """Return a summary of all running actors, merging runtime state with monitor snapshots."""
        from actor_ai.monitor import ActorMonitor  # noqa: PLC0415

        snapshots = ActorMonitor.list_all()
        snap_by_name: dict[str, Any] = {}
        for s in snapshots:
            if s.actor_name and s.actor_name not in snap_by_name:
                snap_by_name[s.actor_name] = s

        result: list[dict] = []
        seen_names: set[str] = set()

        for name, state in self._actors.items():
            seen_names.add(name)
            snap = snap_by_name.get(name)
            defn = state.defn
            model = None
            if defn.actor_type == "ai":
                model = getattr(state.provider, "resolved_model", None) or defn.model
            result.append({
                "name": name,
                "urn": snap.urn if snap else None,
                "actor_type": defn.actor_type,
                "provider": defn.provider if defn.actor_type == "ai" else None,
                "model": model,
                "songbook_file": defn.songbook_file,
                "started_at": snap.started_at.isoformat() if snap else None,
                "state": snap.state.value if snap else "idle",
            })

        for snap in snapshots:
            if snap.actor_name is not None and snap.actor_name in seen_names:
                continue
            result.append({
                "name": snap.actor_name or snap.actor_class,
                "urn": snap.urn,
                "actor_type": "unknown",
                "provider": None,
                "model": None,
                "songbook_file": "",
                "started_at": snap.started_at.isoformat(),
                "state": snap.state.value,
            })

        return result

    # ── Code actor introspection ───────────────────────────────────────────────

    def get_actor_type(self, name: str) -> str:
        if name not in self._actors:
            raise KeyError(f"Actor {name!r} is not running")
        return self._actors[name].defn.actor_type

    def get_actor_events(self, name: str) -> list[dict]:
        """Return the discovered events for a code actor (empty list for AI actors)."""
        if name not in self._actors:
            raise KeyError(f"Actor {name!r} is not running")
        return list(self._actors[name].code_events)

    def get_actor_crons(self, name: str) -> list[dict]:
        """Return the discovered cron jobs for a code actor (empty list for AI actors)."""
        if name not in self._actors:
            raise KeyError(f"Actor {name!r} is not running")
        return list(self._actors[name].code_crons)

    def get_actor_chat(self, name: str) -> str:
        """Return captured log output for a code actor (empty string for AI actors)."""
        proxy = self._get_proxy(name)
        try:
            return proxy.get_logs().get(timeout=10)
        except Exception:
            return ""

    def get_resolved_model(self, name: str) -> str | None:
        """Return the model that Copilot resolved 'auto' to, or None if not yet resolved."""
        state = self._actors.get(name)
        if state is None:
            raise KeyError(name)
        return getattr(state.provider, "resolved_model", None)

    # ── Agent resources ───────────────────────────────────────────────────────

    def get_resources(self, name: str) -> list[dict]:
        state = self._actors.get(name)
        return [r.to_dict() for r in (state.resources if state else [])]

    def get_accessible_resources(self, actor_name: str) -> list[dict]:
        """Resources owned by the actor plus resources shared with it by others."""
        state = self._actors.get(actor_name)
        result = list(state.resources if state else [])
        for owner, s in self._actors.items():
            if owner == actor_name:
                continue
            for r in s.resources:
                if actor_name in r.shared_with:
                    result.append(r)
        return [r.to_dict() for r in result]

    def add_resource(self, actor_name: str, data: dict) -> dict:
        """Add a dynamic resource to a running actor."""
        if actor_name not in self._actors:
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
        self._actors[actor_name].resources.append(r)
        _log.info("Actor %r added resource %r", actor_name, r.id)
        return r.to_dict()

    def delete_resource(self, actor_name: str, resource_id: str) -> None:
        """Delete a dynamic, unshared resource (raises if locked)."""
        resources = self._actors[actor_name].resources if actor_name in self._actors else []
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
        resources = self._actors[actor_name].resources if actor_name in self._actors else []
        for r in resources:
            if r.id == resource_id:
                if target_actor not in r.shared_with:
                    r.shared_with.append(target_actor)
                _log.info("Actor %r shared resource %r with %r", actor_name, resource_id, target_actor)
                return r.to_dict()
        raise KeyError(f"Resource {resource_id!r} not found on actor {actor_name!r}")

    # ── Notification log ──────────────────────────────────────────────────────

    def drain_notifications(self) -> list[dict]:
        """Return and clear all accumulated forwarded-prompt notifications.

        Each entry has the shape ``{"name": str, "prompt": str, "output": str}``
        matching the ``forwarded`` items returned by :meth:`fire_event`.
        """
        with self._forwarded_log_lock:
            items = list(self._forwarded_log)
            self._forwarded_log.clear()
        return items

    def _make_instruct_actor(self):
        """Return an _instruct_actor callback that records each call in the log.

        On KeyError (target actor not running), logs a visible warning to the
        notification log so the receiver's chat panel shows the failure rather
        than silently swallowing it.
        """
        def _instruct_actor(actor_name: str, instruction: str) -> str:
            try:
                result = self.instruct(actor_name, instruction)
            except KeyError:
                error = f"⚠ Actor '{actor_name}' is not running — forward failed. Start all actors with Play (▶) first."
                _log.warning("_instruct_actor: target %r not running", actor_name)
                with self._forwarded_log_lock:
                    self._forwarded_log.append(
                        {"name": actor_name, "prompt": instruction, "output": error}
                    )
                return error
            except Exception as exc:
                error = f"⚠ Forward to '{actor_name}' failed: {exc}"
                _log.error("_instruct_actor: instruct(%r) raised: %s", actor_name, exc, exc_info=True)
                with self._forwarded_log_lock:
                    self._forwarded_log.append(
                        {"name": actor_name, "prompt": instruction, "output": error}
                    )
                return error
            with self._forwarded_log_lock:
                self._forwarded_log.append(
                    {"name": actor_name, "prompt": instruction, "output": result}
                )
            return result
        return _instruct_actor

    # ── Private helpers ───────────────────────────────────────────────────────

    def _build_resources(self, defn: ActorDef) -> list[AgentResource]:
        """Build the initial resource list, prepending a directory resource when configured."""
        resources = [AgentResource.from_dict(r) for r in defn.resources]
        if defn.directory:
            dir_name = Path(defn.directory).name or "workspace"
            resources.insert(0, AgentResource(
                id="directory",
                name=dir_name,
                type="directory",
                uri=defn.directory,
                description=f"Working directory: {defn.directory}",
                dynamic=False,
                shared_with=[],
            ))
        return resources

    def _get_proxy(self, name: str) -> Any:
        state = self._actors.get(name)
        if state is None:
            raise KeyError(f"Actor {name!r} is not running")
        return state.ref.proxy()

    def _save_session(self, name: str, session: list[dict]) -> None:
        if self._sessions_dir is None:
            return
        try:
            self._sessions_dir.mkdir(parents=True, exist_ok=True)
            path = self._sessions_dir / f"{name}.json"
            path.write_text(json.dumps(session, ensure_ascii=False, indent=2), encoding="utf-8")
            _log.debug("Saved %d message(s) for actor %r", len(session), name)
        except Exception as exc:
            _log.warning("Failed to save session for actor %r: %s", name, exc)

    def _load_session(self, name: str) -> list[dict]:
        if self._sessions_dir is None:
            return []
        path = self._sessions_dir / f"{name}.json"
        if not path.exists():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception as exc:
            _log.warning("Failed to load session for actor %r: %s", name, exc)
            return []

    def _register_crons(self, name: str, crons: list[CronJobDef]) -> None:
        if not crons:
            return
        if not self._scheduler.running:
            self._scheduler.start()
        for i, cron in enumerate(crons):
            label = cron.name
            job_id = f"cron-{name}-{i}-{label}"
            try:
                trigger = _make_cron_trigger(cron.schedule)
                target_actor = cron.target_actor
                target_event = cron.target_event
                prompt = cron.prompt
                send_response = cron.send_response

                def _run(
                    actor_name: str = name,
                    p: str = prompt,
                    lbl: str = label,
                    ta: str | None = target_actor,
                    te: str | None = target_event,
                    sr: bool = send_response,
                ) -> None:
                    state = self._actors.get(actor_name)
                    if state is None or state.paused:
                        _log.debug("Skipping cron for paused/stopped actor %r", actor_name)
                        return
                    try:
                        if ta and ta in self._actors and not sr:
                            # sendResponse=False with target: bypass source, send directly.
                            with self._forwarded_log_lock:
                                self._forwarded_log.append({
                                    "name": actor_name,
                                    "prompt": f"⏰ {lbl}" if lbl else "⏰",
                                    "output": f"→ sending to '{ta}'",
                                })
                            if te:
                                result = self.fire_event(ta, te, p)
                                with self._forwarded_log_lock:
                                    self._forwarded_log.extend(result.get("forwarded", []))
                            else:
                                target_output = self.instruct(ta, p)
                                with self._forwarded_log_lock:
                                    self._forwarded_log.append({"name": ta, "prompt": p, "output": target_output})
                        else:
                            # sendResponse=True, or no target: instruct source actor first.
                            output = state.ref.proxy().instruct(p).get(timeout=360)
                            with self._forwarded_log_lock:
                                self._forwarded_log.append({"name": actor_name, "prompt": p, "output": output})
                            if ta and ta in self._actors:
                                if te:
                                    result = self.fire_event(ta, te, output)
                                    with self._forwarded_log_lock:
                                        self._forwarded_log.extend(result.get("forwarded", []))
                                else:
                                    target_output = self.instruct(ta, output)
                                    with self._forwarded_log_lock:
                                        self._forwarded_log.append({"name": ta, "prompt": output, "output": target_output})
                    except Exception as exc:
                        _log.error("Cron job for %r failed: %s", actor_name, exc)

                self._scheduler.add_job(_run, trigger, id=job_id, replace_existing=True)
            except Exception as exc:
                _log.warning("Could not register cron %r for actor %r: %s", cron.schedule, name, exc)

    def _register_code_crons(self, name: str, crons: list[dict]) -> None:
        if not crons:
            return
        if not self._scheduler.running:
            self._scheduler.start()
        for crn in crons:
            cron_name = crn.get("name", "")
            schedule = crn.get("schedule", "")
            job_id = f"cron-{name}-code-{cron_name}"
            try:
                trigger = _make_cron_trigger(schedule)

                def _run(actor_name: str = name, cn: str = cron_name) -> None:
                    state = self._actors.get(actor_name)
                    if state is None:
                        return
                    try:
                        state.ref.proxy().run_cron(cn).get(timeout=360)
                    except Exception as exc:
                        _log.error("Code cron %r for actor %r failed: %s", cn, actor_name, exc)

                self._scheduler.add_job(_run, trigger, id=job_id, replace_existing=True)
            except Exception as exc:
                _log.warning(
                    "Could not register code cron %r for actor %r: %s", cron_name, name, exc
                )
