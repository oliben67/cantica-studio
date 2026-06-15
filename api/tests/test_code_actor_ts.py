"""Tests for studio_api.code_actor — TypeScriptCodeActor."""
from __future__ import annotations

import contextlib
import io
import json
import queue
import threading
from unittest.mock import patch

import pykka
import pytest

from studio_api.code_actor import TypeScriptCodeActor


# ── Mock subprocess ───────────────────────────────────────────────────────────


class _MockProc:
    """Thread-safe mock subprocess.Popen for TypeScriptCodeActor tests.

    - Puts the 'ready' message into a queue consumed by the reader thread.
    - Auto-responds to message/event/cron requests written to stdin.
    - Stops the reader thread on terminate() via a sentinel None.
    """

    def __init__(
        self,
        ready_events: list | None = None,
        ready_crons: list | None = None,
        stderr_lines: list[str] | None = None,
    ) -> None:
        self._out_q: queue.Queue = queue.Queue()
        self._stdin_writes: list[str] = []

        ready = {
            "type": "ready",
            "events": ready_events or [],
            "crons": ready_crons or [],
        }
        self._out_q.put(json.dumps(ready) + "\n")

        lines = "\n".join(stderr_lines or []) + ("\n" if stderr_lines else "")
        self.stderr = io.StringIO(lines)
        self.stdin = self  # MockProc IS stdin (has write/flush)

    # ── stdout interface (reader thread calls for line in proc.stdout) ─────

    @property
    def stdout(self) -> "_MockProc":
        return self

    def __iter__(self):
        while True:
            line = self._out_q.get()  # blocks until item
            if line is None:
                return  # sentinel — stop iteration
            yield line

    # ── stdin interface ────────────────────────────────────────────────────

    def write(self, data: str) -> None:
        self._stdin_writes.append(data)
        for line in data.strip().split("\n"):
            if not line.strip():
                continue
            try:
                msg = json.loads(line)
                msg_type = msg.get("type")
                if msg_type in ("message", "event", "cron"):
                    self._out_q.put(
                        json.dumps({
                            "type": "response",
                            "id": msg.get("id"),
                            "content": f"mock-{msg_type}",
                        }) + "\n"
                    )
                elif msg_type == "kill":
                    self._out_q.put(None)
            except (json.JSONDecodeError, KeyError):
                pass

    def flush(self) -> None:
        pass

    # ── process interface ──────────────────────────────────────────────────

    def terminate(self) -> None:
        self._out_q.put(None)

    def wait(self, timeout=None) -> int:
        return 0

    def push(self, msg: dict) -> None:
        """Inject an extra message into stdout (for dispatch tests)."""
        self._out_q.put(json.dumps(msg) + "\n")


class _MockProcNoReady(_MockProc):
    """Mock that never sends a ready message (used to test startup timeout)."""

    def __init__(self) -> None:
        self._out_q: queue.Queue = queue.Queue()
        self._stdin_writes = []
        self.stderr = io.StringIO("")
        self.stdin = self


# ── Fixtures ──────────────────────────────────────────────────────────────────


def _make_cls(
    name: str = "ts-worker",
    events: list | None = None,
    crons: list | None = None,
    stderr_lines: list[str] | None = None,
) -> tuple[type, _MockProc]:
    proc = _MockProc(ready_events=events, ready_crons=crons, stderr_lines=stderr_lines)
    cls = type(
        name,
        (TypeScriptCodeActor,),
        {"script_path": "/fake/script.js", "actor_name": name, "script_command": "node"},
    )
    return cls, proc


@contextlib.contextmanager
def _started(cls: type, proc: _MockProc):
    """Context manager: start actor, yield ref, stop it."""
    with patch("studio_api.code_actor.subprocess.Popen", return_value=proc):
        ref = cls.start()
    try:
        yield ref
    finally:
        with contextlib.suppress(pykka.ActorDeadError):
            ref.stop()
    pykka.ActorRegistry.stop_all()


# ── on_start / startup ────────────────────────────────────────────────────────


def test_on_start_registers_events():
    cls, proc = _make_cls(events=[{"name": "ping"}, {"name": "pong"}])
    with _started(cls, proc) as ref:
        events = ref.proxy().get_events().get(timeout=5)
    assert {e["name"] for e in events} == {"ping", "pong"}


def test_on_start_registers_crons():
    cls, proc = _make_cls(crons=[{"name": "daily", "schedule": "0 9 * * *"}])
    with _started(cls, proc) as ref:
        crons = ref.proxy().get_crons().get(timeout=5)
    assert crons == [{"name": "daily", "schedule": "0 9 * * *"}]


