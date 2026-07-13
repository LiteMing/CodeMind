# Code Mind VS Code Extension

Open and operate Code Mind from inside VS Code.

## Usage

1. Configure `codeMind.backendExecutable`, place CodeMind on `PATH`, or open the CodeMind source workspace with a build under `build/bin`. The extension can then start the headless backend itself.
2. Run `Code Mind: Open Web App` to open the full local web UI inside VS Code.
3. If needed, run `Code Mind: Configure API URL` and keep the default `http://127.0.0.1:34117`.
4. Use `Code Mind: Start/Stop/Restart Local Backend`; the status bar shows the current health state.
5. Leave `codeMind.dataDir` empty to use the shared app data directory, or set `${workspaceFolder}/.codemind/runtime` for a workspace-local backend. Protect that directory with `Code Mind: Protect Workspace Runtime from Git`.
6. Bind a map with `Code Mind: Bind Mindmap to Workspace`, then update canonical project files or create named workspace snapshots when needed.

## Features

- Open the full Code Mind web app in a VS Code Webview.
- Discover, start, stop, restart, and monitor a local Code Mind backend from VS Code.
- Browse mindmaps and nodes from the activity bar.
- Create, rename, delete nodes, and open notes.
- Preserve node sibling `order` and repository `bindings` in the typed API client.
- Reject stale node writes with revision/`If-Match` checks instead of overwriting newer map changes.
- Send the Phase D command envelope (`development` partition plus an idempotency key) for node writes.
- Configure local API URL and API Key from commands.
- Bind a workspace through `.codemind/project.json` without storing credentials.
- Materialize canonical `.codemind/semantic.json` and `layout.json` atomically.
- Save named milestone snapshots under `.codemind/snapshots/`; automatic and AI snapshots remain client-local.
