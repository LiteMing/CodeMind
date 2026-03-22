# Project Summary

This document is a compact handoff summary for the next conversation.

## Product Shape

- Local-first mind map editor.
- Go backend for API and local JSON persistence.
- TypeScript + Vite frontend for the main editing experience.
- Wails desktop shell is already connected and buildable.

## Implemented Capabilities

### File And Document

- Multiple local mind-map files.
- Home view for create, open, rename, and delete.
- Local JSON is the source of truth.
- Markdown export.
- Markdown and TXT import.

### Core Editing

- Default root node on every new map.
- `Tab` creates child nodes.
- `Enter` creates sibling nodes.
- Root sibling creation becomes floating nodes.
- Double-click and `F2` inline rename.
- Double-click now opens inline editing with full-text selection.
- Direct typing replaces the whole current title.
- `Space` enters editing with the caret at the end.
- Non-root node drag.
- Node text box resize.
- Branch collapse and expand.
- Delete subtree.
- Auto layout for hierarchy nodes.

### Selection And Navigation

- Single selection and multi-selection.
- `Ctrl/Cmd + click` adds to selection.
- `Shift + click` selects a node with its descendants.
- Right-drag marquee selection.
- Arrow-key nearest-node navigation by screen direction.
- `Shift + Arrow` extends selection.
- Copy and paste of the primary selected subtree.
- Undo and redo.

### Relations

- Manual semantic relation edges separate from hierarchy.
- Editable relation labels.
- Relation mode cancel and remove behavior.

### AI

- AI workspace overlay.
- AI connection test.
- AI relation suggestion.
- AI topic-based graph generation.
- Built-in template maps and prompt directions.
- Local AI settings now include:
  - provider
  - base URL
  - API key
  - model
  - max output tokens
- `maxTokens` is forwarded to OpenAI-compatible `chat/completions`.
- `API Key` is forwarded to both `/models` and `/chat/completions` when provided.

### 3D Graph

- Read-only 3D floating graph overlay.
- Search and node selection in graph view.
- Double-click graph node to jump back to the editable mind map.
- Manual drag rotation.
- Auto-rotate toggle.
- View reset.

### Settings And Localization

- First-run language picker.
- Simplified Chinese and English UI.
- Light and dark theme toggle.
- In-page settings drawer.

## Current Dev Notes

- Use root `npm run dev` for normal web development.
- Vite dev server is now `strictPort: true` on `5173`.
- Unknown `/api/*` routes now return API 404 instead of falling back to HTML.
- Wails desktop API runs on `http://127.0.0.1:34117/api`.

## Current Limits

- Collaboration is still deferred.
- 3D graph is navigation-only, not an editing surface.
- AI relation results are applied directly; there is no review queue yet.
- Import relation matching can still be ambiguous when titles are duplicated.
