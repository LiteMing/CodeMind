# Keyboard Shortcuts

This document summarizes the current keyboard behavior of the editor.

## Node Creation

- `Tab`: create a child node under the current primary selection.
- `Enter`: create a sibling node for the current primary selection.
- `Enter` on the root node: create a floating node.

## Node Editing

- `F2`: rename the current primary selection.
- Direct typing on a selected node: immediately enter editing and replace the whole title with the typed character.
- `Space`: enter editing and place the caret at the end of the current node title.
- `Escape` while editing: cancel inline editing.

## Selection And Navigation

- `Arrow Up / Down / Left / Right`: move the primary selection to the nearest visible node in that screen direction.
- `Shift + Arrow Up / Down / Left / Right`: extend the current selection toward the nearest visible node in that direction.
- Plain arrow navigation replaces the selection with the new primary node.
- Shift-arrow keeps the existing selection and adds the newly reached node if it is not already selected.
- Multi-selection still has a single primary node, which is the last navigated node.

## Clipboard

- `Ctrl/Cmd + C`: copy the current primary node and all of its descendants as one subtree.
- `Ctrl/Cmd + V`: paste the copied subtree as children of the current primary node.
- Pasting converts the pasted subtree root into a normal topic node under the current target.
- Current limitation: copy uses the primary selected subtree, not every node in a multi-selection.

## Deletion

- `Delete`
- `Backspace`

Both delete the current selection. If multiple nodes are selected, their descendant subtrees are deleted together. The root node itself cannot be deleted.

## History

- `Ctrl/Cmd + Z`: undo
- `Ctrl/Cmd + Y`: redo
- `Ctrl/Cmd + Shift + Z`: redo

## Layout And Save

- `Ctrl/Cmd + L`: tidy hierarchy layout
- `Ctrl/Cmd + S`: save the current mind map

## Relation Mode

- `Esc` while relation mode is active: cancel relation mode

## Interaction Notes

- The editor is keyboard-first, but inline inputs always take priority over global shortcuts.
- When an input or textarea is focused, most global shortcuts are suppressed to avoid accidental operations.
- Directional navigation is based on on-screen positions, not tree order.
