import * as vscode from 'vscode';
import {
  CodeMindAPI,
  CodeMindAPIError,
  CodeMindNetworkError,
  CodeMindTimeoutError,
  CodeMindUnauthorizedError,
} from './api-client';
import { MindMapTreeItem, MindMapTreeProvider } from './tree-provider';
import { NoteContentProvider, buildNoteUri } from './note-editor';
import { LocalBackendManager } from './backend-manager';
import { WorkspaceProjectManager } from './workspace-project';

/**
 * Command implementations for the Code Mind VS Code extension.
 *
 * Requirements: 2.3, 2.4, 2.5, 2.7, 2.8, 2.9
 */

export function registerCommands(
  context: vscode.ExtensionContext,
  api: CodeMindAPI,
  provider: MindMapTreeProvider,
  noteProvider: NoteContentProvider,
  backendManager: LocalBackendManager,
): void {
  activeBackendManager = backendManager;
  const workspaceProjects = new WorkspaceProjectManager(api);
  context.subscriptions.push(
    vscode.commands.registerCommand('codeMind.refresh', () => provider.refresh()),

    vscode.commands.registerCommand('codeMind.configureApiUrl', async () => {
      const cfg = vscode.workspace.getConfiguration('codeMind');
      const current = cfg.get<string>('apiUrl') || 'http://127.0.0.1:34117';
      const next = await vscode.window.showInputBox({
        title: 'Code Mind API URL',
        prompt: 'Desktop REST API URL',
        value: current,
        validateInput: (value) => {
          if (!/^https?:\/\/.+/.test(value.trim())) {
            return 'URL must start with http:// or https://';
          }
          return null;
        },
      });
      if (!next) return;
      await cfg.update('apiUrl', next.replace(/\/+$/, ''), vscode.ConfigurationTarget.Global);
      provider.refresh();
      vscode.window.showInformationMessage(`Code Mind API URL set to ${next.replace(/\/+$/, '')}`);
    }),

    vscode.commands.registerCommand('codeMind.configureApiKey', async () => {
      const cfg = vscode.workspace.getConfiguration('codeMind');
      const next = await vscode.window.showInputBox({
        title: 'Code Mind API Key',
        prompt: 'Paste the API Key from Code Mind desktop Settings / Platform',
        password: true,
        ignoreFocusOut: true,
      });
      if (next === undefined) return;
      await cfg.update('apiKey', next.trim(), vscode.ConfigurationTarget.Global);
      provider.refresh();
      vscode.window.showInformationMessage(next.trim() ? 'Code Mind API Key saved.' : 'Code Mind API Key cleared.');
    }),

    vscode.commands.registerCommand('codeMind.startLocalBackend', async () => {
      try {
        await backendManager.start();
        provider.refresh();
        vscode.window.showInformationMessage('Code Mind backend started.');
      } catch (err) {
        vscode.window.showErrorMessage(
          `Code Mind: failed to start backend — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand('codeMind.stopLocalBackend', async () => {
      try {
        await backendManager.stop();
        provider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `Code Mind: failed to stop backend - ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand('codeMind.restartLocalBackend', async () => {
      try {
        await backendManager.restart();
        provider.refresh();
        vscode.window.showInformationMessage('Code Mind backend restarted.');
      } catch (err) {
        vscode.window.showErrorMessage(
          `Code Mind: failed to restart backend - ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand('codeMind.showBackendLogs', () => {
      backendManager.showLogs();
    }),

    vscode.commands.registerCommand('codeMind.openWebApp', async () => {
      try {
        await backendManager.ensureStarted();
      } catch (err) {
        vscode.window.showErrorMessage(
          `Code Mind backend is not ready: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      const cfg = vscode.workspace.getConfiguration('codeMind');
      const apiUrl = (cfg.get<string>('apiUrl') || 'http://127.0.0.1:34117').replace(/\/+$/, '');
      const apiKey = cfg.get<string>('apiKey') || '';
      const appUrl = apiKey ? `${apiUrl}?vscodeApiKey=${encodeURIComponent(apiKey)}` : apiUrl;
      provider.refresh();
      try {
        await vscode.commands.executeCommand('simpleBrowser.show', appUrl);
      } catch (err) {
        await vscode.env.openExternal(vscode.Uri.parse(appUrl));
        vscode.window.showWarningMessage(
          `Code Mind could not open VS Code Simple Browser and used the system browser instead: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand('codeMind.gettingStarted', async () => {
      const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: [
          '# Code Mind Getting Started',
          '',
          '## 1. Connect to a running backend',
          '',
          '- The extension is a thin client: start the Code Mind desktop app, or run `codemind serve` for a headless backend.',
          '- `Code Mind: Open Web App` connects to the backend at `codeMind.apiUrl` (default `http://127.0.0.1:34117`).',
          '- Set `codeMind.backendExecutable` to the CodeMind EXE path; `Code Mind: Start/Stop Local Backend` manage that process.',
          '- Leave `codeMind.dataDir` empty to use the shared Code Mind app data directory, or configure it only when you need a custom data directory.',
          '- Run `Code Mind: Configure API URL` or click `Configure API URL` in the side bar.',
          '- Run `Code Mind: Configure API Key` if the desktop app has an API key configured.',
          '',
          '## 2. Use the tree view',
          '',
          '- Run `Code Mind: Open Web App` to open the full Code Mind web UI inside VS Code.',
          '- The tree view remains as a lightweight quick navigation panel.',
          '- Right-click a node in the tree to create, rename, delete, or open notes.',
          '',
          '## 3. Use MCP with AI agents',
          '',
          '- Configure your MCP client command to run the Code Mind binary with the `mcp` subcommand: `codemind.exe mcp`.',
          '- Set `CODEMIND_API_URL=http://127.0.0.1:34117` and optionally `CODEMIND_API_KEY`.',
          '',
          '## 4. Share for web collaboration',
          '',
          '- Create a token through `POST /api/tokens` with `mapId`, `accessLevel`, and `displayName`.',
          '- Connect clients to `ws://127.0.0.1:34118/ws?mapId={mapId}&token={secret}`.',
          '- For internet sharing, expose HTTP `34117` and WebSocket `34118` through HTTPS/WSS reverse proxy.',
        ].join('\\n'),
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    }),

    vscode.commands.registerCommand('codeMind.createNode', async (item?: MindMapTreeItem) => {
      const target = resolveContextNode(item);
      if (!target) {
        vscode.window.showWarningMessage('Code Mind: select a node first to add a child.');
        return;
      }
      const title = await vscode.window.showInputBox({
        prompt: 'Title for the new node',
        validateInput: (v) => (v.trim() === '' ? 'Title is required' : null),
      });
      if (!title) return;

      try {
        await api.createNode(target.mapId, {
          parentId: target.nodeId,
          title: title.trim(),
        });
        provider.refreshMap(target.mapId);
      } catch (err) {
        reportError(err, 'create node');
      }
    }),

    vscode.commands.registerCommand('codeMind.renameNode', async (item?: MindMapTreeItem) => {
      const target = resolveContextNode(item);
      if (!target) {
        vscode.window.showWarningMessage('Code Mind: select a node to rename.');
        return;
      }
      const currentTitle = item?.data.kind === 'node' ? item.data.node.title : target.nodeId;
      const newTitle = await vscode.window.showInputBox({
        prompt: 'New title',
        value: currentTitle,
        validateInput: (v) => (v.trim() === '' ? 'Title is required' : null),
      });
      if (!newTitle || newTitle.trim() === currentTitle) return;

      try {
        await api.updateNode(target.mapId, target.nodeId, {
          title: newTitle.trim(),
        });
        provider.refreshMap(target.mapId);
      } catch (err) {
        reportError(err, 'rename node');
      }
    }),

    vscode.commands.registerCommand('codeMind.deleteNode', async (item?: MindMapTreeItem) => {
      const target = resolveContextNode(item);
      if (!target) {
        vscode.window.showWarningMessage('Code Mind: select a node to delete.');
        return;
      }
      const titleForConfirm = item?.data.kind === 'node' ? item.data.node.title : target.nodeId;
      const confirm = await vscode.window.showWarningMessage(
        `Delete "${titleForConfirm}" and its descendants?`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') return;

      try {
        await api.deleteNode(target.mapId, target.nodeId, true);
        provider.refreshMap(target.mapId);
      } catch (err) {
        reportError(err, 'delete node');
      }
    }),

    vscode.commands.registerCommand('codeMind.openNote', async (item?: MindMapTreeItem) => {
      if (!item || item.data.kind !== 'node') {
        vscode.window.showWarningMessage('Code Mind: select a node to open its note.');
        return;
      }
      const { mapId, node } = item.data;
      const uri = buildNoteUri(mapId, node.id, node.title);
      try {
        noteProvider.invalidate(uri);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        reportError(err, 'open note');
      }
    }),

    vscode.commands.registerCommand('codeMind.bindWorkspaceProject', async (item?: MindMapTreeItem) => {
      try {
        await backendManager.ensureStarted();
        const result = await workspaceProjects.bind(resolveMapId(item));
        if (!result) return;

        if (await workspaceProjects.isRuntimeIgnored(result.folder)) {
          vscode.window.showInformationMessage(
            `Code Mind map ${result.mapId} is bound to ${result.folder.name} at revision ${result.revision}.`,
          );
          return;
        }
        const choice = await vscode.window.showInformationMessage(
          `Code Mind map ${result.mapId} is bound to ${result.folder.name}. Protect local runtime files from Git?`,
          'Add to .gitignore',
        );
        if (choice === 'Add to .gitignore') {
          await workspaceProjects.addRuntimeIgnore(result.folder);
          vscode.window.showInformationMessage('Added .codemind/runtime/ to the workspace .gitignore.');
        }
      } catch (err) {
        reportError(err, 'bind workspace project');
      }
    }),

    vscode.commands.registerCommand('codeMind.materializeWorkspaceProject', async () => {
      try {
        await backendManager.ensureStarted();
        const result = await workspaceProjects.materialize();
        if (!result) return;
        vscode.window.showInformationMessage(
          `Updated .codemind/semantic.json and layout.json from revision ${result.revision}.`,
        );
      } catch (err) {
        reportError(err, 'materialize workspace project');
      }
    }),

    vscode.commands.registerCommand('codeMind.createWorkspaceSnapshot', async () => {
      const name = await vscode.window.showInputBox({
        title: 'Create Code Mind Workspace Snapshot',
        prompt: 'Milestone name stored with canonical semantic and layout files',
        validateInput: (value) => (value.trim() ? null : 'Snapshot name is required'),
      });
      if (!name) return;
      try {
        await backendManager.ensureStarted();
        const result = await workspaceProjects.createSnapshot(name);
        if (!result) return;
        vscode.window.showInformationMessage(
          `Created .codemind/snapshots/${result.directoryName} from revision ${result.revision}.`,
        );
      } catch (err) {
        reportError(err, 'create workspace snapshot');
      }
    }),

    vscode.commands.registerCommand('codeMind.protectWorkspaceRuntime', async () => {
      try {
        const changed = await workspaceProjects.addRuntimeIgnore();
        if (changed === undefined) return;
        vscode.window.showInformationMessage(
          changed
            ? 'Added .codemind/runtime/ to the workspace .gitignore.'
            : '.codemind/runtime/ is already protected by the workspace .gitignore.',
        );
      } catch (err) {
        reportError(err, 'protect workspace runtime');
      }
    }),
  );

  // Save-on-save for codemind:// notes
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((event) => {
      if (event.document.uri.scheme !== 'codemind') return;
      event.waitUntil(
        noteProvider.saveDocument(event.document).catch((err) => {
          reportError(err, 'save note');
        }),
      );
    }),
  );
}

interface NodeContext {
  mapId: string;
  nodeId: string;
}

function resolveContextNode(item?: MindMapTreeItem): NodeContext | undefined {
  if (!item) return undefined;
  if (item.data.kind === 'map') {
    // Treat the map's root: use the map id as both mapId and use empty parent which
    // backend interprets as root. Per the API contract, parentId is required for create
    // so this branch is used by createNode below; if parentId is unknown, the user
    // should pick a node explicitly.
    return { mapId: item.data.map.id, nodeId: 'root' };
  }
  if (item.data.kind === 'guide') {
    return undefined;
  }
  return { mapId: item.data.mapId, nodeId: item.data.node.id };
}

function resolveMapId(item?: MindMapTreeItem): string | undefined {
  if (!item || item.data.kind === 'guide') return undefined;
  return item.data.kind === 'map' ? item.data.map.id : item.data.mapId;
}

function reportError(err: unknown, action: string): void {
  if (err instanceof CodeMindUnauthorizedError) {
    vscode.window.showErrorMessage(`Code Mind: authentication failed (${action}).`);
    return;
  }
  if (err instanceof CodeMindTimeoutError) {
    vscode.window.showWarningMessage(`Code Mind: ${action} timed out.`, 'Retry').then((choice) => {
      if (choice === 'Retry') {
        vscode.commands.executeCommand('codeMind.refresh');
      }
    });
    return;
  }
  if (err instanceof CodeMindNetworkError) {
    vscode.window
      .showWarningMessage(`Code Mind: cannot reach server (${action}). ${err.message}`, 'Start Backend', 'Retry')
      .then((choice) => {
        if (choice === 'Start Backend') {
          void activeBackendManager
            ?.start()
            .then(() => vscode.commands.executeCommand('codeMind.refresh'))
            .catch((startError) =>
              vscode.window.showErrorMessage(
                `Code Mind: failed to start backend - ${startError instanceof Error ? startError.message : String(startError)}`,
              ),
            );
        } else if (choice === 'Retry') {
          vscode.commands.executeCommand('codeMind.refresh');
        }
      });
    return;
  }
  if (err instanceof CodeMindAPIError) {
    if (err.status === 412) {
      vscode.window.showWarningMessage(
        `Code Mind: ${action} conflicted with server revision ${err.actualRevision ?? 'unknown'}. The tree will refresh; review the latest state before retrying.`,
      );
      vscode.commands.executeCommand('codeMind.refresh');
      return;
    }
    vscode.window.showErrorMessage(`Code Mind: failed to ${action} (HTTP ${err.status}): ${err.detail || err.message}`);
    return;
  }
  vscode.window.showErrorMessage(
    `Code Mind: failed to ${action} — ${err instanceof Error ? err.message : String(err)}`,
  );
}

let activeBackendManager: LocalBackendManager | undefined;