def test_on_start_no_events_or_crons():
    cls, proc = _make_cls()
    with _started(cls, proc) as ref:
        assert ref.proxy().get_events().get(timeout=5) == []
        assert ref.proxy().get_crons().get(timeout=5) == []


def test_on_start_captures_stderr():
    cls, proc = _make_cls(stderr_lines=["error: something failed"])
    with _started(cls, proc) as ref:
        import time
        time.sleep(0.1)  # give stderr thread time to read
        logs = ref.proxy().get_logs().get(timeout=5)
    assert "error: something failed" in logs


def test_on_start_command_not_found_makes_actor_dead():
    """When Popen raises FileNotFoundError, on_start fails and the actor becomes dead."""
    import time  # noqa: PLC0415
    cls = type(
        "BadCls",
        (TypeScriptCodeActor,),
        {"script_path": "/fake/s.js", "actor_name": "bad", "script_command": "no-such-cmd"},
    )
    with patch("studio_api.code_actor.subprocess.Popen", side_effect=FileNotFoundError):
        ref = cls.start()
        time.sleep(0.2)  # wait for on_start to fail
        with pytest.raises(pykka.ActorDeadError):
            ref.proxy().get_events().get(timeout=1)


def test_on_start_timeout_if_no_ready_makes_actor_dead():
    """When the subprocess never sends 'ready', on_start times out and actor becomes dead."""
    import time  # noqa: PLC0415
    cls = type(
        "NoReadyCls",
        (TypeScriptCodeActor,),
        {"script_path": "/f.js", "actor_name": "n", "script_command": "node"},
    )
    no_ready = _MockProcNoReady()
    with patch("studio_api.code_actor.subprocess.Popen", return_value=no_ready), \
         patch("studio_api.code_actor._READY_TIMEOUT", 0.05):
        ref = cls.start()
        time.sleep(0.3)  # wait for startup timeout to fire
        with pytest.raises(pykka.ActorDeadError):
            ref.proxy().get_events().get(timeout=1)


# ── instruct ──────────────────────────────────────────────────────────────────


def test_instruct_returns_response():
    cls, proc = _make_cls()
    with _started(cls, proc) as ref:
        result = ref.proxy().instruct("hello world").get(timeout=5)
    assert result == "mock-message"


# ── fire_event ────────────────────────────────────────────────────────────────


def test_fire_event_known_event():
    cls, proc = _make_cls(events=[{"name": "analyze"}])
    with _started(cls, proc) as ref:
        result = ref.proxy().fire_event("analyze", "some context").get(timeout=5)
    assert result == "mock-event"


def test_fire_event_unknown_event_raises():
    cls, proc = _make_cls(events=[{"name": "known"}])
    with _started(cls, proc) as ref:
        with pytest.raises(ValueError, match="Unknown event"):
            ref.proxy().fire_event("ghost", "ctx").get(timeout=5)


# ── run_cron ──────────────────────────────────────────────────────────────────


def test_run_cron_returns_response():
    cls, proc = _make_cls(crons=[{"name": "hourly", "schedule": "0 * * * *"}])
    with _started(cls, proc) as ref:
        result = ref.proxy().run_cron("hourly").get(timeout=5)
    assert result == "mock-cron"


# ── _dispatch ─────────────────────────────────────────────────────────────────


def test_dispatch_log_message_appended_to_log():
    cls, proc = _make_cls()
    with _started(cls, proc) as ref:
        proc.push({"type": "log", "level": "info", "message": "actor log line"})
        import time
        time.sleep(0.1)
        logs = ref.proxy().get_logs().get(timeout=5)
    assert "actor log line" in logs


def test_dispatch_error_response_raises_on_request():
    cls, proc = _make_cls()

    # Override write to return an error instead of success
    original_write = proc.write

    def error_write(data: str) -> None:
        for line in data.strip().split("\n"):
            try:
                msg = json.loads(line)
                if msg.get("type") in ("message", "event", "cron"):
                    proc._out_q.put(
                        json.dumps({"type": "error", "id": msg.get("id"), "message": "boom"}) + "\n"
                    )
            except Exception:
                pass

    with _started(cls, proc) as ref:
        proc.write = error_write
        with pytest.raises(RuntimeError, match="boom"):
            ref.proxy().instruct("trigger error").get(timeout=5)


