# Current Decisions

## Editor Assumptions

- The product is currently single-document and local-first.
- The canonical storage format is local JSON under `data/default-map.json`.
- Markdown and TXT are interchange formats, not the source of truth.
- Node collapse state is stored in local JSON only and is not exported to Markdown.
- The web version remains the fastest development surface, but a Wails desktop shell is now enabled and builds successfully.

## Import Heuristics

- Plain text import treats the first meaningful line as the root node title.
- Indentation is interpreted with a 2-space unit. Tabs are treated as 2 spaces.
- Markdown list markers (`-`, `*`, `+`, `1.`) are stripped during import.
- `## Floating Nodes` is interpreted as free nodes plus their child branches.
- `## Relations` is interpreted as semantic relation edges, not hierarchy.

## Layout Rules

- Root starts in a centered workspace position instead of the old top-left placement.
- `Tidy Layout` balances root branches to both sides when a side is empty.
- Floating nodes are never changed by hierarchy auto layout.
- The editor shell now follows a GitMind-like direction: full-canvas workspace, floating toolbars, and a right-side floating inspector.
- The 3D graph mode is now implemented as an explicitly opened read-only overlay with search, manual drag rotation, and jump-back into the editor.

## Interaction Rules

- `Tab` creates a child node.
- `Enter` creates a sibling node.
- Root sibling creation becomes a floating node.
- `Delete` removes the selected node plus its descendants.
- `Space` opens inline editing and places the cursor at the end of the current node title.
- `F2` renames the selected node.
- Arrow keys move selection to the nearest visible node in that screen direction.
- First launch is blocked by a language picker until the user confirms a locale.
- Workspace settings stay in-page and local, not in external config files.

## Local Preferences

- UI locale is stored in browser-local preferences, separate from the mind-map document JSON.
- AI defaults are currently local-only settings and default to LM Studio with `http://127.0.0.1:1234/v1`.
- AI generation and AI relation suggestions currently use a local OpenAI-compatible endpoint from the Go backend.
- The AI workspace now includes a lightweight connection test that checks `/models` before running generation or relation analysis.
- Mind-map theme remains a document-level setting so the same map keeps its appearance across reloads.

## Deferred Risks

- Relation import currently matches nodes by title, so duplicate titles are ambiguous.
- Non-standard TXT or Markdown exports may still need AI-assisted normalization later.
- Collaboration remains deferred in `docs/open-issues.md`.

## Desktop Shell

- Wails is now the active desktop-shell direction.
- Web frontend and desktop frontend share the same codebase.
- Desktop mode uses a local API server on `http://127.0.0.1:34117/api`.
- Wails production build currently outputs `build/bin/CodeMind.exe`.
