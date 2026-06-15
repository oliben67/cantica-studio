/**
 * code_actor.ts — runtime helper for Cantica Studio code actors.
 *
 * Copy this file into your TypeScript project and call `startCodeActor()` on
 * startup.  Stdout is reserved for the JSON protocol — use `stderr` or the
 * exported `log()` helper for diagnostic output.
 *
 * Usage example
 * -------------
 *
 *   import { startCodeActor, log } from "./code_actor";
 *
 *   startCodeActor({
 *     events: {
 *       analyze: (context) => `Analysed: ${context}`,
 *     },
 *     crons: [
 *       {
 *         name: "daily",
 *         schedule: "0 9 * * 1-5",
 *         handler: () => "Good morning!",
 *       },
 *     ],
 *     message: (text) => `echo: ${text}`,
 *   });
 */

export interface CodeActorOptions {
  /** Event handlers keyed by event name. Receive a context string, return a string. */
  events?: Record<string, (context: string) => string | Promise<string>>;
  /** Cron job handlers.  Name + schedule are used by the runtime for scheduling. */
  crons?: Array<{
    name: string;
    schedule: string;
    handler: () => string | Promise<string>;
  }>;
  /** Message handler — called when the actor receives an instruct() call. */
  message?: (text: string) => string | Promise<string>;
}

/**
 * Start the code actor runtime.
 *
 * Sends a "ready" message to stdout, then reads JSON messages from stdin and
 * dispatches them to the appropriate handler.  Responses are written to stdout.
 */
export function startCodeActor(options: CodeActorOptions): void {
  const { events = {}, crons = [], message } = options;

  // ── 1. Announce events and crons ───────────────────────────────────────────
  const ready = {
    type: "ready",
    events: Object.keys(events).map((name) => ({ name })),
    crons: crons.map(({ name, schedule }) => ({ name, schedule })),
  };
  process.stdout.write(JSON.stringify(ready) + "\n");

  // ── 2. Read messages from stdin ────────────────────────────────────────────
  let buf = "";
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      void _dispatch(msg, events, crons, message);
    }
  });

  process.stdin.on("end", () => process.exit(0));
}

async function _dispatch(
  msg: Record<string, unknown>,
  events: Record<string, (ctx: string) => string | Promise<string>>,
  crons: Array<{ name: string; schedule: string; handler: () => string | Promise<string> }>,
  messageHandler?: (text: string) => string | Promise<string>
): Promise<void> {
  const id = msg["id"] as string | undefined;

  const respond = (content: string): void => {
    process.stdout.write(JSON.stringify({ type: "response", id, content }) + "\n");
  };

  const respondError = (message: string): void => {
    process.stdout.write(JSON.stringify({ type: "error", id, message }) + "\n");
  };

  try {
    switch (msg["type"]) {
      case "kill":
        process.exit(0);
        break;

      case "message": {
        if (!messageHandler) {
          respond("");
          return;
        }
        const result = await messageHandler((msg["content"] as string) ?? "");
        respond(result ?? "");
        break;
      }

      case "event": {
        const name = msg["name"] as string;
        const handler = events[name];
        if (!handler) {
          respondError(`Unknown event: ${name}`);
          return;
        }
        const result = await handler((msg["context"] as string) ?? "");
        respond(result ?? "");
        break;
      }

      case "cron": {
        const name = msg["name"] as string;
        const cronJob = crons.find((c) => c.name === name);
        if (!cronJob) {
          respondError(`Unknown cron: ${name}`);
          return;
        }
        const result = await cronJob.handler();
        respond(result ?? "");
        break;
      }

      default:
        // Unknown message type — ignore silently
    }
  } catch (err: unknown) {
    respondError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Write a structured log message to stdout (captured by studio-api as a log line).
 * Use this instead of console.log to keep stdout clean for the protocol.
 */
export function log(level: "info" | "warn" | "error", message: string): void {
  process.stdout.write(JSON.stringify({ type: "log", level, message }) + "\n");
}