def test_dispatch_unknown_type_ignored():
    cls, proc = _make_cls()
    with _started(cls, proc) as ref:
        # Inject an unknown message — should be silently ignored
        proc.push({"type": "weird-unknown-type", "data": "foo"})
        import time
        time.sleep(0.05)
        # Actor still alive and responding
        events = ref.proxy().get_events().get(timeout=5)
    assert events == []


# ── get_logs ──────────────────────────────────────────────────────────────────


def test_get_logs_returns_captured_lines():
    cls, proc = _make_cls(stderr_lines=["line1", "line2"])
    with _started(cls, proc) as ref:
        import time
        time.sleep(0.1)
        logs = ref.proxy().get_logs().get(timeout=5)
    assert "line1" in logs
    assert "line2" in logs


# ── _get_rt guard in mcp_server ───────────────────────────────────────────────


def test_get_rt_raises_before_init():
    import studio_api.mcp_server as mcp_mod
    original = mcp_mod._rt
    mcp_mod._rt = None
    try:
        with pytest.raises(RuntimeError, match="not initialised"):
            mcp_mod._get_rt()
    finally:
        mcp_mod._rt = original


# ── on_stop exception handlers (lines 110-116) ────────────────────────────────


class _MockProcWriteRaises(_MockProc):
    """Proc whose stdin.write raises — tests on_stop line 110-111."""

    def write(self, data: str) -> None:
        raise BrokenPipeError("stdin broken")

    def terminate(self) -> None:
        self._out_q.put(None)   # let reader exit cleanly


class _MockProcBothRaise(_MockProc):
    """Proc where both write AND terminate raise — tests lines 115-116."""

    def write(self, data: str) -> None:
        raise BrokenPipeError("stdin broken")

    def terminate(self) -> None:
        self._out_q.put(None)   # reader exits first …
        raise OSError("process already gone")  # … then terminate raises


def test_on_stop_handles_send_raw_exception():
    """on_stop catches exception from _send_raw (lines 110-111)."""
    cls = type(
        "SendRaiseActor",
        (TypeScriptCodeActor,),
        {"script_path": "/fake/s.js", "actor_name": "sraise", "script_command": "node"},
    )
    proc = _MockProcWriteRaises()
    with patch("studio_api.code_actor.subprocess.Popen", return_value=proc):
        ref = cls.start()
    import time
    time.sleep(0.05)
    # Stop triggers on_stop → _send_raw raises → caught → no crash
    with contextlib.suppress(pykka.ActorDeadError):
        ref.stop()
    pykka.ActorRegistry.stop_all()


def test_on_stop_handles_terminate_exception():
    """on_stop catches exception from _proc.terminate() (lines 115-116)."""
    cls = type(
        "TermRaiseActor",
        (TypeScriptCodeActor,),
        {"script_path": "/fake/s.js", "actor_name": "traise", "script_command": "node"},
    )
    proc = _MockProcBothRaise()
    with patch("studio_api.code_actor.subprocess.Popen", return_value=proc):
        ref = cls.start()
    import time
    time.sleep(0.05)
    with contextlib.suppress(pykka.ActorDeadError):
        ref.stop()
    pykka.ActorRegistry.stop_all()


# ── _read_stdout edge cases ────────────────────────────────────────────────────


def test_read_stdout_skips_empty_lines():
    """Blank/whitespace lines from stdout are stripped and skipped (line 126)."""
    cls, proc = _make_cls()
    with _started(cls, proc) as ref:
        proc._out_q.put("\n")       # empty line
        proc._out_q.put("   \n")    # whitespace only
        import time; time.sleep(0.05)
        events = ref.proxy().get_events().get(timeout=5)
    assert events == []


def test_read_stdout_ignores_non_json_line():
    """Non-JSON stdout line is logged and skipped without crashing (lines 129-131)."""
    cls, proc = _make_cls()
    with _started(cls, proc) as ref:
        proc._out_q.put("NOT-VALID-JSON\n")
        import time; time.sleep(0.05)
        result = ref.proxy().instruct("hello").get(timeout=5)
    assert result == "mock-message"


class _MockProcStdoutRaises(_MockProc):
    """Proc whose stdout raises an exception after the ready message (lines 133-134)."""

    def __init__(self) -> None:
        super().__init__()
        self._raise_next = False

    def __iter__(self):
        while True:
            line = self._out_q.get()
            if line is None:
                return
            yield line
            # After yielding ready, mark that next get will raise
            if not self._raise_next:
                self._raise_next = True
                # Put a sentinel that causes raise on next get
                self._out_q.put("__RAISE__")
            elif line == "__RAISE__":
                raise IOError("stdout pipe closed")


