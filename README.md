# cantica-studio

**AI Actor Studio** — a VSCode extension and a local Python server for building, running, and connecting `actor-ai` agents backed by Cantica prompts.

| Sub-project | Description |
| --- | --- |
| [`clients/vscode/`](clients/vscode/) | VSCode extension — graph editor for AI Actor workflows |
| [`clients/studio-app/`](clients/studio-app/) | Electron desktop app — the same graph editor as a standalone app |
| [`clients/shared/`](clients/shared/) | Shared React webview, studio client, and auth/key machinery used by both clients |
| [`studio-api/`](studio-api/) | Local FastAPI server — actor runtime, Cantica proxy, MCP server |

---

## What you can build

In the Actor Studio canvas, **AI Actors** are nodes on a graph. Each actor has:

- **Define Prompt** — a `cantica://` URI or raw text that sets the actor's role (maps to `system_prompt`)
- **Prompt Events** — named triggers (HTTP POST, VS Code file-save, or incoming edge message) that run a prompt
- **Cron Jobs** — scheduled prompts on a cron expression
- **Message Edges** — directed connections to other actors; when an actor fires, its output is templated into the edge prompt and forwarded

The graph is saved as JSON-LD to `.vscode/actors.jsonld` and reloaded automatically.

---

## Architecture

```text
VSCode Extension  (ReactFlow graph editor + Zustand store)
      │
      │ HTTP /v1  (graph CRUD, prompts, actor runtime)
      ▼
studio-api   (port 8043)
      ├── ActorRuntime    pykka ThreadingActor per actor, APScheduler for crons
      ├── CanticaConnector  fetches prompts from N Cantica servers
      ├── WorkspaceFS     path-safe file I/O constrained to workspace
      └── MCP Server      read_file / write_file / list_files / search_files
            │
            │ cantica:// URI resolution
            ▼
      Cantica API  (one or more instances at configurable URLs)
```

---

## Quick start

```bash
# Install VSCode extension dependencies
task install

# Run all quality gates (ESLint + TypeScript typecheck)
task check
```

For the studio API (Python):

```bash
cd studio-api
uv sync
studio          # starts FastAPI + MCP on :8043
```

Full documentation: [studio-api/README.md](studio-api/README.md)

---

## Tasks

| Task | Description |
| --- | --- |
| `task install` | Install all client dependencies (vscode + studio-app) |
| `task build` / `task build:prod` | Build all clients (dev / production) |
| `task test` | Run the client test suites |
| `task typecheck` | TypeScript typecheck across clients |
| `task check` | Run all quality gates (typecheck + lint + test + build) |
| `task lint` / `task fix` | ESLint / auto-fix |
| `task ci` | Full CI pipeline |
| `task app` / `task app:dev` | Build + launch (or just launch) the Electron desktop app |
| `task vscode:install:vsix` | Package + install the VSCode extension |
| `task clean` / `task clean:all` | Remove artefacts / also remove `node_modules/` |

> Client-level `compile` / `compile:prod` remain as aliases of `build` /
> `build:prod`.

---

## Remote mode & security

The Studio API runs single-user by default (`STUDIO_LOCAL_MODE`). In remote
mode it supports invitation-based multi-user auth, and with
`STUDIO_SECURITY_SHIM=true` that auth is served by the shared
[`cantica-secure`](../cantica-secure/) package. The clients expose the admin
screens (users · activation · flags · directory mappings · API tokens) behind
the toolbar **Security** entry, rendered from `@cantica/secure-ui` over a
postMessage bridge so the session token stays in the extension host / Electron
main.
