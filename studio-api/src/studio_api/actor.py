"""StudioActor — extends actor_ai.AIActor with prompt events, cron jobs, and message routing."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from actor_ai import AIActor, tool

_log = logging.getLogger(__name__)


@dataclass
class PromptEventDef:
    name: str
    prompt: str                          # resolved content (not a URI at runtime)
    file_pattern: str | None = None
    target_actors: list[str] = field(default_factory=list)  # actors to route output to (empty = self)
    send_response: bool = False          # True = run LLM on event prompt before forwarding


@dataclass
class CronJobDef:
    schedule: str
    prompt: str                     # resolved content
    name: str = ""                   # human-readable label, optional
    target_actor: str | None = None
    target_event: str | None = None
    send_response: bool = False      # True = instruct source actor before forwarding to target


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
    def from_dict(cls, d: dict) -> AgentResource:
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

    # Separate stateless provider used exclusively inside fire_event.
    # Using self.provider concurrently from within a tool dispatch (which runs
    # via run_in_executor inside the SDK session loop) creates two overlapping
    # Copilot CLI sessions that corrupt each other → 400 duplicate call ID errors.
    # The runtime sets this to a non-SDK HTTP provider; falls back to self.provider.
    _event_provider: Any | None = None

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

        if evt.send_response:
            # sendResponse=True: run this actor's LLM on the prompt, forward the reply.
            # Use _event_provider (a stateless HTTP clone) when available to avoid the
            # concurrent-session issue — the SDK Copilot provider is already inside an
            # active session loop when this tool dispatch runs; a second concurrent call
            # produces duplicate function-call IDs.
            event_provider = self._event_provider or self.provider  # type: ignore[attr-defined]
            try:
                output = event_provider.run(
                    system=self._effective_system_prompt(),
                    messages=[{"role": "user", "content": instruction}],
                    tools=[],
                    dispatcher=lambda name, args: None,
                    max_tokens=self.max_tokens,
                )
            except Exception as exc:
                _log.error("fire_event %r provider.run failed: %s", event_name, exc, exc_info=True)
                raise
        else:
            # sendResponse=False (default): send the raw event prompt to targets without
            # consulting this actor's LLM.  This also avoids the concurrent-session bug
            # that occurs when provider.run() is called from inside a tool dispatch.
            output = instruction

        forwarded_to: list[str] = []
        if self._instruct_actor and evt.target_actors:
            for target in evt.target_actors:
                try:
                    self._instruct_actor(target, output)
                    forwarded_to.append(target)
                except Exception as exc:
                    _log.error("fire_event %r _instruct_actor(%r) failed: %s", event_name, target, exc)

        if evt.send_response:
            # Return the LLM's own response content so the caller can see it.
            return output
        if forwarded_to:
            return f"Event '{event_name}' fired successfully. Forwarded to: {', '.join(forwarded_to)}."
        if evt.target_actors:
            return f"Event '{event_name}' fired but no target actors were available to receive it."
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