def test_read_stdout_outer_exception_is_logged():
    """Exception during stdout iteration is caught by outer handler (lines 133-134)."""
    import time  # noqa: PLC0415

    cls = type(
        "StdoutRaiseActor",
        (TypeScriptCodeActor,),
        {"script_path": "/fake/s.js", "actor_name": "straise", "script_command": "node"},
    )
    proc = _MockProcStdoutRaises()
    with patch("studio_api.code_actor.subprocess.Popen", return_value=proc):
        ref = cls.start()
    time.sleep(0.3)  # let stdout thread hit the exception
    # Actor may be alive or dead; just verify no unhandled exception escaped
    with contextlib.suppress(pykka.ActorDeadError):
        ref.stop()
    pykka.ActorRegistry.stop_all()


# ── _read_stderr edge cases ────────────────────────────────────────────────────


def test_read_stderr_skips_blank_lines():
    """Blank stderr lines are rstripped to '' and skipped (branch 140->138)."""
    cls, proc = _make_cls(stderr_lines=["real error", ""])
    with _started(cls, proc) as ref:
        import time; time.sleep(0.1)
        logs = ref.proxy().get_logs().get(timeout=5)
    assert "real error" in logs
    # The blank line must NOT appear as an entry
    assert "" not in logs.split("\n")


class _MockProcStderrRaises(_MockProc):
    """Proc whose stderr raises during iteration (lines 142-143)."""

    def __init__(self) -> None:
        super().__init__()

        class _Raising:
            def __iter__(self):
                raise IOError("stderr closed unexpectedly")

        self.stderr = _Raising()


def test_read_stderr_outer_exception_is_caught():
    """Exception during stderr iteration is caught (lines 142-143)."""
    import time  # noqa: PLC0415

    cls = type(
        "StderrRaiseActor",
        (TypeScriptCodeActor,),
        {"script_path": "/fake/s.js", "actor_name": "stderraise", "script_command": "node"},
    )
    proc = _MockProcStderrRaises()
    with patch("studio_api.code_actor.subprocess.Popen", return_value=proc):
        ref = cls.start()
    time.sleep(0.15)
    with contextlib.suppress(pykka.ActorDeadError):
        ref.stop()
    pykka.ActorRegistry.stop_all()


# ── _dispatch edge cases ───────────────────────────────────────────────────────


def test_dispatch_response_with_no_id_is_silently_ignored():
    """response/error message without an 'id' field is ignored (branch 154->exit)."""
    cls, proc = _make_cls()
    with _started(cls, proc) as ref:
        proc.push({"type": "response", "content": "orphan"})   # no "id"
        import time; time.sleep(0.05)
        events = ref.proxy().get_events().get(timeout=5)
    assert events == []


def test_dispatch_response_with_unknown_id_is_silently_ignored():
    """response with an id not in _pending is silently dropped (branch 157->exit)."""
    cls, proc = _make_cls()
    with _started(cls, proc) as ref:
        proc.push({"type": "response", "id": "unknown-id-xyz", "content": "lost"})
        import time; time.sleep(0.05)
        events = ref.proxy().get_events().get(timeout=5)
    assert events == []


# ── _request timeout (lines 179-180) ─────────────────────────────────────────


def test_request_raises_timeout_error_when_subprocess_does_not_respond():
    """_request raises TimeoutError when the subprocess is silent (lines 179-180)."""
    import time  # noqa: PLC0415

    # Build a subclass that uses a 0-second timeout so the test doesn't hang.
    class _QuickTimeoutActor(TypeScriptCodeActor):
        script_path = "/fake/s.js"
        actor_name = "quick-timeout"
        script_command = "node"

        def instruct(self, text: str) -> str:
            return self._request({"type": "message", "content": text}, timeout=0)

    cls = _QuickTimeoutActor

    class _NoReplyProc(_MockProc):
        def write(self, data: str) -> None:
            # Only handle kill so the reader thread can exit
            for line in data.strip().split("\n"):
                try:
                    msg = json.loads(line)
                    if msg.get("type") == "kill":
                        self._out_q.put(None)
                except Exception:
                    pass

    proc = _NoReplyProc()
    with patch("studio_api.code_actor.subprocess.Popen", return_value=proc):
        ref = cls.start()

    time.sleep(0.05)
    with pytest.raises(TimeoutError, match="did not respond"):
        ref.proxy().instruct("slow").get(timeout=5)

    with contextlib.suppress(pykka.ActorDeadError):
        ref.stop()
    pykka.ActorRegistry.stop_all()
