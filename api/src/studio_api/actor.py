"""StudioActor — extends actor_ai.AIActor with prompt events, cron jobs, and message routing."""

from __future__ import annotations

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
        # Call the provider directly with tools=[] to prevent the LLM from calling
        # fire_event again (which would cause infinite recursion). This also avoids
        # asyncio nesting issues: the Copilot SDK path dispatches tools via
        # run_in_executor so this method already runs in a plain thread (no event loop),
        # meaning asyncio.run() inside provider.run() works without wrapping.
        try:
            output = self.provider.run( # type: ignore
                system=self._effective_system_prompt(),
                messages=[{"role": "user", "content": instruction}],
                tools=[],
                dispatcher=lambda name, args: None,
                max_tokens=self.max_tokens,
            )
        except Exception as exc:
            _log.error("fire_event %r provider.run failed: %s", event_name, exc, exc_info=True)
            raise
        if self._instruct_actor and evt.target_actors:
            for target in evt.target_actors:
                try:
                    self._instruct_actor(target, output)
                except Exception as exc:
                    _log.error("fire_event %r _instruct_actor(%r) failed: %s", event_name, target, exc)
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
