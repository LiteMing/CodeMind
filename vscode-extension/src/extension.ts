import * as vscode from 'vscode';
import { CodeMindAPI } from './api-client';
import { MindMapTreeProvider } from './tree-provider';
import { NoteContentProvider, CODEMIND_NOTE_SCHEME } from './note-editor';
import { registerCommands } from './commands';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Code Mind');
  outputChannel.appendLine('Code Mind extension activated');

  const api = new CodeMindAPI();
  const treeProvider = new MindMapTreeProvider(api);
  const noteProvider = new NoteContentProvider(api);

  const treeView = vscode.window.createTreeView('codeMindExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    treeView,
    vscode.workspace.registerTextDocumentContentProvider(CODEMIND_NOTE_SCHEME, noteProvider),
  );

  registerCommands(context, api, treeProvider, noteProvider);

  // Re-fetch tree when configuration changes (apiUrl/apiKey may have changed).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeMind')) {
        treeProvider.refresh();
      }
    }),
  );

  context.subscriptions.push(outputChannel);
}

export function deactivate(): void {
  if (outputChannel) {
    outputChannel.appendLine('Code Mind extension deactivated');
    outputChannel.dispose();
  }
}
