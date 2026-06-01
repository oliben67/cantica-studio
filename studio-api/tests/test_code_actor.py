"""Tests for code actor integration — ActorDef, ActorRuntime, and API endpoints."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from studio_api.runtime import ActorDef, ActorRuntime


# ── Helpers ───────────────────────────────────────────────────────────────────


def _write_py_module(tmp_path: Path, code: str) -> Path:
    p = tmp_path / "test_actor_module.py"
    p.write_text(code, encoding="utf-8")
    return p


def _code_def(
    tmp_path: Path,
    code: str,
    name: str = "worker",
    actor_type: str = "python",
) -> tuple[ActorDef, Path]:
    p = _write_py_module(tmp_path, code)
    defn = ActorDef(
        id=f"urn:x:{name}",
        name=name,
        define_prompt="",
        actor_type=actor_type,
        script_path=str(p),
    )
    return defn, p


# ── ActorDef new fields ───────────────────────────────────────────────────────


def test_actor_def_defaults_ai():
    d = ActorDef(id="urn:x", name="bot", define_prompt="p")
    assert d.actor_type == "ai"
    assert d.script_path == ""
    assert d.script_command == ""


def test_actor_def_python_type():
    d = ActorDef(id="urn:x", name="w", define_prompt="", actor_type="python", script_path="/a/b.py")
    assert d.actor_type == "python"
    assert d.script_path == "/a/b.py"


# ── ActorRuntime with Python code actor ──────────────────────────────────────


def test_python_code_actor_start_and_list(tmp_path):
    defn, _ = _code_def(
        tmp_path,
        """
from actor_ai.code_actor import on_message

@on_message
def handle(text):
    return "ok"
""",
    )
    rt = ActorRuntime()
    rt.start(defn, MagicMock())
    assert "worker" in rt.list_running()
    rt.stop_all()


def test_python_code_actor_instruct(tmp_path):
    defn, _ = _code_def(
        tmp_path,
        """
from actor_ai.code_actor import on_message

@on_message
def handle(text):
    return "reply: " + text
""",
    )
    rt = ActorRuntime()
    rt.start(defn, MagicMock())
    result = rt.instruct("worker", "hello")
    assert result == "reply: hello"
    rt.stop_all()


def test_python_code_actor_fire_event(tmp_path):
    defn, _ = _code_def(
        tmp_path,
        """
from actor_ai.code_actor import event

@event("check")
def check(ctx):
    return "checked: " + ctx
""",
    )
    rt = ActorRuntime()
    rt.start(defn, MagicMock())
    result = rt.fire_event("worker", "check", "data")
    assert result == "checked: data"
    rt.stop_all()


def test_python_code_actor_unknown_event_raises(tmp_path):
    defn, _ = _code_def(tmp_path, "# no events")
    rt = ActorRuntime()
    rt.start(defn, MagicMock())
    with pytest.raises(ValueError, match="Unknown event"):
        rt.fire_event("worker", "ghost")
    rt.stop_all()


def test_python_code_actor_get_events(tmp_path):
    defn, _ = _code_def(
        tmp_path,
        """
from actor_ai.code_actor import event

@event("alpha")
def alpha(ctx): return ""

@event("beta")
def beta(ctx): return ""
""",
    )
    rt = ActorRuntime()
    rt.start(defn, MagicMock())
    events = rt.get_actor_events("worker")
    names = {e["name"] for e in events}
    assert names == {"alpha", "beta"}
    rt.stop_all()


def test_python_code_actor_get_crons(tmp_path):
    defn, _ = _code_def(
        tmp_path,
        """
from actor_ai.code_actor import cron

@cron("0 9 * * *", name="daily")
def daily(): return ""
""",
    )
    rt = ActorRuntime()
    rt.start(defn, MagicMock())
    crons = rt.get_actor_crons("worker")
    assert crons == [{"name": "daily", "schedule": "0 9 * * *"}]
    rt.stop_all()


def test_python_code_actor_get_actor_type(tmp_path):
    defn, _ = _code_def(tmp_path, "# empty")
    rt = ActorRuntime()
    rt.start(defn, MagicMock())
    assert rt.get_actor_type("worker") == "python"
    rt.stop_all()


def test_get_actor_type_ai():
    rt = ActorRuntime()
    connector = MagicMock()
    started_ref = MagicMock()
    started_ref.proxy.return_value = MagicMock()
    with patch("studio_api.runtime._make_provider", return_value=None), \
         patch("pykka.ThreadingActor.start", return_value=started_ref):
        rt.start(ActorDef(id="urn:x", name="ai-bot", define_prompt="p"), connector)
    assert rt.get_actor_type("ai-bot") == "ai"
    rt.stop_all()


def test_python_code_actor_get_logs(tmp_path):
    defn, _ = _code_def(
        tmp_path,
        """
