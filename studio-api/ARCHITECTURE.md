# Studio API — Architecture

## Overview

The Studio API is a FastAPI server that manages AI and code actors for the Cantica Studio VS Code extension. It supports two modes:

- **local mode** (`STUDIO_LOCAL_MODE=true`, default): auth is bypassed; a single pseudo-user with all permissions is granted to every request. API keys are read from host env vars.
- **remote mode**: full JWT + RBAC auth; an admin user is seeded on first start.

---

## Layer Diagram

```mermaid
graph TD
    Clients["Clients<br/>(VS Code extension · MCP clients)"]

    subgraph FastAPI["FastAPI App — main.py"]
        Health["/health · /.well-known/cantica.json"]
        subgraph V1["/v1 — api/v1/router.py"]
            Public["[public]<br/>/auth"]
            Protected["[protected — requires auth]<br/>/runtime · /graph · /prompts · /providers<br/>/access · /resources · /users · /roles"]
        end
        MCP["/mcp — FastMCP HTTP transport"]
    end

    subgraph Auth["Auth Layer"]
        JWT["auth/jwt.py (HS256)"]
        PWD["auth/password.py (Argon2)"]
        Deps["auth/deps.py"]
        ORM["orm/ — SQLite WAL<br/>models.py · seed.py · db.py"]
    end

    subgraph Services["Core Services"]
        Runtime["runtime.py — ActorRuntime"]
        Actor["actor.py — StudioActor"]
        CodeActor["code_actor.py"]
        Access["access.py — AccessStore"]
        Cantica["cantica_client.py — CanticaConnector"]
        WFS["workspace_fs.py — WorkspaceFS"]
        MCPSrv["mcp_server.py"]
    end

    Clients -->|HTTP| FastAPI
    V1 --> Auth
    V1 --> Services
    MCP --> Services
```

---

## File Layout

```
src/studio_api/
├── main.py              entry point, lifespan, app factory
├── config.py            Settings (pydantic-settings, STUDIO_ prefix)
├── runtime.py           ActorRuntime — actor lifecycle, scheduling, notifications
├── actor.py             StudioActor — pykka AI actor with events, crons, tools
├── code_actor.py        TypeScriptCodeActor — subprocess actor (JSON-line protocol)
├── access.py            AccessStore — provider credential records
├── cantica_client.py    CanticaConnector — fetches prompts from Cantica servers
├── workspace_fs.py      WorkspaceFS — path-traversal-safe file operations
├── mcp_server.py        FastMCP server — file, actor, resource, event tools
│
├── orm/
│   ├── db.py            make_engine, new_session, Base (SQLite WAL)
│   ├── models.py        User, Role, Permission, ApiToken (+ join tables)
│   └── seed.py          Built-in permissions/roles, ensure_admin()
│
├── auth/
│   ├── jwt.py           create_access_token, decode_access_token
│   ├── password.py      hash_password, verify_password (Argon2)
│   └── deps.py          get_current_user, require_permission, CurrentUser, LOCAL_USER
│
└── api/v1/
    ├── router.py        Combines public (_public) and protected (_protected) routers
    ├── deps.py          RuntimeDep, ConnectorDep, AccessDep, DbSession + auth re-exports
    ├── auth.py          POST /auth/login, GET/POST/DELETE /auth/tokens
    ├── runtime.py       Actor lifecycle + instruct + event + notification endpoints
    ├── graph.py         GET/PUT /graph (actor graph JSON-LD file)
    ├── prompts.py       GET /prompts, GET /prompts/{ns}/{name}
    ├── providers.py     GET /providers/models (parallel provider queries)
    ├── access.py        CRUD /access (provider credentials)
    ├── resources.py     Actor resource management (add/share/delete)
    └── users.py         /users CRUD + role assignment, /roles listing
```

---

## Startup Sequence

```mermaid
sequenceDiagram
    participant UV as Uvicorn
    participant LF as _lifespan()
    participant DB as SQLite
    participant RT as ActorRuntime
    participant AP as APScheduler

    UV->>LF: startup
    LF->>DB: make_engine(workspace/.cantica-studio/studio.db)
    Note over DB: WAL mode + FK pragma
    LF->>DB: Base.metadata.create_all()
    LF->>DB: seed() — 18 permissions, 3 roles
    LF-->>DB: ensure_admin() (remote mode only)
    LF->>RT: ActorRuntime()
    RT->>AP: BackgroundScheduler.start()
    LF->>LF: CanticaConnector → app.state.connector
    LF->>LF: AccessStore → app.state.access_store
    LF->>LF: FastMCP.init(workspace_fs, runtime)
    Note over UV: server is live (yield)
    UV->>LF: shutdown
    LF->>RT: stop_all()
    LF->>DB: engine.dispose()
```

---

## Auth & RBAC

### Credential types

| Type | Discriminator | Storage |
|------|--------------|---------|
| JWT | `raw.count(".") == 2` → 3 segments | HS256-signed; permissions embedded in payload |
| API token | opaque hex string | SHA-256 hash stored in `api_tokens` table; raw shown once |

