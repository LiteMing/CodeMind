# Code Mind VS Code Extension

Open and operate Code Mind from inside VS Code.

## Usage

1. Open the Code Mind repository in VS Code.
2. Run `Code Mind: Open Web App` to open the full local web UI inside VS Code.
3. By default, the extension starts a local backend with `go run ./cmd/server`.
4. If needed, run `Code Mind: Configure API URL` and keep the default `http://127.0.0.1:34117`.
5. If you prefer connecting to the desktop app instead of the extension-managed backend, disable `codeMind.autoStartBackend`.
6. Leave `codeMind.dataDir` empty to use the shared Code Mind app data directory, or set it only when you need a custom data directory.

## Features

- Open the full Code Mind web app in a VS Code Webview.
- Start and stop a local Code Mind backend from VS Code.
- Browse mindmaps and nodes from the activity bar.
- Create, rename, delete nodes, and open notes.
- Configure local API URL and API Key from commands.
