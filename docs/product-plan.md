# Code Mind Product Plan

## Goal

Build a local-first mind map editor that keeps XMind or GitMind style efficiency, but avoids subscription lock-in and heavy runtime cost.

## Priority Order

1. Core editor interactions
2. Light/dark theme
3. Markdown export plus TXT/Markdown import
4. Online collaboration
5. 2D or 3D graph view

## Phase Scope

### Phase 1

- One default root node
- `Tab` creates a child node
- `Enter` creates a sibling node
- Root sibling becomes a floating node
- Double click enters edit mode
- Quick priority badge insertion: `P0`, `P1`, `P2`, `P3`
- Non-root nodes can be dragged
- Manual relation edges supported
- Light/dark theme toggle
- Local JSON save
- Markdown export
- TXT and Markdown import for common indentation and list formats

### Phase 2

- Better auto layout
- Richer node stickers and icons
- Import repair for incompatible formats
- Command palette and more keyboard actions
- Better edge labels and styling

### Phase 3

- Multi-user collaboration
- AI-assisted semantic relation suggestions
- AI-assisted import normalization

### Phase 4

- 2D graph mode
- 3D graph mode
- Large-graph performance optimization

## Product Rules

- Root node is unique and fixed in role.
- Hierarchy and relation edges are different concepts.
- Local JSON is the primary storage format.
- Markdown is an interchange format, not the source of truth.
- Low-priority blockers should be written into `docs/open-issues.md` instead of blocking current delivery.

## Current Architecture Decision

- Backend: Go HTTP server
- Frontend: Vite + TypeScript
- Desktop shell: deferred for now

Reason: it lets us start building editor logic immediately without waiting on Wails packaging, while keeping the backend in Go and leaving room to wrap the app as a desktop program later.
