# Open Issues

## Deferred By Priority

### Online Collaboration

- Target is multi-user simultaneous editing, but this is lower priority than the local editor.
- Open design question: full collaborative editing or one editor with multi-viewer mode first.
- Expected later work: room/session model, real-time transport, conflict resolution, presence, reconnect logic.
- Current direction from user: do not implement online collaboration now.
- Current direction from user: if collaboration is revisited later, keep it lightweight and token-auth based first.

### AI Semantic Relations

- The product should eventually suggest relation edges based on semantic similarity.
- Current blocker: relation confidence, false positive rate, and UX for accepting or rejecting suggestions are not defined.
- Temporary approach: keep manual relation edges now and defer AI suggestions.
- Current direction from user: start manually first.
- Current direction from user: later, batch-selected nodes should be able to start relation suggestions one by one.

### Import Repair For Non-Standard Formats

- Standard Markdown and indentation-based TXT can be parsed directly.
- Non-standard exported files should later allow an AI-assisted normalization pipeline.
- Current temporary rule: parse common structures first, record unsupported formats here, do not block core editor work.
- Current known limitation: relation import resolves node references by title, so duplicate node titles are ambiguous.
- Current known limitation: plain text import assumes the first meaningful line is the root title.
- Current direction from user: keep this low priority and stay minimal for now.
- Current direction from user: duplicate-node ambiguity can be solved later, likely by checking node types and relation data together.

### 2D Or 3D Floating Graph View

- This should visualize node count and relation density.
- Open design question: whether graph mode is a read-only presentation view or a full editing mode.
- Current temporary rule: keep document model compatible with graph views, but do not implement the renderer yet.
- Current direction from user: graph mode should be editable eventually, but default to read-only.
- Current direction from user: allow it to be explicitly opened, and consider auto-entering when zooming far out.
- Current direction from user: node abbreviations may later be AI-generated, and renderer choice can stay flexible.

### Desktop Shell

- The long-term direction is a local desktop application.
- Wails is still a good candidate, but the shell is deferred until the core editor behavior stabilizes.
- Current direction from user: Wails is allowed and should be tried.
- Current status: Wails CLI is installed and a desktop build path is now working.
