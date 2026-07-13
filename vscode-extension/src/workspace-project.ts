import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { CodeMindAPI, MapSummary, ProjectFiles } from './api-client';

const PROJECT_DIRECTORY = '.codemind';
const PROJECT_FILENAME = 'project.json';
const SEMANTIC_FILENAME = 'semantic.json';
const LAYOUT_FILENAME = 'layout.json';
const SNAPSHOT_METADATA_FILENAME = 'snapshot.json';
const RUNTIME_IGNORE_RULE = '.codemind/runtime/';

interface ProjectBinding {
  schemaVersion: 1;
  mapId: string;
}

export interface WorkspaceProjectionResult {
  folder: vscode.WorkspaceFolder;
  mapId: string;
  revision: number;
}

export interface WorkspaceSnapshotResult extends WorkspaceProjectionResult {
  directoryName: string;
}

interface TransactionFile {
  destination: vscode.Uri;
  payload: Uint8Array;
}

interface TransactionState extends TransactionFile {
  staged: vscode.Uri;
  backup: vscode.Uri;
  backedUp: boolean;
  committed: boolean;
}

export class WorkspaceProjectManager {
  constructor(private readonly api: CodeMindAPI) {}

  async bind(mapId?: string): Promise<WorkspaceProjectionResult | undefined> {
    const folder = await this.selectWorkspaceFolder();
    if (!folder) return undefined;

    const selectedMapId = mapId || (await this.selectMap())?.id;
    if (!selectedMapId) return undefined;

    const existing = await this.readBindingIfExists(folder);
    if (existing && existing.mapId !== selectedMapId) {
      const choice = await vscode.window.showWarningMessage(
        `${folder.name} is already bound to ${existing.mapId}. Replace it with ${selectedMapId}?`,
        { modal: true },
        'Replace Binding',
      );
      if (choice !== 'Replace Binding') return undefined;
    }

    const files = await this.api.getProjectFiles(selectedMapId);
    this.validateProjectFiles(selectedMapId, files);
    const binding: ProjectBinding = { schemaVersion: 1, mapId: selectedMapId };
    await this.writeProjection(folder, binding, files);
    return { folder, mapId: selectedMapId, revision: files.revision };
  }

  async materialize(): Promise<WorkspaceProjectionResult | undefined> {
    const folder = await this.selectWorkspaceFolder();
    if (!folder) return undefined;

    const binding = await this.readBinding(folder);
    const files = await this.api.getProjectFiles(binding.mapId);
    this.validateProjectFiles(binding.mapId, files);
    await this.writeProjection(folder, binding, files);
    return { folder, mapId: binding.mapId, revision: files.revision };
  }

  async createSnapshot(name: string): Promise<WorkspaceSnapshotResult | undefined> {
    const folder = await this.selectWorkspaceFolder();
    if (!folder) return undefined;

    const binding = await this.readBinding(folder);
    const files = await this.api.getProjectFiles(binding.mapId);
    this.validateProjectFiles(binding.mapId, files);

    const createdAt = new Date().toISOString();
    const directoryName = snapshotDirectoryName(createdAt, files.revision, name);
    const directory = vscode.Uri.joinPath(folder.uri, PROJECT_DIRECTORY, 'snapshots', directoryName);
    if (await pathExists(directory)) {
      throw new Error(`Workspace snapshot ${directoryName} already exists.`);
    }
    await vscode.workspace.fs.createDirectory(directory);
    const metadata = {
      schemaVersion: 1,
      mapId: binding.mapId,
      revision: files.revision,
      createdAt,
      name: name.trim(),
    };
    await writeFilesAtomic([
      {
        destination: vscode.Uri.joinPath(directory, SNAPSHOT_METADATA_FILENAME),
        payload: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
      },
      {
        destination: vscode.Uri.joinPath(directory, SEMANTIC_FILENAME),
        payload: Buffer.from(files.semantic, 'utf8'),
      },
      {
        destination: vscode.Uri.joinPath(directory, LAYOUT_FILENAME),
        payload: Buffer.from(files.layout, 'utf8'),
      },
    ]);
    return {
      folder,
      mapId: binding.mapId,
      revision: files.revision,
      directoryName,
    };
  }

