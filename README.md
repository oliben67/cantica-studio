# cantica-studio

Developer tooling for the Cantica prompt registry — a **VSCode extension** and a **lightweight local API**.

| Sub-project | Description |
| --- | --- |
| [`vscode/`](vscode/) | VSCode extension — browse, edit, and render prompts without leaving the editor |
| [`studio-api/`](studio-api/) | Local FastAPI server wrapping `cantica-api`; no auth, no federation |
| [`react-native/`](react-native/) | Mobile companion app (work in progress) |

---

## Architecture

The VSCode extension talks to the studio API over HTTP on `localhost:8043`. The studio API re-uses `VersionStore` and `BlobStore` from `cantica-api` directly, sharing the same vault on disk (default `~/.cantica/vault`) with the `cantica` CLI and the full API server.

```text
VSCode Extension
      │
      │ HTTP /v1
      ▼
cantica-studio-api   (port 8043, no auth)
      │
      │ Python import
      ▼
cantica-api VersionStore + BlobStore
      │
      ▼
~/.cantica/vault  (SQLite + content-addressable blobs)
```

---

## Quick start

```bash
# Install VSCode extension dependencies
task install

# Run all quality gates
task check
```

For the studio API, see [studio-api/README.md](studio-api/README.md).

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
