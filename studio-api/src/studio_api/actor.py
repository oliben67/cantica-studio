"""StudioActor — extends actor_ai.AIActor with prompt events, cron jobs, and message routing."""

from __future__ import annotations

import concurrent.futures
import logging
from collections.abc import Callable
from dataclasses import dataclass, field

from actor_ai import AIActor, tool

_log = logging.getLogger(__name__)


@dataclass
class PromptEventDef:
    name: str
    prompt: str                          # resolved content (not a URI at runtime)
    file_pattern: str | None = None
    target_actors: list[str] = field(default_factory=list)  # actors to route output to (empty = self)


@dataclass
class CronJobDef:
    schedule: str
    prompt: str                     # resolved content
    name: str                        # human-readable label, required
    target_actor: str | None = None
    target_event: str | None = None


@dataclass
class AgentResource:
    """An MCP-addressable resource owned by an actor."""

    id: str
    name: str
    type: str                           # 'file' | 'api' | 'text' | 'other'
    uri: str
    description: str = ""
    dynamic: bool = False               # True = created at runtime
    shared_with: list[str] = field(default_factory=list)

    @property
    def locked(self) -> bool:
        """Locked if static (not dynamic) or has been shared with another actor."""
        return not self.dynamic or bool(self.shared_with)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "uri": self.uri,
            "description": self.description,
            "dynamic": self.dynamic,
            "sharedWith": list(self.shared_with),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AgentResource":
        return cls(
            id=d["id"],
            name=d.get("name", d["id"]),
            type=d.get("type", "other"),
            uri=d.get("uri", ""),
            description=d.get("description", ""),
            dynamic=d.get("dynamic", False),
            shared_with=list(d.get("sharedWith", [])),
        )


class StudioActor(AIActor):
    """AIActor subclass with prompt events, cron jobs, and actor-to-actor messaging."""

    prompt_events: list[PromptEventDef] = field(default_factory=list)
    cron_jobs: list[CronJobDef] = field(default_factory=list)
    outbox: dict[str, str] = field(default_factory=dict)

    # Injected by ActorRuntime._start_ai_actor so fire_event can forward to target actors
    # without going through self's pykka proxy (which would deadlock).
    # Signature: (actor_name: str, instruction: str) -> str
    _instruct_actor: Callable[[str, str], str] | None = None

    @tool
    def fire_event(self, event_name: str, context: str = "") -> str:
        """Fire a named prompt event on this actor.

        event_name: the name of the event to fire (must be configured on this actor)
        context: optional extra context appended to the event's prompt
        """
        evt = next((e for e in self.prompt_events if e.name == event_name), None)
        if evt is None:
            raise ValueError(f"Unknown event {event_name!r} on actor {self.actor_name!r}")
        instruction = evt.prompt
        if context:
            instruction = f"{instruction}\n\n{context}"
        # Run in a new thread: this @tool is invoked from inside the provider's asyncio
        # event loop (Copilot SDK path). Calling asyncio.run() again on the same thread
        # raises "RuntimeError: cannot be called when another event loop is running".
        # use_session=False keeps session ordering clean.
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            output = pool.submit(self.instruct, instruction, use_session=False).result()
        if self._instruct_actor and evt.target_actors:
            for target in evt.target_actors:
                self._instruct_actor(target, output)
        return output

    def restore_session(self, messages: list[dict]) -> None:
        """Replace the current session history with a previously saved snapshot."""
        self._session = list(messages)

    def send_to(self, actor_name: str, output: str) -> str:
        """Format and return an instruction for another actor using the edge prompt."""
        template = self.outbox.get(actor_name)
        if template is None:
            raise ValueError(f"No edge from {self.actor_name!r} to {actor_name!r}")
        return template.replace("{output}", output)
