"""StudioActor — extends actor_ai.AIActor with prompt events, cron jobs, and message routing."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from actor_ai import AIActor

_log = logging.getLogger(__name__)


@dataclass
class PromptEventDef:
    name: str
    prompt: str                    # resolved content (not a URI at runtime)
    file_pattern: str | None = None


@dataclass
class CronJobDef:
    schedule: str
    prompt: str                    # resolved content


class StudioActor(AIActor):
    """AIActor subclass with prompt events, cron jobs, and actor-to-actor messaging.

    Instances are created via runtime.ActorRuntime which dynamically builds a
    subclass per actor definition so each actor has its own class-level config.
    """

    # All prompts are resolved to raw content before the actor starts —
    # no Cantica server calls are made from within the actor threads.
    prompt_events: list[PromptEventDef] = field(default_factory=list)
    cron_jobs: list[CronJobDef] = field(default_factory=list)
    # edge prompt templates: actor_name → template string with {output} placeholder
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
