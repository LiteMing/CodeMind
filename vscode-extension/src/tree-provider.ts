import * as vscode from 'vscode';
import { CodeMindAPI, CodeMindAPIError, CodeMindTimeoutError, CodeMindNetworkError, MapSummary, NodeData } from './api-client';

/**
 * MindMapTreeProvider — VS Code TreeDataProvider that surfaces Code Mind
 * mindmaps and nodes in the activity bar tree view.
 *
 * Maps load on activation. Each map's tree loads lazily, one level at a time
 * on expand: only direct children are fetched per expand.
 *
 * Requirements: 2.1, 2.2
 */

export type CodeMindTreeItem =
  | { kind: 'map'; map: MapSummary }
  | { kind: 'node'; mapId: string; node: NodeData }
  | { kind: 'guide'; id: string; label: string; command: string; icon: string };

export class MindMapTreeItem extends vscode.TreeItem {
  constructor(
    public readonly data: CodeMindTreeItem,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(MindMapTreeItem.labelFor(data), collapsibleState);
    this.id = MindMapTreeItem.idFor(data);
    this.contextValue = data.kind;
    if (data.kind === 'map') {
      this.tooltip = `Map: ${data.map.title}`;
      this.iconPath = new vscode.ThemeIcon('book');
    } else if (data.kind === 'node') {
      this.tooltip = `Node: ${data.node.title}`;
      this.iconPath = new vscode.ThemeIcon(
        (data.node.childrenIds?.length ?? data.node.children?.length ?? 0) > 0
          ? 'symbol-namespace'
          : 'circle-outline',
      );
    } else {
      this.tooltip = data.label;
      this.iconPath = new vscode.ThemeIcon(data.icon);
      this.command = {
        command: data.command,
        title: data.label,
      };
    }
  }

  private static labelFor(d: CodeMindTreeItem): string {
    if (d.kind === 'map') return d.map.title || d.map.id;
    if (d.kind === 'guide') return d.label;
    return d.node.title || d.node.id;
  }

  private static idFor(d: CodeMindTreeItem): string {
    if (d.kind === 'map') return `map:${d.map.id}`;
    if (d.kind === 'guide') return `guide:${d.id}`;
    return `node:${d.mapId}:${d.node.id}`;
  }
}

export class MindMapTreeProvider implements vscode.TreeDataProvider<MindMapTreeItem> {
  private _onDidChange = new vscode.EventEmitter<MindMapTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  // Cache of node trees per map (root tree per map)
  private treeCache: Map<string, NodeData> = new Map();

  constructor(private api: CodeMindAPI) {}

  refresh(): void {
    this.treeCache.clear();
    this._onDidChange.fire(undefined);
  }

  /** Refresh a specific subtree by re-fetching its map's tree. */
  refreshMap(mapId: string): void {
    this.treeCache.delete(mapId);
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: MindMapTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MindMapTreeItem): Promise<MindMapTreeItem[]> {
    try {
      if (!element) {
        const maps = await this.api.listMaps();
        if (maps.length === 0) {
          return this.guideItems();
        }
        return maps.map(
          (m) =>
            new MindMapTreeItem(
              { kind: 'map', map: m },
              vscode.TreeItemCollapsibleState.Collapsed,
            ),
        );
      }

      if (element.data.kind === 'map') {
        const mapId = element.data.map.id;
        const tree = await this.getOrLoadTree(mapId);
        const children = this.extractChildren(tree);
        return children.map((child) => this.toTreeItem(mapId, child));
      }

      if (element.data.kind === 'guide') {
        return [];
      }

      // element.data.kind === 'node'
      const { mapId, node } = element.data;
      // Find this node in the cached tree to get its children
      const tree = await this.getOrLoadTree(mapId);
      const located = this.findNode(tree, node.id);
      const children = this.extractChildren(located ?? node);
      return children.map((child) => this.toTreeItem(mapId, child));
    } catch (err) {
      this.reportError(err);
      return this.guideItems();
    }
  }

  private guideItems(): MindMapTreeItem[] {
    return [
      new MindMapTreeItem(
        { kind: 'guide', id: 'open-web-app', label: 'Open Code Mind Web App', command: 'codeMind.openWebApp', icon: 'browser' },
        vscode.TreeItemCollapsibleState.None,
      ),
      new MindMapTreeItem(
        { kind: 'guide', id: 'configure-url', label: 'Configure API URL', command: 'codeMind.configureApiUrl', icon: 'plug' },
        vscode.TreeItemCollapsibleState.None,
      ),
      new MindMapTreeItem(
        { kind: 'guide', id: 'configure-key', label: 'Configure API Key', command: 'codeMind.configureApiKey', icon: 'key' },
        vscode.TreeItemCollapsibleState.None,
      ),
      new MindMapTreeItem(
        { kind: 'guide', id: 'getting-started', label: 'Getting Started', command: 'codeMind.gettingStarted', icon: 'question' },
        vscode.TreeItemCollapsibleState.None,
      ),
      new MindMapTreeItem(
        { kind: 'guide', id: 'refresh', label: 'Refresh', command: 'codeMind.refresh', icon: 'refresh' },
        vscode.TreeItemCollapsibleState.None,
      ),
    ];
  }

  private async getOrLoadTree(mapId: string): Promise<NodeData> {
    const cached = this.treeCache.get(mapId);
    if (cached) {
      return cached;
    }
    const tree = await this.api.getTree(mapId);
    this.treeCache.set(mapId, tree);
    return tree;
  }

  /** Tree responses may return root as `{root: {...}}` or directly as a node. */
  private extractChildren(node: NodeData): NodeData[] {
    if (Array.isArray(node.children)) {
      return node.children;
    }
    // Some servers may return `{root: {...}}` for tree
    const root = (node as Record<string, unknown>).root;
    if (root && typeof root === 'object') {
      const r = root as NodeData;
      if (Array.isArray(r.children)) return r.children;
    }
    return [];
  }

  private findNode(root: NodeData, targetId: string): NodeData | undefined {
    if (root.id === targetId) return root;
    const children = this.extractChildren(root);
    for (const child of children) {
      const found = this.findNode(child, targetId);
      if (found) return found;
    }
    return undefined;
  }

  private toTreeItem(mapId: string, node: NodeData): MindMapTreeItem {
    const hasChildren = this.extractChildren(node).length > 0;
    return new MindMapTreeItem(
      { kind: 'node', mapId, node },
      hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
  }

  private reportError(err: unknown): void {
    if (err instanceof CodeMindTimeoutError) {
      vscode.window
        .showWarningMessage(`Code Mind request timed out`, 'Retry')
        .then((choice) => {
          if (choice === 'Retry') this.refresh();
        });
      return;
    }
    if (err instanceof CodeMindNetworkError) {
      vscode.window
        .showWarningMessage(`Code Mind unreachable: ${err.message}`, 'Retry')
        .then((choice) => {
          if (choice === 'Retry') this.refresh();
        });
      return;
    }
    if (err instanceof CodeMindAPIError) {
      if (err.status === 401) {
        vscode.window.showErrorMessage('Code Mind: authentication failed. Check your API key.');
      } else {
        vscode.window.showErrorMessage(`Code Mind error: ${err.detail || err.message}`);
      }
      return;
    }
    vscode.window.showErrorMessage(
      `Code Mind: unexpected error — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
