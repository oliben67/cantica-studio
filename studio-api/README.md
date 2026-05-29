# studio-api

**AI Actor Studio API** — runs `actor-ai` agents, connects to Cantica prompt servers, and exposes an MCP server for workspace file access. Backs the **Cantica Studio** VSCode extension.

---

## What it does

| Capability | Details |
| --- | --- |
| **Actor runtime** | Start, stop, and instruct `actor-ai` agents via HTTP |
| **Prompt events** | Fire named events on actors (HTTP POST, file-save, or actor-to-actor message) |
| **Cron jobs** | Schedule prompt runs on a cron expression (APScheduler) |
| **Cantica proxy** | Aggregate prompts from one or more Cantica servers for the graph editor |
| **MCP server** | Expose workspace read/write tools to AI agents via Model Context Protocol |
| **Graph persistence** | Save/load the actor graph as JSON-LD (`.vscode/actors.jsonld`) |

---

## Quick start

```bash
# Install (dev mode — actor-ai is resolved from ../../../actor-ai)
uv sync

# Run
studio
# or
uvicorn studio_api.main:app --reload --port 8043
```

The API is available at `http://localhost:8043` and the MCP server at `http://localhost:8043/mcp`.

---

## Docker

Build and run via Docker Compose from the `cantica-studio/studio-api/` directory:

```bash
docker compose up -d
```

The two-stage build compiles a `cantica-api` wheel in stage 1 and installs everything alongside `studio-api` in stage 2. The build context is the `cantica-project/` root so both repos are available.

Pass workspace and Cantica server config via environment:

```bash
STUDIO_WORKSPACE=/path/to/project \
STUDIO_CANTICA_SERVERS='[{"url":"http://cantica.example.com","auth_token":"..."}]' \
docker compose up -d
```

---

## Configuration

All settings use the `STUDIO_` prefix:

| Variable | Default | Description |
| --- | --- | --- |
| `STUDIO_WORKSPACE` | `.` (cwd) | Workspace root — MCP tools are constrained to this directory |
| `STUDIO_PORT` | `8043` | Bind port |
| `STUDIO_HOST` | `127.0.0.1` | Bind host |
| `STUDIO_LOG_LEVEL` | `info` | Log level |
| `STUDIO_CANTICA_SERVERS` | `[]` | JSON array of `{"url":"…","auth_token":"…"}` objects |
| `STUDIO_GRAPH_FILE` | `.vscode/actors.jsonld` | Path to actor graph file (relative to workspace) |

---

## API endpoints

### Actor graph

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/graph` | Load actor graph JSON-LD from workspace |
| `PUT` | `/v1/graph` | Save actor graph JSON-LD to workspace |

### Cantica prompts

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/prompts` | List prompts aggregated from all configured Cantica servers |
| `GET` | `/v1/prompts/{namespace}/{name}` | Fetch a specific prompt's content |

### Actor runtime

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/runtime/actors` | List running actor names |
| `POST` | `/v1/runtime/actors` | Start an actor instance |
| `DELETE` | `/v1/runtime/actors/{name}` | Stop a running actor |
| `POST` | `/v1/runtime/actors/{name}/instruct` | Send an instruction to an actor |
| `POST` | `/v1/runtime/actors/{name}/event/{event}` | Fire a named prompt event |

### MCP server

| Path | Transport | Description |
| --- | --- | --- |
| `/mcp` | HTTP (streamable-HTTP) | MCP server with workspace file-system tools |

**MCP tools:** `read_file`, `write_file`, `list_files`, `search_files` — all constrained to `STUDIO_WORKSPACE`.

### Meta

| Path | Description |
| --- | --- |
| `GET /health` | Liveness probe |
| `GET /.well-known/cantica.json` | Service discovery |
| `GET /docs` | Swagger UI |

---

## Actor graph format (JSON-LD)

The graph is persisted as JSON-LD at `STUDIO_WORKSPACE/.vscode/actors.jsonld`:

```json
{
  "@context": { "@vocab": "https://cantica.dev/studio/" },
  "@type": "ActorGraph",
  "name": "My Workflow",
  "actors": [
    {
      "@type": "AIActor",
      "name": "architect",
      "definePrompt": "cantica://community/architect@v1.0",
      "provider": "claude",
      "model": "claude-sonnet-4-6",
      "promptEvents": [
        { "@type": "PromptEvent", "name": "onSave", "filePattern": "**/*.py",
          "prompt": "cantica://osteck/review@latest" }
      ],
      "cronJobs": [
        { "@type": "CronJob", "schedule": "0 9 * * 1-5",
          "prompt": "cantica://osteck/standup@latest" }
      ]
    }
  ],
  "edges": [
    {
      "@type": "ActorMessage",
      "from": "urn:cantica:studio:actor:...",
      "to": "urn:cantica:studio:actor:...",
      "prompt": "Review this: {output}",
      "label": "for review"
    }
  ]
}
```

---

## Development

```bash
# Run tests
uv run pytest

# Lint
uv run ruff check src/ tests/
```

---

## Project structure

```text
src/studio_api/
├── actor.py           StudioActor(AIActor) — prompt events, cron jobs, outbox
├── cantica_client.py  Multi-server Cantica connector (async + sync)
├── config.py          Settings (pydantic-settings, STUDIO_ prefix)
├── main.py            FastAPI app factory + MCP mount + lifespan
├── mcp_server.py      fastmcp tools: read_file, write_file, list_files, search_files
├── runtime.py         ActorRuntime — pykka lifecycle + APScheduler cron jobs
├── workspace_fs.py    Path-traversal-safe workspace file operations
└── api/v1/
    ├── graph.py        GET/PUT /v1/graph
    ├── prompts.py      GET /v1/prompts, GET /v1/prompts/{ns}/{name}
    └── runtime.py      Actor start/stop/instruct/fire-event endpoints
```
