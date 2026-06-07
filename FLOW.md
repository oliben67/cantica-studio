# Cantica Studio — Call Flow Reference

This document traces every significant call made by the system from extension activation through actor start-up, event firing, and prompt consumption.

---

## 1. Initialization

```
VSCode activates extension (extension.ts)
  │
  ├─ readSettings() → ExtensionSettings from workspace config
  │
  ├─ StudioManager.ensureRunning()
  │     ├─ docker inspect cantica-studio-api → running?
  │     ├─ (if not) docker run cantica-studio-api:latest
  │     └─ StudioManager.waitUntilHealthy()
  │           └─ GET http://localhost:8043/health  (poll until 200 OK or timeout)
  │
  ├─ StudioClient(settings.studioBaseUrl)   ← wraps all API calls
  │
  └─ ActorsPanel.show(context, client, settings)
        ├─ builds webview HTML (dist/webview/index.js)
        └─ webview sends { type: 'ready' }
              │
              └─ ActorsPanel.handleMessage('ready')
                    ├─ GET /v1/graph           → loadGraph  → post { type: 'loadGraph', graph }
                    ├─ GET /v1/prompts         → post { type: 'updatePrompts', prompts }
                    ├─ GET /v1/providers/models → post { type: 'providerModels', models }
                    └─ post { type: 'updateSettings', settings }
```

**Studio API startup** (`studio-api/main.py`):
```
uvicorn  →  FastAPI app
  │
  ├─ GET  /health          → { "status": "ok" }
  ├─ GET  /v1/graph        → load graph.json from STUDIO_WORKSPACE
  ├─ GET  /v1/prompts      → fetch from configured Cantica servers
  └─ GET  /v1/providers/models → probe each provider's model list
```

---

## 2. Playing the Songbook (starting all actors)

```
User clicks ▶ Play in the toolbar
  │
  └─ webview posts { type: 'playSongbook' }
        │
        └─ ActorsPanel.handleMessage('playSongbook')
              └─ for each actor in graph.actors:
                    ├─ post { type: 'actorOutput', name, output: '⏳ Initialising …' }
                    ├─ POST /v1/runtime/actors  { name, define_prompt, provider, model, … }
                    │     │
                    │     └─ ActorRuntime._start_ai_actor()
                    │           ├─ pykka.ThreadingActor.start()   ← spawns actor thread
                    │           ├─ proxy = ref.proxy()
                    │           ├─ (optional) proxy.restore_session(saved_msgs)
                    │           └─ returns { name, initial_output: null }
                    │
                    ├─ post { type: 'actorOutput', name, output: '✓ Ready · <provider>/<model>' }
                    └─ post { type: 'actorStatus', name, running: true }
```

**Single-actor start** triggered by the ▶ Start button on an actor node:
```
webview posts { type: 'runActor', name, instruction: '__start__' }
  │
  └─ ActorsPanel.handleMessage('runActor')
        ├─ GET /v1/runtime/actors           → check if already running
        ├─ (if not running) POST /v1/runtime/actors
        ├─ post actorOutput '⏳ Initialising…' / '✓ Ready' / '⚠ Start failed'
        └─ post actorStatus running: true
```

---

## 3. Event Firing

Events are defined on actors and can be triggered three ways:

### 3a. File-save watcher (automatic)
```
User saves a file matching an actor's filePattern
  │
  └─ vscode.workspace.createFileSystemWatcher fires onDidChange
        │
        └─ POST /v1/runtime/actors/{name}/event/{event_name}  { context: filePath }
              │
              └─ ActorRuntime.fire_event(name, event_name, context)
                    ├─ finds PromptEventDef by event_name
                    ├─ builds instruction = evt.prompt + "\n\n" + context
                    ├─ ThreadPoolExecutor → StudioActor.instruct(instruction)
                    │     └─ LLM call with system_prompt + history + instruction
                    └─ if evt.target_actors:
                          └─ for each target: _instruct_actor(target_name, output)
                                └─ POST /v1/runtime/actors/{target}/instruct { instruction: output }
                                      (logged to _forwarded_log)
              │
              └─ returns { name, event, output, forwarded: [{ name, prompt, output }] }
        │
        └─ ActorsPanel:
              ├─ post actorOutput (sender's output)
              ├─ pushForwarded() → post actorOutput lines to each target actor
              └─ pushNotifications()
                    └─ GET /v1/runtime/notifications
                          └─ ActorRuntime.drain_notifications()  → empties _forwarded_log
                    └─ post actorOutput lines for each notification
```

