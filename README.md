# Code Mind

Local-first mind map editor prototype.

Current focus:

- Default root node and keyboard-first editing
- GitMind-like floating workspace shell
- Light/dark theme toggle
- Markdown export and Markdown/TXT import
- Manual relation edges distinct from hierarchy
- Go backend with local JSON persistence
- Branch collapse, subtree deletion, and auto layout

## Structure

- `cmd/server`: Go HTTP server
- `internal/mindmap`: document model plus import/export helpers
- `internal/store`: local JSON persistence
- `internal/server`: API and static file serving
- `frontend`: Vite + TypeScript client
- `docs`: product plan and open issues

## Current Features

- Default root node with `Tab` child creation and `Enter` sibling creation
- Root sibling creation as floating nodes
- Double-click or `F2` rename
- First-run language picker with English and Simplified Chinese
- In-page settings drawer for locale, theme, and local AI defaults
- AI workspace for automatic semantic relation suggestions
- AI connection test for LM Studio or another OpenAI-compatible local endpoint
- AI topic-based knowledge graph generation
- Built-in AI template example maps
- Priority badges: `P0` to `P3`
- Branch collapse and expand
- Node drag for non-root nodes
- Manual relation edges with editable labels
- Hierarchy auto layout
- Read-only 3D floating graph overlay with search, drag-to-orbit, optional auto-rotate, and jump-back
- Local JSON persistence through the Go backend
- Markdown export and Markdown/TXT import
- Wails desktop shell build

## Shortcuts

- `Tab`: add child node
- `Enter`: add sibling node
- `Delete`: delete selected node subtree
- `Space`: enter editing with cursor at the end
- `F2`: rename selected node
- `Arrow keys`: move selection by direction
- `Shift + Arrow keys`: extend selection
- `Ctrl/Cmd + C`: copy current primary subtree
- `Ctrl/Cmd + V`: paste subtree under current primary node
- `Ctrl/Cmd + L`: tidy hierarchy layout
- `Ctrl/Cmd + S`: save

Detailed shortcut notes live in `docs/keyboard-shortcuts.md`.

## Run

Root dev mode:

```powershell
npm install
npm run dev
```

Backend only:

```powershell
go run ./cmd/server
```

Production frontend build:

```powershell
npm run build
```

After building the frontend, the Go server serves `frontend/dist`.

## Desktop

Wails desktop dev:

```powershell
$w = Join-Path (go env GOPATH) 'bin\wails.exe'
& $w dev
```

Wails desktop build:

```powershell
$w = Join-Path (go env GOPATH) 'bin\wails.exe'
& $w build -nopackage
```

Current desktop output:

- `build/bin/CodeMind.exe`

## Verify

Backend tests:

```powershell
go test ./...
```

Frontend build:

```powershell
cd frontend
npm run build
```