  async addRuntimeIgnore(folder?: vscode.WorkspaceFolder): Promise<boolean | undefined> {
    const selectedFolder = folder ?? (await this.selectWorkspaceFolder());
    if (!selectedFolder) return undefined;

    const gitignore = vscode.Uri.joinPath(selectedFolder.uri, '.gitignore');
    let current = '';
    if (await pathExists(gitignore)) {
      current = Buffer.from(await vscode.workspace.fs.readFile(gitignore)).toString('utf8');
    }
    if (protectsRuntime(current)) return false;

    const separator = current.length > 0 && !/\r?\n$/.test(current) ? '\n' : '';
    const heading = current.length === 0 ? '# Code Mind local runtime\n' : '\n# Code Mind local runtime\n';
    const next = `${current}${separator}${heading}${RUNTIME_IGNORE_RULE}\n`;
    await writeFilesAtomic([{ destination: gitignore, payload: Buffer.from(next, 'utf8') }]);
    return true;
  }

  async isRuntimeIgnored(folder: vscode.WorkspaceFolder): Promise<boolean> {
    const gitignore = vscode.Uri.joinPath(folder.uri, '.gitignore');
    if (!(await pathExists(gitignore))) return false;
    const current = Buffer.from(await vscode.workspace.fs.readFile(gitignore)).toString('utf8');
    return protectsRuntime(current);
  }

  private async writeProjection(
    folder: vscode.WorkspaceFolder,
    binding: ProjectBinding,
    files: ProjectFiles,
  ): Promise<void> {
    const directory = vscode.Uri.joinPath(folder.uri, PROJECT_DIRECTORY);
    await vscode.workspace.fs.createDirectory(directory);
    await writeFilesAtomic([
      {
        destination: vscode.Uri.joinPath(directory, PROJECT_FILENAME),
        payload: Buffer.from(`${JSON.stringify(binding, null, 2)}\n`, 'utf8'),
      },
      {
        destination: vscode.Uri.joinPath(directory, SEMANTIC_FILENAME),
        payload: Buffer.from(files.semantic, 'utf8'),
      },
      {
        destination: vscode.Uri.joinPath(directory, LAYOUT_FILENAME),
        payload: Buffer.from(files.layout, 'utf8'),
      },
    ]);
  }

  private async readBinding(folder: vscode.WorkspaceFolder): Promise<ProjectBinding> {
    const uri = vscode.Uri.joinPath(folder.uri, PROJECT_DIRECTORY, PROJECT_FILENAME);
    if (!(await pathExists(uri))) {
      throw new Error(`No ${PROJECT_DIRECTORY}/${PROJECT_FILENAME} exists in ${folder.name}. Bind a mindmap first.`);
    }
    const payload = await vscode.workspace.fs.readFile(uri);
    return parseProjectBinding(Buffer.from(payload).toString('utf8'));
  }

  private async readBindingIfExists(folder: vscode.WorkspaceFolder): Promise<ProjectBinding | undefined> {
    const uri = vscode.Uri.joinPath(folder.uri, PROJECT_DIRECTORY, PROJECT_FILENAME);
    if (!(await pathExists(uri))) return undefined;
    return parseProjectBinding(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
  }

  private async selectMap(): Promise<MapSummary | undefined> {
    const maps = await this.api.listMaps();
    if (maps.length === 0) throw new Error('No mindmaps are available to bind.');
    if (maps.length === 1) return maps[0];
    const selected = await vscode.window.showQuickPick(
      maps.map((map) => ({
        label: map.title || map.id,
        description: map.id,
        map,
      })),
      {
        title: 'Bind Code Mind Mindmap',
        placeHolder: 'Select a mindmap for this workspace',
      },
    );
    return selected?.map;
  }

  private async selectWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) throw new Error('Open a folder or workspace before binding a mindmap.');
    if (folders.length === 1) return folders[0];
    const selected = await vscode.window.showWorkspaceFolderPick({
      placeHolder: 'Select the workspace folder to bind',
    });
    return selected ?? undefined;
  }

  private validateProjectFiles(expectedMapId: string, files: ProjectFiles): void {
    if (files.mapId !== expectedMapId) {
      throw new Error(`Project export returned map ${files.mapId} instead of ${expectedMapId}.`);
    }
    if (!Number.isSafeInteger(files.revision) || files.revision < 1) {
      throw new Error('Project export returned an invalid revision.');
    }
    for (const [name, payload] of [
      [SEMANTIC_FILENAME, files.semantic],
      [LAYOUT_FILENAME, files.layout],
    ] as const) {
      if (typeof payload !== 'string') throw new Error(`Project export did not return ${name}.`);
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object' || parsed.mapId !== expectedMapId) {
          throw new Error('mapId mismatch');
        }
      } catch {
        throw new Error(`Project export returned invalid or mismatched JSON for ${name}.`);
      }
    }
  }
}

