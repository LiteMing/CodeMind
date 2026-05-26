import * as vscode from 'vscode';
import { CodeMindAPI } from './api-client';

/**
 * NoteContentProvider — TextDocumentContentProvider that loads a node's note
 * content into a virtual `codemind:` URI. The user edits the note in a normal
 * editor; saving issues a PATCH update via the API client.
 *
 * URI format: codemind://note/{mapId}/{nodeId}?title={encoded_title}
 *
 * Requirements: 2.5, 2.7, 2.8, 2.9
 */

export const CODEMIND_NOTE_SCHEME = 'codemind';

interface NoteRef {
  mapId: string;
  nodeId: string;
  title: string;
}

function parseNoteUri(uri: vscode.Uri): NoteRef | undefined {
  if (uri.scheme !== CODEMIND_NOTE_SCHEME) return undefined;
  if (uri.authority !== 'note') return undefined;
  // path: /{mapId}/{nodeId}
  const parts = uri.path.split('/').filter(Boolean);
  if (parts.length < 2) return undefined;
  const [mapId, nodeId] = parts;
  const params = new URLSearchParams(uri.query);
  const title = params.get('title') ?? nodeId;
  return { mapId, nodeId, title };
}

export function buildNoteUri(mapId: string, nodeId: string, title: string): vscode.Uri {
  const safeTitle = encodeURIComponent(title);
  return vscode.Uri.parse(
    `${CODEMIND_NOTE_SCHEME}://note/${encodeURIComponent(mapId)}/${encodeURIComponent(nodeId)}?title=${safeTitle}`,
  );
}

export class NoteContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  // Stash latest content per URI so VS Code can read it back without another
  // round trip after the user begins editing.
  private contents: Map<string, string> = new Map();

  constructor(private api: CodeMindAPI) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const cached = this.contents.get(uri.toString());
    if (cached !== undefined) {
      return cached;
    }
    const ref = parseNoteUri(uri);
    if (!ref) {
      return '';
    }
    const node = await this.api.getNode(ref.mapId, ref.nodeId);
    const content = node.note ?? '';
    this.contents.set(uri.toString(), content);
    return content;
  }

  /** Save the document's current text back to the server via PATCH. */
  async saveDocument(doc: vscode.TextDocument): Promise<void> {
    const ref = parseNoteUri(doc.uri);
    if (!ref) return;
    const content = doc.getText();
    await this.api.updateNode(ref.mapId, ref.nodeId, { note: content });
    this.contents.set(doc.uri.toString(), content);
  }

  /** Force a reload of the note from the server. */
  invalidate(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
    this._onDidChange.fire(uri);
  }
}