### 3b. Manual fire from the Events modal (UI)
```
User opens actor → ⚡ Events → clicks fire on an event
  │
  └─ webview posts { type: 'fireEvent', name, eventName, context }
        │
        └─ ActorsPanel.handleMessage('fireEvent')
              └─ POST /v1/runtime/actors/{name}/event/{eventName}
                    (same flow as 3a from here)
```

### 3c. LLM uses the fire_event tool (autonomous)
```
instruct() is called on an actor (e.g. by another actor or by the user)
  │
  └─ StudioActor.instruct(instruction)
        └─ LLM decides to call the fire_event tool
              │
              └─ StudioActor.fire_event(event_name, context)   ← @tool method
                    ├─ ThreadPoolExecutor → self.instruct(evt.prompt + context)
                    └─ if target_actors: _instruct_actor(target, output)
                          (same forwarding + notification log as 3a)
```

---

## 4. Prompt Consumption (instructing an actor directly)

```
User types a prompt in the actor node's input field and presses Enter
  │
  └─ webview posts { type: 'runActor', name, instruction: 'user text' }
        │
        └─ ActorsPanel.handleMessage('runActor')
              ├─ confirms actor is running (or starts it first)
              └─ POST /v1/runtime/actors/{name}/instruct  { instruction: 'user text' }
                    │
                    └─ ActorRuntime.instruct(name, text)
                          └─ proxy.instruct(text).get(timeout=120)
                                │
                                └─ StudioActor.instruct(text, use_session=True)
                                      ├─ adds text to _session history
                                      ├─ calls actor-ai SDK: send messages to LLM
                                      │     ├─ system: actor's system_prompt
                                      │     ├─ history: last maxHistory messages
                                      │     └─ user: text
                                      ├─ appends LLM response to _session
                                      └─ returns output string
                    │
                    └─ returns { output: '…' }
              │
              ├─ post { type: 'actorOutput', name, output }
              └─ pushNotifications()
                    └─ GET /v1/runtime/notifications  (drain any side-effect forwarding)
```

---

## 5. API & MCP Call Log

All `StudioClient` HTTP calls are intercepted and forwarded to the webview as `apiLog` messages. The **Log** panel in the toolbar shows:

| Field | Description |
|-------|-------------|
| Time  | Timestamp of the call |
| Method | HTTP method (GET / POST / DELETE) |
| Path | API path (e.g. `/v1/runtime/actors`) |
| Status | HTTP status code (e.g. `200`, `422`, `500`) |
| Duration | Round-trip time in ms |

Flow:
```
StudioClient._fetch(path, init)
  ├─ fetch(baseUrl + path, init)
  ├─ records { ts, method, url, status, durationMs }
  └─ calls onLog(entry)
        │
        └─ ActorsPanel (onLog callback)
              └─ post { type: 'apiLog', entry }
                    │
                    └─ App.tsx message handler
                          └─ store.appendLog(entry)
                                │
                                └─ LogPanel renders entries (visible when Log toggled on)
```

MCP tool calls go through the studio-api MCP server (`mcp_server.py`) and are surfaced as ordinary `/v1/runtime/…` HTTP calls logged by the same mechanism.

---

## 6. Notification Polling

The extension polls for actor-to-actor forwarding activity every few seconds while an instruction is in flight and after fire-event calls:

```
ActorsPanel.pushNotifications()
  └─ GET /v1/runtime/notifications
        └─ ActorRuntime.drain_notifications()
              └─ returns and clears _forwarded_log
                    (list of { name, prompt, output } written by _instruct_actor)
  └─ for each notification:
        ├─ post { type: 'actorOutput', name: target, output: '> <prompt>' }
        └─ post { type: 'actorOutput', name: target, output: response }
```

---

## 7. Studio Health Status

A status bar item in VSCode polls the health endpoint every 5 seconds:

```
setInterval(5000)
  └─ GET /health
        ├─ 200 OK  → status bar: 🟢 Studio
        ├─ timeout / error → status bar: 🔴 Studio
        └─ (between states / starting) → status bar: 🟡 Studio
```
