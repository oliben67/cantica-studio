"""StudioActor — extends actor_ai.AIActor with prompt events, cron jobs, and message routing."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from actor_ai import AIActor

_log = logging.getLogger(__name__)


@dataclass
class PromptEventDef:
    name: str
    prompt: str                     # resolved content (not a URI at runtime)
    file_pattern: str | None = None
    target_actor: str | None = None  # route output to another actor
    target_event: str | None = None  # fire a specific event on the target


@dataclass
class CronJobDef:
    schedule: str
    prompt: str                     # resolved content
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

    def fire_event(self, event_name: str, context: str = "") -> str:
        """Run the prompt associated with a named event and return the LLM reply."""
        evt = next((e for e in self.prompt_events if e.name == event_name), None)
        if evt is None:
            raise ValueError(f"Unknown event {event_name!r} on actor {self.actor_name!r}")
        instruction = evt.prompt
        if context:
            instruction = f"{instruction}\n\n{context}"
        return self.instruct(instruction)

    def send_to(self, actor_name: str, output: str) -> str:
        """Format and return an instruction for another actor using the edge prompt."""
        template = self.outbox.get(actor_name)
        if template is None:
            raise ValueError(f"No edge from {self.actor_name!r} to {actor_name!r}")
        return template.replace("{output}", output)
