# cantica-studio

**AI Actor Studio** — a VSCode extension and a local Python server for building, running, and connecting `actor-ai` agents backed by Cantica prompts.

| Sub-project | Description |
| --- | --- |
| [`vscode/`](vscode/) | VSCode extension — graph editor for AI Actor workflows |
| [`studio-api/`](studio-api/) | Local FastAPI server — actor runtime, Cantica proxy, MCP server |
| [`react-native/`](react-native/) | Mobile companion app (work in progress) |

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
| `task install` | Install all sub-project dependencies |
| `task check` | Run all quality gates |
| `task lint` | ESLint across sub-projects |
| `task fix` | Auto-fix ESLint issues |
| `task ci` | Full CI pipeline |
| `task clean` | Remove build artefacts |
| `task clean:all` | Remove artefacts and `node_modules/` |
