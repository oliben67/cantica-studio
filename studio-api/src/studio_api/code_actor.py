"""TypeScriptCodeActor — non-AI pykka actor backed by a TypeScript/JavaScript subprocess."""
from __future__ import annotations

import json
import logging
import queue
import subprocess
import threading
import uuid
from collections import deque

import pykka

_log = logging.getLogger(__name__)

_MAX_LOG_LINES = 200
_READY_TIMEOUT = 15  # seconds to wait for the subprocess "ready" message


class TypeScriptCodeActor(pykka.ThreadingActor):
    """Non-AI actor that runs a TypeScript or JavaScript subprocess.

    The subprocess communicates via a JSON newline-delimited protocol on
    stdin/stdout.  Stderr is captured as log output.

    **Protocol (parent → child):**

    * ``{"type": "message", "id": "…", "content": "…"}`` — instruct/message
    * ``{"type": "event", "id": "…", "name": "…", "context": "…"}`` — named event
    * ``{"type": "cron", "id": "…", "name": "…"}`` — cron job trigger
    * ``{"type": "kill"}`` — graceful shutdown signal

    **Protocol (child → parent):**

    * ``{"type": "ready", "events": […], "crons": […]}`` — must be sent first
    * ``{"type": "response", "id": "…", "content": "…"}`` — reply to any request
    * ``{"type": "error", "id": "…", "message": "…"}`` — error reply
    * ``{"type": "log", "level": "info|warn|error", "message": "…"}`` — log line

    Subclass attributes (set via ``type()`` in ActorRuntime):

    * ``script_path`` — path to the script (absolute).
    * ``actor_name`` — human-readable name.
    * ``script_command`` — executable used to run the script (default: ``"node"``).
    """

    script_path: str = ""
    actor_name: str = ""
    script_command: str = "node"

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def on_start(self) -> None:
        self._log_buf: deque[str] = deque(maxlen=_MAX_LOG_LINES)
        self._pending: dict[str, queue.Queue[dict]] = {}
        self._pending_lock = threading.Lock()

        # Register the ready queue before spawning so we never miss the message.
        ready_q: queue.Queue[dict] = queue.Queue()
        with self._pending_lock:
            self._pending["__ready__"] = ready_q

        cmd = [self.script_command, self.script_path]
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"Cannot start TypeScript actor {self.actor_name!r}: "
                f"command {self.script_command!r} not found — "
                f"install node, ts-node, bun, or deno"
            ) from exc

        self._stdout_thread = threading.Thread(
            target=self._read_stdout, daemon=True, name=f"{self.actor_name}-stdout"
        )
        self._stderr_thread = threading.Thread(
            target=self._read_stderr, daemon=True, name=f"{self.actor_name}-stderr"
        )
        self._stdout_thread.start()
        self._stderr_thread.start()

        try:
            ready = ready_q.get(timeout=_READY_TIMEOUT)
        except queue.Empty:
            self._proc.terminate()
            raise RuntimeError(
                f"TypeScript actor {self.actor_name!r} did not send a 'ready' message "
                f"within {_READY_TIMEOUT}s — the script must call startCodeActor() on startup"
            )

        self._ts_events: list[dict] = ready.get("events", [])
        self._ts_crons: list[dict] = ready.get("crons", [])
        _log.info(
            "TypeScript code actor %r started (events=%r, crons=%r)",
            self.actor_name,
            [e.get("name") for e in self._ts_events],
            [c.get("name") for c in self._ts_crons],
        )

    def on_stop(self) -> None:
        try:
            self._send_raw({"type": "kill"})
        except Exception:
            pass
        try:
            self._proc.terminate()
            self._proc.wait(timeout=5)
        except Exception:
            pass
        _log.info("TypeScript code actor %r stopped", self.actor_name)

    # ── I/O reader threads ─────────────────────────────────────────────────

    def _read_stdout(self) -> None:
        try:
            for raw_line in self._proc.stdout:  # type: ignore[union-attr]
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    _log.debug("Non-JSON stdout from %r: %s", self.actor_name, line)
                    continue
                self._dispatch(msg)
        except Exception as exc:
            _log.debug("stdout reader for %r ended: %s", self.actor_name, exc)

    def _read_stderr(self) -> None:
        try:
            for line in self._proc.stderr:  # type: ignore[union-attr]
                stripped = line.rstrip()
                if stripped:
                    self._log_buf.append(stripped)
        except Exception:
            pass

    def _dispatch(self, msg: dict) -> None:
        msg_type = msg.get("type")
        if msg_type == "ready":
            with self._pending_lock:
                q = self._pending.get("__ready__")
            if q is not None:
                q.put(msg)
        elif msg_type in ("response", "error"):
            req_id = msg.get("id")
            if req_id:
                with self._pending_lock:
                    q = self._pending.get(req_id)
                if q is not None:
                    q.put(msg)
        elif msg_type == "log":
            level = msg.get("level", "info")
            text = msg.get("message", "")
            self._log_buf.append(f"[{level}] {text}")

    # ── I/O helpers ────────────────────────────────────────────────────────

    def _send_raw(self, payload: dict) -> None:
        assert self._proc.stdin is not None
        self._proc.stdin.write(json.dumps(payload) + "\n")
        self._proc.stdin.flush()

    def _request(self, payload: dict, timeout: float = 120) -> str:
        req_id = str(uuid.uuid4())
        resp_q: queue.Queue[dict] = queue.Queue()
        with self._pending_lock:
            self._pending[req_id] = resp_q
        try:
            self._send_raw({**payload, "id": req_id})
            msg = resp_q.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError(
                f"TypeScript actor {self.actor_name!r} did not respond in {timeout}s"
            )
        finally:
            with self._pending_lock:
                self._pending.pop(req_id, None)
        if msg.get("type") == "error":
            raise RuntimeError(msg.get("message", "Unknown error from TypeScript actor"))
        return msg.get("content", "")

    # ── Actor interface ────────────────────────────────────────────────────

    def instruct(self, text: str) -> str:
        return self._request({"type": "message", "content": text})

    def fire_event(self, event_name: str, context: str = "") -> str:
        known = [e.get("name") for e in self._ts_events]
        if event_name not in known:
            raise ValueError(f"Unknown event {event_name!r} on actor {self.actor_name!r}")
        return self._request({"type": "event", "name": event_name, "context": context})

    def run_cron(self, cron_name: str) -> str:
        return self._request({"type": "cron", "name": cron_name})

    # ── Introspection ──────────────────────────────────────────────────────

    def get_events(self) -> list[dict]:
        return list(self._ts_events)

    def get_crons(self) -> list[dict]:
        return list(self._ts_crons)

    def get_logs(self) -> str:
        return "\n".join(self._log_buf)
