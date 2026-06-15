# Cantica Studio

AI Actor Studio — build, connect, and run actor-ai agents backed by Cantica prompts, directly from VS Code.

## Features

### Songbooks
Browse and manage your local Cantica songbooks (`.jsonld` files stored under `~/.cantica/songbooks`). Create, view, edit, export, or delete songbooks from the sidebar panel.

### Servers
Register and manage multiple Cantica prompt servers. Each server entry holds a URL and optional bearer token.

### Studio
Control the local Studio API container without leaving the editor:
- **Start / Stop** the Studio API with a single click
- **Configure** server settings via the VS Code settings panel
- **Open Workspace** to launch the actor graph canvas

### Actor Graph Canvas
A full webview canvas (powered by React Flow) for composing AI actor networks:
- Add, connect, and delete actor nodes
- Save and reload the actor graph
- Edit the underlying JSON-LD file directly

### Context Menu Integration
Right-click any `.jsonld` file in the Explorer to open it in the actor graph editor.

## Requirements

- A running Cantica API server (default: `http://localhost:8042`)
- Docker (optional) for the local Studio API container

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `canticaScores.serverUrl` | `http://localhost:8042` | Primary Cantica prompt server URL |
| `canticaScores.servers` | `[]` | Additional servers `[{"url": "...", "authToken": ""}]` |
| `canticaScores.authToken` | `""` | Bearer token for the primary server |
| `canticaScores.explorerSide` | `left` | Side of the canvas where the prompt browser docks (`left`/`right`) |
| `canticaScores.canticaHome` | `""` | Cantica home directory (defaults to `~/.cantica`) |
| `canticaScores.studioPort` | `8043` | Local port for the Studio API container |
| `canticaScores.autoStartStudio` | `true` | Auto-start the Studio API container on activation |

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P`) under the **Cantica Studio** category:

| Command | Description |
|---|---|
| Open Workspace | Open the actor graph canvas |
| Add AI Actor | Add a new actor node to the canvas |
| Save Actor Graph | Persist the current actor graph |
| Reload Actor Graph | Reload the graph from disk |
| Reset Workspace | Clear the actor graph canvas |
| Edit Actor Graph | Open the raw JSON-LD graph file |
| Start Studio API | Start the local Studio API container |
| Stop Studio API | Stop the local Studio API container |
| Configure Servers | Open extension settings |
| New Songbook | Create a new songbook file |
| Save All Songbooks | Save all open songbooks |
| Close All Songbooks | Close all open songbooks |
| New Cantica Server | Register a new remote server |
| Delete Cantica Server | Remove a registered server |

## Getting Started

1. Install the extension.
2. Open the **Cantica Studio** panel in the Activity Bar.
3. The Studio API starts automatically (if `autoStartStudio` is enabled).
4. Use the **Songbooks** panel to open an existing prompt library, or create a new one.
5. Open the actor graph canvas via **Open Workspace** to start building agent pipelines.
