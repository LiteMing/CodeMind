# Code Mind VS Code Extension

Open and operate Code Mind from inside VS Code.

## Usage

1. Start a Code Mind backend: launch the Code Mind desktop app, or run `codemind serve` for a headless server. The extension is a thin client and does not bundle its own backend.
2. Run `Code Mind: Open Web App` to open the full local web UI inside VS Code.
3. If needed, run `Code Mind: Configure API URL` and keep the default `http://127.0.0.1:34117`.
4. Optionally set `codeMind.backendCommand` (e.g. `codemind.exe serve`) to let VS Code start the backend for you.
5. Leave `codeMind.dataDir` empty to use the shared Code Mind app data directory, or set it only when you need a custom data directory.

## Features

- Open the full Code Mind web app in a VS Code Webview.
- Start and stop a local Code Mind backend from VS Code.
- Browse mindmaps and nodes from the activity bar.
- Create, rename, delete nodes, and open notes.
- Preserve node sibling `order` and repository `bindings` in the typed API client.
- Reject stale node writes with revision/`If-Match` checks instead of overwriting newer map changes.
- Configure local API URL and API Key from commands.
