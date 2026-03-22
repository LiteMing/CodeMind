# Code Mind

Local-first mind map editor prototype.

Current focus:

- Default root node and keyboard-first editing
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
- Priority badges: `P0` to `P3`
- Branch collapse and expand
- Node drag for non-root nodes
- Manual relation edges with editable labels
- Hierarchy auto layout
- Local JSON persistence through the Go backend
- Markdown export and Markdown/TXT import
- Wails desktop shell build

## Shortcuts

- `Tab`: add child node
- `Enter`: add sibling node
- `Delete`: delete selected node subtree
- `Space`: collapse or expand selected branch
- `F2`: rename selected node
- `Ctrl/Cmd + L`: tidy hierarchy layout
- `Ctrl/Cmd + S`: save

## Run

Backend:

```powershell
go run ./cmd/server
```

Frontend dev server:

```powershell
cd frontend
npm install
npm run dev
```

Production frontend build:

```powershell
cd frontend
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