export function parseProjectBinding(payload: string): ProjectBinding {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error(`${PROJECT_DIRECTORY}/${PROJECT_FILENAME} is not valid JSON.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${PROJECT_DIRECTORY}/${PROJECT_FILENAME} must be a JSON object.`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== 'mapId' || keys[1] !== 'schemaVersion') {
    throw new Error(`${PROJECT_DIRECTORY}/${PROJECT_FILENAME} may only contain schemaVersion and mapId.`);
  }
  if (record.schemaVersion !== 1) {
    throw new Error(`Unsupported Code Mind project schemaVersion: ${String(record.schemaVersion)}.`);
  }
  if (typeof record.mapId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(record.mapId)) {
    throw new Error('Code Mind project mapId is missing or unsafe.');
  }
  return { schemaVersion: 1, mapId: record.mapId };
}

export function protectsRuntime(gitignore: string): boolean {
  return gitignore.split(/\r?\n/).some((rawLine) => {
    const line = rawLine.trim().replace(/\\/g, '/');
    if (!line || line.startsWith('!') || line.startsWith('#')) return false;
    const normalized = line
      .replace(/^\//, '')
      .replace(/\*\*?$/, '')
      .replace(/\/+$/, '');
    return normalized === '.codemind' || normalized === '.codemind/runtime';
  });
}

export function snapshotDirectoryName(createdAt: string, revision: number, name: string): string {
  const timestamp = createdAt
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${timestamp}-r${revision}${slug ? `-${slug}` : ''}`;
}

async function writeFilesAtomic(files: TransactionFile[]): Promise<void> {
  const nonce = randomUUID();
  const states: TransactionState[] = files.map((file) => ({
    ...file,
    staged: siblingUri(file.destination, `${file.destination.path}.tmp-${nonce}`),
    backup: siblingUri(file.destination, `${file.destination.path}.bak-${nonce}`),
    backedUp: false,
    committed: false,
  }));

  try {
    for (const state of states) await vscode.workspace.fs.writeFile(state.staged, state.payload);
    for (const state of states) {
      if (await pathExists(state.destination)) {
        await vscode.workspace.fs.rename(state.destination, state.backup, {
          overwrite: false,
        });
        state.backedUp = true;
      }
    }
    for (const state of states) {
      await vscode.workspace.fs.rename(state.staged, state.destination, {
        overwrite: false,
      });
      state.committed = true;
    }
  } catch (error) {
    for (const state of states.slice().reverse()) {
      if (state.committed) await deleteIfExists(state.destination);
      if (state.backedUp) {
        try {
          await vscode.workspace.fs.rename(state.backup, state.destination, {
            overwrite: false,
          });
          state.backedUp = false;
        } catch {
          // Preserve the backup for manual recovery if rollback itself fails.
        }
      }
    }
    throw error;
  } finally {
    for (const state of states) {
      await deleteIfExists(state.staged);
      if (!state.backedUp) await deleteIfExists(state.backup);
    }
  }
}

function siblingUri(destination: vscode.Uri, path: string): vscode.Uri {
  return destination.with({ path });
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function deleteIfExists(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, {
      recursive: false,
      useTrash: false,
    });
  } catch {
    // Missing temporary files are already clean.
  }
}