from actor_ai.code_actor import loop

@loop
def run(ctx):
    ctx.log("hello from loop")
    ctx.stop.wait()
""",
    )
    rt = ActorRuntime()
    rt.start(defn, MagicMock())
    import time
    time.sleep(0.2)
    logs = rt.get_actor_logs("worker")
    assert "hello from loop" in logs
    rt.stop_all()


def test_get_actor_events_unknown_raises(tmp_path):
    rt = ActorRuntime()
    with pytest.raises(KeyError, match="not running"):
        rt.get_actor_events("ghost")
    rt.stop_all()


def test_get_actor_crons_unknown_raises(tmp_path):
    rt = ActorRuntime()
    with pytest.raises(KeyError, match="not running"):
        rt.get_actor_crons("ghost")
    rt.stop_all()


def test_get_actor_type_unknown_raises():
    rt = ActorRuntime()
    with pytest.raises(KeyError, match="not running"):
        rt.get_actor_type("ghost")
    rt.stop_all()


def test_stop_cleans_code_actor_state(tmp_path):
    defn, _ = _code_def(
        tmp_path,
        """
from actor_ai.code_actor import event

@event("x")
def x(ctx): return ""
""",
    )
    rt = ActorRuntime()
    rt.start(defn, MagicMock())
    assert "worker" in rt._code_events
    rt.stop("worker")
    assert "worker" not in rt._code_events
    assert "worker" not in rt._code_crons
    rt.stop_all()


def test_python_code_actor_cron_registered_in_scheduler(tmp_path):
    defn, _ = _code_def(
        tmp_path,
        """
from actor_ai.code_actor import cron

@cron("30 8 * * 1-5", name="briefing")
def briefing(): return "brief"
""",
    )
    rt = ActorRuntime()
    rt.start(defn, MagicMock())
    job_ids = [j.id for j in rt._scheduler.get_jobs()]
    assert any("cron-worker-code-briefing" in jid for jid in job_ids)
    rt.stop_all()


# ── API endpoints ─────────────────────────────────────────────────────────────


def test_api_start_python_actor(tmp_path):
    from fastapi.testclient import TestClient
    from studio_api.main import create_app

    p = _write_py_module(
        tmp_path,
        """
from actor_ai.code_actor import on_message, event

@on_message
def handle(text): return "hi"

@event("ping")
def ping(ctx): return "pong"
""",
    )
    app = create_app()
    with TestClient(app) as client:
        resp = client.post(
            "/v1/runtime/actors",
            json={
                "name": "py-worker",
                "actor_type": "python",
                "script_path": str(p),
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["actor_type"] == "python"

        # Check events endpoint
        ev_resp = client.get("/v1/runtime/actors/py-worker/events")
        assert ev_resp.status_code == 200
        events = ev_resp.json()
        assert any(e["name"] == "ping" for e in events)

        # Check type endpoint
        type_resp = client.get("/v1/runtime/actors/py-worker/type")
        assert type_resp.status_code == 200
        assert type_resp.json()["actor_type"] == "python"

        # Instruct
        inst_resp = client.post(
            "/v1/runtime/actors/py-worker/instruct",
            json={"instruction": "hello"},
        )
        assert inst_resp.status_code == 200
        assert inst_resp.json()["output"] == "hi"

        # Fire event
        ev_fire_resp = client.post(
            "/v1/runtime/actors/py-worker/event/ping",
            json={"context": "test"},
        )
        assert ev_fire_resp.status_code == 200
        assert ev_fire_resp.json()["output"] == "pong"

        # Delete
        del_resp = client.delete("/v1/runtime/actors/py-worker")
        assert del_resp.status_code == 204