### `get_current_user` flow

```mermaid
flowchart TD
    Req["Authorization: Bearer &lt;token&gt;"]
    Req --> LocalCheck{local_mode?}
    LocalCheck -->|yes| LOCAL["return LOCAL_USER<br/>(permissions=['*'])"]
    LocalCheck -->|no| SegCheck{3 dot-separated<br/>segments?}
    SegCheck -->|yes / JWT| JWTDec["decode_access_token(token, secret)<br/>return CurrentUser(user_id, roles, permissions)"]
    SegCheck -->|no / API token| TokenLookup["SELECT ApiToken WHERE token_hash = SHA256(token)"]
    TokenLookup --> Checks["check expiry + user.is_active<br/>UPDATE last_used_at"]
    Checks --> APIUser["return CurrentUser(user_id, scopes as permissions)"]
```

### Permission model

```mermaid
erDiagram
    User {
        string id PK
        string email
        string password_hash
        bool is_active
    }
    Role {
        string id PK
        string name
    }
    Permission {
        string id PK
        string name "resource:action"
    }
    ApiToken {
        string id PK
        string user_id FK
        string token_hash
        string[] scopes
        datetime expires_at
        datetime last_used_at
    }

    User }o--o{ Role : "user_roles"
    Role }o--o{ Permission : "role_permissions"
    User ||--o{ ApiToken : "owns"
```

Built-in permissions (18): `runtime:{read,start,stop,instruct}`, `graph:{read,write}`, `prompts:read`, `providers:read`, `resources:{read,write}`, `access:{read,write}`, `users:{read,write}`, `roles:{read,write}`, `tokens:{read,write}`

Built-in roles:
- **admin** — all permissions
- **operator** — runtime + graph + prompts + resources; no user/role/token management
- **viewer** — read-only subset

`require_permission("runtime:start")` → FastAPI `Depends` that calls `user.has(perm)`. `has()` returns True immediately if permissions contain `"*"` (local mode / admin wildcard).

---

## Actor Model

### AI Actor startup

```mermaid
flowchart TD
    Start["ActorRuntime.start(defn, connector)"]
    Start --> Resolve["Resolve cantica:// URIs<br/>CanticaConnector.resolve_uri_sync()"]
    Resolve --> DynClass["Dynamically create StudioActor subclass<br/>type('Actor_name', (StudioActor,), {system_prompt, provider, ...})"]
    DynClass --> Spawn["actor_cls.start() → pykka spawns OS thread"]
    Spawn --> Crons["APScheduler registers cron jobs<br/>_register_crons()"]
    Crons --> Session["Restore saved session<br/>workspace/.cantica-studio/sessions/&lt;name&gt;.json"]
```

**StudioActor** extends `actor_ai.AIActor` (pykka). Each instance:
- holds an LLM provider (Claude, GPT, Gemini, Copilot, Mistral)
- maintains a message history (max_history limit)
- exposes a `fire_event(name, context)` tool the LLM can call to trigger event branches
- routes event output to other actors via `_instruct_actor` callback

### Code Actor (subprocess)

```mermaid
sequenceDiagram
    participant RT as ActorRuntime
    participant CA as TypeScriptCodeActor
    participant Proc as Subprocess (tsx / python3)

    RT->>CA: actor_cls.start()
    CA->>Proc: spawn process
    CA->>CA: reader thread (parse JSON-line stdout)
    Proc-->>CA: {"type":"ready","events":[...],"crons":[...]}
    Note over CA: ready within 15 s or error

    RT->>CA: instruct(text)
    CA->>Proc: {"type":"message","id":"x","content":"text"}
    Proc-->>CA: {"type":"response","id":"x","content":"result"}
    CA-->>RT: "result"

    RT->>CA: stop()
    CA->>Proc: {"type":"kill"}
    Proc-->>CA: exit
```

### Actor-to-Actor Routing

```mermaid
flowchart TD
    FE["fire_event(actor, 'my-event', context)"]
    FE --> Lookup["Look up PromptEventDef in actor's event list"]
    Lookup --> SR{sendResponse?}
    SR -->|true| LLM["Run actor's LLM on event prompt → output"]
    SR -->|false| Raw["output = event prompt + context (verbatim)"]
    LLM --> Route
    Raw --> Route["For each target_actor:<br/>rt.instruct(target_actor, output)"]
    Route --> Log["_forwarded_log.append({...})<br/>(thread-safe ring buffer)"]
    Log --> Drain["GET /v1/runtime/notifications → drains log"]
```

---

## Scheduling

`APScheduler BackgroundScheduler` is started in `ActorRuntime.__init__()`.

| Job type | Registered by | On trigger |
|----------|--------------|------------|
| AI actor cron | `_register_crons()` | `actor.proxy().instruct(prompt)` |
| Code actor cron | `_register_code_crons()` | `actor.proxy().run_cron(name)` |

Cron jobs respect the pause/resume flag of their actor.

---

## MCP Server

