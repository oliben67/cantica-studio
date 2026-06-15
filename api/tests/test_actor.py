"""Tests for studio_api.actor — StudioActor, PromptEventDef, CronJobDef."""

from __future__ import annotations

import pytest

from studio_api.actor import CronJobDef, PromptEventDef, StudioActor


# ── Dataclasses ───────────────────────────────────────────────────────────────


def test_prompt_event_def_fields():
    evt = PromptEventDef(name="on-review", prompt="You are a reviewer.")
    assert evt.name == "on-review"
    assert evt.prompt == "You are a reviewer."
    assert evt.file_pattern is None


def test_prompt_event_def_with_file_pattern():
    evt = PromptEventDef(name="on-save", prompt="Check this:", file_pattern="**/*.py")
    assert evt.file_pattern == "**/*.py"


def test_cron_job_def_fields():
    cron = CronJobDef(schedule="0 9 * * 1-5", prompt="Daily standup prompt.", name="standup")
    assert cron.schedule == "0 9 * * 1-5"
    assert cron.prompt == "Daily standup prompt."
    assert cron.name == "standup"


# ── StudioActor ───────────────────────────────────────────────────────────────


def _make_actor(
    *,
    events: list[PromptEventDef] | None = None,
    actor_outbox: dict[str, str] | None = None,
) -> type[StudioActor]:
    """Build a concrete StudioActor subclass for testing (no LLM calls)."""
    _events = events or []
    _outbox = actor_outbox or {}

    class _MockActor(StudioActor):
        system_prompt = "You are a test assistant."
        prompt_events = _events
        cron_jobs = []
        outbox = _outbox

        def instruct(self, instruction: str, **_kw) -> str:  # type: ignore[override]
            return f"[mock reply to: {instruction[:40]}]"

    return _MockActor


def test_fire_event_known_event():
    events = [PromptEventDef(name="on-review", prompt="Review this code.")]
    ActorCls = _make_actor(events=events)
    actor = ActorCls.__new__(ActorCls)
    result = actor.fire_event("on-review")
    assert "Review this code." in result


def test_fire_event_with_context():
    events = [PromptEventDef(name="on-save", prompt="Analyse:")]
    ActorCls = _make_actor(events=events)
    actor = ActorCls.__new__(ActorCls)
    result = actor.fire_event("on-save", context="main.py was saved")
    assert "main.py was saved" in result


def test_fire_event_no_context_no_newlines():
    events = [PromptEventDef(name="ping", prompt="pong")]
    ActorCls = _make_actor(events=events)
    actor = ActorCls.__new__(ActorCls)
    result = actor.fire_event("ping")
    assert "\n\n" not in result


def test_fire_event_unknown_raises():
    ActorCls = _make_actor(events=[])
    actor = ActorCls.__new__(ActorCls)
    with pytest.raises(ValueError, match="Unknown event"):
        actor.fire_event("nonexistent")


def test_fire_event_wrong_name_raises():
    events = [PromptEventDef(name="on-review", prompt="Review.")]
    ActorCls = _make_actor(events=events)
    actor = ActorCls.__new__(ActorCls)
    with pytest.raises(ValueError, match="Unknown event 'on-save'"):
        actor.fire_event("on-save")


def test_fire_event_forwards_to_target_actors():
    """fire_event must call _instruct_actor for each target_actor after running the prompt."""
    forwarded: list[tuple[str, str]] = []
    events = [PromptEventDef(name="ask-time", prompt="What time is it?", target_actors=["receiver"])]
    ActorCls = _make_actor(events=events)
    actor = ActorCls.__new__(ActorCls)
    actor._instruct_actor = lambda name, text: forwarded.append((name, text)) or "[forwarded]"
    actor.fire_event("ask-time")
    assert len(forwarded) == 1
    assert forwarded[0][0] == "receiver"
    assert "What time is it?" in forwarded[0][1]


def test_fire_event_no_target_actors_skips_forward():
    events = [PromptEventDef(name="ping", prompt="pong", target_actors=[])]
    ActorCls = _make_actor(events=events)
    actor = ActorCls.__new__(ActorCls)
    calls: list = []
    actor._instruct_actor = lambda *a: calls.append(a)
    actor.fire_event("ping")
    assert calls == []


def test_send_to_known_target():
    ActorCls = _make_actor(actor_outbox={"reviewer": "Please review: {output}"})
    actor = ActorCls.__new__(ActorCls)
    result = actor.send_to("reviewer", "def foo(): pass")
    assert "def foo(): pass" in result
    assert "Please review:" in result


def test_send_to_substitutes_output_placeholder():
    ActorCls = _make_actor(actor_outbox={"target": "Input was: {output}. End."})
    actor = ActorCls.__new__(ActorCls)
    result = actor.send_to("target", "hello")
    assert result == "Input was: hello. End."


def test_send_to_unknown_target_raises():
    ActorCls = _make_actor()
    actor = ActorCls.__new__(ActorCls)
    with pytest.raises(ValueError, match="No edge"):
        actor.send_to("unknown-actor", "some output")


def test_studio_actor_inherits_ai_actor():
    from actor_ai import AIActor  # noqa: PLC0415

    assert issubclass(StudioActor, AIActor)


def test_actor_class_isolation():
    """Each subclass gets its own class-level attributes."""
    A = type("A", (StudioActor,), {"prompt_events": [PromptEventDef("e1", "p1")]})
    B = type("B", (StudioActor,), {"prompt_events": [PromptEventDef("e2", "p2")]})
    assert A.prompt_events is not B.prompt_events
    assert A.prompt_events[0].name == "e1"
    assert B.prompt_events[0].name == "e2"


# ── restore_session ───────────────────────────────────────────────────────────


def test_restore_session_replaces_history():
    ActorCls = _make_actor()
    actor = ActorCls.__new__(ActorCls)
    actor._session = []  # type: ignore[attr-defined]
    messages = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there"},
    ]
    actor.restore_session(messages)
    assert actor._session == messages  # type: ignore[attr-defined]


def test_restore_session_does_not_share_reference():
    ActorCls = _make_actor()
    actor = ActorCls.__new__(ActorCls)
    actor._session = []  # type: ignore[attr-defined]
    messages = [{"role": "user", "content": "Hi"}]
    actor.restore_session(messages)
    messages.clear()
    assert len(actor._session) == 1  # type: ignore[attr-defined]
