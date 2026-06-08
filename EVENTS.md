# Events

A **prompt event** is a named trigger defined on an AI actor. When fired, it runs a configured prompt on the actor that owns it and routes the output to one or more target actors.

---

## Defining an event

Events are declared in the songbook (`.jsonld`) under an actor's `promptEvents` array:

```json
{
  "@type": "AIActor",
  "name": "sender",
  "provider": "copilot",
  "model": "claude-sonnet-4.5",
  "definePrompt": "You are an event sender. When asked about time, call fire_event with event_name='ask-for-time'.",
  "promptEvents": [
    {
      "@type": "PromptEvent",
      "name": "ask-for-time",
      "prompt": "What time is it?",
      "targetActors": ["receiver"]
    }
  ]
}
```

| Field          | Description |
|----------------|-------------|
| `name`         | Unique identifier used when firing the event |
| `prompt`       | The instruction sent to the actor's model when the event fires |
| `targetActors` | Actors that receive the event output as their next instruction |

An edge in the graph (`"kind": "event"`) represents the same routing visually but is not required for the runtime — `targetActors` is the authoritative routing list.

---

## How an event is fired

There are three ways to fire an event.

### 1. Model-initiated (via `fire_event` tool)

The most common path. The actor's model decides to call the `fire_event` tool based on its system prompt and the user's message.

```
User → sender.instruct("ask for time")
         └─ model calls fire_event(event_name="ask-for-time")
              └─ StudioActor.fire_event()   [actor.py:85]
```

`fire_event` is a `@tool`-decorated method on `StudioActor`. `extract_tools(self)` includes it in every provider call so the model can invoke it as a function.

**Requirement:** use a model that reliably follows tool-calling instructions (e.g. `claude-sonnet-4.5`). The `"auto"` model uses Copilot's agent mode and does not expose custom tools to the model.

### 2. UI-initiated (actors panel)

The user clicks the event button in the Actors panel. The extension posts a `fireEvent` message to the extension host:

```
actors-panel.ts (webview)  →  { type: 'fireEvent', name, eventName, context }
  └─ ActorsPanel.handleMessage()            [actors-panel.ts:197]
       └─ client.fireEvent(name, eventName) [studio-client.ts:163]
            └─ POST /v1/runtime/actors/{name}/event/{eventName}
```

### 3. API-initiated

Any HTTP client can fire an event directly:

```
POST /v1/runtime/actors/{name}/event/{event_name}
Content-Type: application/json

{ "context": "optional extra context appended to the event prompt" }
```

---

## Full execution chain (model-initiated)

```
User message
  │
  ▼
actors-panel.ts                         instructActor("sender", "…")
  │                                     POST /v1/runtime/actors/sender/instruct
  ▼
api/v1/runtime.py:128                   loop.run_in_executor(None, rt.instruct, …)
  │
  ▼
runtime.py:275                          proxy.instruct(text).get(timeout=120)
  │                                     [pykka message to sender's thread]
  ▼
actor_ai/actor.py:179                   provider.run(system=…, messages=…, tools=[fire_event, …])
  │
  ▼
actor_ai/providers/copilot.py           asyncio.run(_run_sdk(…))
  │                                     Copilot CLI session, model=claude-sonnet-4.5
  │                                     fire_event registered as external tool (skip_permission=True)
  ▼
  [model emits tool call: fire_event(event_name="ask-for-time")]
  │
  ▼
copilot/session.py:1280                 ExternalToolRequestedData  →  _execute_tool_and_respond()
  │
  ▼
actor.py:85   StudioActor.fire_event(event_name="ask-for-time")
  ├─ looks up PromptEventDef  →  prompt = "What time is it?"
  ├─ ThreadPoolExecutor: sender.instruct("What time is it?", use_session=False)
  │    └─ Copilot SDK nested call  →  model answer, e.g. "It is 08:50 UTC."
  └─ for target in ["receiver"]:
       └─ self._instruct_actor("receiver", "It is 08:50 UTC.")
            │
            ▼
            runtime.py:275   proxy.instruct("It is 08:50 UTC.").get()
              │               [pykka message to receiver's thread]
              ▼
            provider.run(…)  →  receiver model responds
```

The call is fully synchronous end-to-end. The HTTP response from `POST /instruct` does not return until all target actors have finished processing.

---

## Event execution in `StudioActor` vs `ActorRuntime`

There are two `fire_event` implementations and they serve different callers.

| Location | Caller | What it does |
|----------|--------|--------------|
| `actor.py:85` `StudioActor.fire_event` | The model (via `@tool`) | Runs the prompt on `self`, forwards output via `_instruct_actor` injected by the runtime |
| `runtime.py:283` `ActorRuntime.fire_event` | API / UI / cron | Runs the prompt on the actor's pykka proxy, then calls `self.instruct(target, output)` for each target |

Both paths produce the same result. The `StudioActor` version uses a `ThreadPoolExecutor` to avoid deadlocking the Copilot SDK's asyncio event loop during a nested model call.

---

## Adding an event to an existing actor

1. Open the songbook in the Cantica Scores panel.
2. Add a `PromptEvent` node to the actor and connect an edge to the target actor.
3. Update the actor's `definePrompt` to instruct the model when to call `fire_event`.
4. Reload the songbook (click it in the sidebar) so the graph is pushed to the Studio API.
5. Restart the actor if it was already running.