`mcp_server.py` exposes a FastMCP instance mounted at `/mcp`. Tools are available to any MCP-compatible client (Claude Desktop, Claude Code, etc.):

| Category | Tools |
|----------|-------|
| File ops | `read_file`, `write_file`, `list_files`, `search_files` |
| Code actors | `start_code_actor`, `stop_code_actor`, `list_code_actor_events`, `list_code_actor_crons` |
| Events | `fire_event` |
| Resources | `list_actor_resources`, `read_actor_resource`, `add_actor_resource`, `share_actor_resource`, `delete_actor_resource` |

Every tool call is logged to a thread-safe ring buffer (max 200 entries) drained via `GET /v1/runtime/mcp-log`.

---

## Cantica Prompt Integration

Prompts are referenced by `cantica://` URIs in actor definitions:

```
cantica://[host/]namespace/name[@ref]
```

`CanticaConnector` holds a list of configured Cantica servers (`STUDIO_CANTICA_SERVERS_RAW` JSON). URI resolution tries all servers in order. Async variants (`list_prompts`, `get_prompt_content`) are used in API endpoints; sync variants (`resolve_uri_sync`) are used from inside pykka actor threads.

---

## Access / Provider Credentials

`AccessStore` manages named credential bundles (Anthropic, OpenAI, Gemini, GitHub). In **local mode** a single read-only record is auto-created from host env vars. In **remote mode** records can be created, updated, and deleted via the `/access` endpoints (requires `access:write`).

Credentials are never returned in responses — only presence flags (`has_anthropic_api_key: true`).

---

## Configuration Reference

All settings use the `STUDIO_` env prefix (via `pydantic-settings`):

| Variable | Default | Description |
|----------|---------|-------------|
| `STUDIO_WORKSPACE` | `.` | Workspace root directory |
| `STUDIO_PORT` | `8043` | HTTP listen port |
| `STUDIO_HOST` | `127.0.0.1` | HTTP listen host |
| `STUDIO_LOCAL_MODE` | `true` | Disable auth; use env-var credentials |
| `STUDIO_JWT_SECRET` | `""` | Required if `local_mode=false` |
| `STUDIO_JWT_EXPIRE_MINUTES` | `60` | JWT lifetime |
| `STUDIO_ADMIN_EMAIL` | `admin@studio.local` | Seeded admin email |
| `STUDIO_ADMIN_PASSWORD` | `""` | Seeded admin password (remote mode) |
| `STUDIO_GRAPH_FILE` | `.vscode/actors.jsonld` | Workspace-relative graph path |
| `STUDIO_CANTICA_SERVERS_RAW` | `[]` | JSON array of `{url, auth_token}` |
| `STUDIO_LOG_LEVEL` | `info` | Uvicorn log level |

---

## Key Data Flows

### Start an AI actor

```mermaid
sequenceDiagram
    participant C as Client
    participant EP as POST /v1/runtime/actors
    participant Auth as require_permission
    participant RT as ActorRuntime
    participant CC as CanticaConnector
    participant PK as pykka
    participant AP as APScheduler

    C->>EP: {name, define_prompt, provider, model, ...}
    EP->>Auth: runtime:start
    Auth-->>EP: ok
    EP->>RT: asyncio.to_thread(rt.start, defn, connector)
    RT->>CC: resolve_uri_sync(cantica:// URIs)
    CC-->>RT: prompt content
    RT->>PK: StudioActor subclass.start()
    PK-->>RT: ActorRef
    RT->>AP: register cron jobs
    RT->>RT: restore session from JSON
    RT-->>EP: actor started
    EP-->>C: {name, status:"running", actor_type:"ai"}
```

### Send instruction to actor

```mermaid
sequenceDiagram
    participant C as Client
    participant EP as POST /v1/runtime/actors/{name}/instruct
    participant RT as ActorRuntime
    participant Act as StudioActor (pykka thread)
    participant LLM as LLM Provider

    C->>EP: {instruction: "..."}
    EP->>RT: asyncio.to_thread(rt.instruct, name, text)
    alt actor paused
        RT-->>EP: "queued"
    else actor running
        RT->>Act: proxy().instruct(text).get(timeout=360)
        Act->>LLM: chat completion
        LLM-->>Act: response (may call fire_event tool)
        Act-->>RT: output
        RT-->>EP: output
    end
    EP-->>C: {name, output: "..."}
```

### JWT login

```mermaid
sequenceDiagram
    participant C as Client
    participant EP as POST /v1/auth/login
    participant DB as SQLite
    participant JWT as auth/jwt.py

    C->>EP: {email, password}
    EP->>DB: SELECT User WHERE email = ?
    DB-->>EP: user row
    EP->>EP: verify_password(password, user.password_hash) [Argon2]
    EP->>DB: SELECT roles + permissions (joined)
    DB-->>EP: roles[], permissions[]
    EP->>JWT: create_access_token(user_id, roles, permissions)
    JWT-->>EP: HS256 signed token
    EP-->>C: {access_token, expires_in}
```
