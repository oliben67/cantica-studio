# cantica-studio-api

Lightweight local API server that backs the **Cantica Studio** VSCode extension.

It exposes the full Cantica CRUD surface (namespaces, prompts, versions, branches, render) without authentication or federation. Data is stored in `CANTICA_HOME/vault` (default: `~/.cantica/vault`), sharing the same vault as the `cantica` CLI.

The studio API wraps `cantica-api` as a library — it re-uses `VersionStore` and `BlobStore` directly without spawning a second process.

---

## Quick start

```bash
# Install (dev mode — requires cantica-api sibling repo)
uv pip install -e .

# Run
cantica-studio
# or
uvicorn cantica_studio_api.main:app --reload --port 8043
```

The API is available at `http://localhost:8043`.

---

## Docker

The recommended way to run the studio API is via Docker Compose from the `cantica-studio/studio-api/` directory:

```bash
docker compose up -d
```

This builds a two-stage image: stage 1 builds a wheel from `cantica-api`, stage 2 installs it alongside `cantica-studio-api`. The build context is the `cantica-project/` root so both repos are available.

---

## Configuration

All settings are read from environment variables (no prefix):

| Variable | Default | Description |
| --- | --- | --- |
| `CANTICA_HOME` | `~/.cantica` | Root directory for the vault and database |
| `CANTICA_HOST` | `0.0.0.0` | Bind host |
| `CANTICA_PORT` | `8043` | Bind port |
| `CANTICA_LOG_LEVEL` | `info` | Log level |

---

## Endpoints

| Path | Description |
| --- | --- |
| `GET /health` | Liveness probe |
| `GET /.well-known/cantica.json` | Service discovery |
| `/v1/...` | Full Cantica REST API (prompts, versions, branches, render, …) |
| `/docs` | Swagger UI |

---

## Project structure

```text
src/cantica_studio_api/
├── api/v1/        Router and endpoint modules
├── config.py      Settings (pydantic-settings)
└── main.py        FastAPI app factory and CLI entry point
```
