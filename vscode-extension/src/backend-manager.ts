import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { URL } from 'url';

const DEFAULT_API_URL = 'http://127.0.0.1:34117';

export type BackendStatus = 'starting' | 'running' | 'stopped' | 'error';

interface LaunchSpec {
  command: string;
  args: string[];
  shell: boolean;
  display: string;
}

export class LocalBackendManager implements vscode.Disposable {
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly output: vscode.OutputChannel;
  private readonly statusBar: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly statusTimer: NodeJS.Timeout;
  private lastLogLines: string[] = [];
  private status: BackendStatus = 'stopped';

  constructor(output: vscode.OutputChannel) {
    this.output = output;
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
    this.statusBar.name = 'Code Mind Backend';
    this.statusBar.show();
    this.updateStatus('stopped');
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('codeMind')) void this.refreshStatus();
      }),
    );
    this.statusTimer = setInterval(() => void this.refreshStatus(), 5_000);
    void this.refreshStatus();
  }

  async ensureStarted(): Promise<void> {
    if (await this.isHealthy(this.apiUrl())) {
      this.updateStatus('running');
      return;
    }
    const autoStart = vscode.workspace.getConfiguration('codeMind').get<boolean>('autoStartBackend') ?? true;
    if (!autoStart) {
      this.updateStatus('stopped');
      throw new Error(`No Code Mind backend is reachable at ${this.apiUrl()}. Run “Code Mind: Start Local Backend”.`);
    }
    await this.start();
  }

  async start(): Promise<void> {
    if (await this.isHealthy(this.apiUrl())) {
      this.updateStatus('running');
      return;
    }
    if (this.process && !this.process.killed) {
      await this.waitUntilHealthy(this.apiUrl(), 12_000);
      this.updateStatus('running');
      return;
    }

    const launch = this.resolveLaunchSpec();
    if (!launch) {
      this.updateStatus('error');
      throw new Error(
        'Code Mind executable was not found. Set codeMind.backendExecutable, add codemind to PATH, or set the legacy codeMind.backendCommand.',
      );
    }

    const cwd = this.expandWorkspaceFolder(this.backendCwd());
    const dataDir = this.expandWorkspaceFolder(this.dataDir());
    const apiUrl = new URL(this.apiUrl());
    const port = apiUrl.port || (apiUrl.protocol === 'https:' ? '443' : '80');
    this.updateStatus('starting');
    this.output.appendLine(`Starting Code Mind backend: ${launch.display}`);
    this.output.appendLine(`Backend cwd: ${cwd}`);
    if (dataDir) this.output.appendLine(`Backend data dir: ${dataDir}`);

    const child = spawn(launch.command, launch.args, {
      cwd,
      shell: launch.shell,
      env: {
        ...process.env,
        CODE_MIND_PORT: port,
        ...(dataDir ? { CODE_MIND_DATA_DIR: dataDir } : {}),
      },
    });
    this.process = child;
    child.stdout.on('data', (chunk) => this.captureOutput(chunk.toString()));
    child.stderr.on('data', (chunk) => this.captureOutput(chunk.toString()));
    child.on('error', (err) => {
      this.captureOutput(`Code Mind backend failed to start: ${err.message}\n`);
      if (this.process === child) this.process = null;
      this.updateStatus('error');
    });
    child.on('exit', (code, signal) => {
      this.captureOutput(`Code Mind backend exited: code=${code ?? ''} signal=${signal ?? ''}\n`);
      if (this.process === child) this.process = null;
      if (this.status !== 'stopped') this.updateStatus(code === 0 ? 'stopped' : 'error');
    });

    try {
      await this.waitUntilHealthy(this.apiUrl(), 12_000);
      this.updateStatus('running');
    } catch (err) {
      if (this.process && !this.process.killed) this.process.kill();
      this.process = null;
      this.updateStatus('error');
      throw err;
    }
  }

  async restart(): Promise<void> {
    if (!this.process || this.process.killed) {
      if (await this.isHealthy(this.apiUrl())) {
        this.updateStatus('running');
        throw new Error(
          'The running Code Mind backend was not started by this VS Code window and cannot be restarted here.',
        );
      }
    }
    await this.stop(false);
    await this.start();
  }

  async stop(showMessage = true): Promise<void> {
    if (!this.process || this.process.killed) {
      this.updateStatus((await this.isHealthy(this.apiUrl())) ? 'running' : 'stopped');
      if (showMessage) vscode.window.showInformationMessage('Code Mind backend is not managed by this VS Code window.');
      return;
    }
    const child = this.process;
    this.updateStatus('stopped');
    const exited = await terminateProcess(child, 3_000);
    if (!exited) {
      this.updateStatus('error');
      throw new Error('The Code Mind backend did not exit within 3 seconds. Open the backend logs before retrying.');
    }
    if (this.process === child) this.process = null;
    if (showMessage) vscode.window.showInformationMessage('Code Mind backend stopped.');
  }

  async refreshStatus(): Promise<void> {
    const healthy = await this.isHealthy(this.apiUrl());
    if (healthy) this.updateStatus('running');
    else if (this.status !== 'starting') this.updateStatus(this.process ? 'error' : 'stopped');
  }

  dispose(): void {
    if (this.process && !this.process.killed) this.process.kill();
    this.statusBar.dispose();
    clearInterval(this.statusTimer);
    this.disposables.forEach((item) => item.dispose());
  }

  showLogs(): void {
    this.output.show(true);
  }
  recentLogs(): string {
    return this.lastLogLines.slice(-12).join('\n').trim();
  }

  private updateStatus(status: BackendStatus): void {
    this.status = status;
    const managed = Boolean(this.process && !this.process.killed);
    const view = {
      starting: ['$(sync~spin) Code Mind', 'Code Mind backend is starting', 'codeMind.showBackendLogs'],
      running: managed
        ? [
            '$(check) Code Mind',
            'Code Mind backend is managed by this window. Click to restart.',
            'codeMind.restartLocalBackend',
          ]
        : [
            '$(plug) Code Mind',
            'Connected to an external Code Mind backend. Click to open the web app.',
            'codeMind.openWebApp',
          ],
      stopped: [
        '$(circle-slash) Code Mind',
        'Code Mind backend is stopped. Click to start.',
        'codeMind.startLocalBackend',
      ],
      error: ['$(error) Code Mind', 'Code Mind backend failed. Click to view logs.', 'codeMind.showBackendLogs'],
    }[status];
    this.statusBar.text = view[0];
    this.statusBar.tooltip = view[1];
    this.statusBar.command = view[2];
  }

  private resolveLaunchSpec(): LaunchSpec | undefined {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    const configured = this.expandWorkspaceFolder((cfg.get<string>('backendExecutable') || '').trim());
    const executable = configured || this.findExecutable();
    if (executable)
      return {
        command: executable,
        args: ['serve'],
        shell: false,
        display: `"${executable}" serve`,
      };
    const legacy = (cfg.get<string>('backendCommand') || '').trim();
    if (legacy)
      return {
        command: this.expandWorkspaceFolder(legacy),
        args: [],
        shell: true,
        display: legacy,
      };
    return undefined;
  }

  private findExecutable(): string | undefined {
    const names = process.platform === 'win32' ? ['codemind.exe', 'CodeMind.exe'] : ['codemind', 'CodeMind'];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const bin = path.join(folder.uri.fsPath, 'build', 'bin');
      if (!fs.existsSync(bin)) continue;
      const candidates = fs
        .readdirSync(bin)
        .filter((name) => /^CodeMind(?:-[\d.]+)?(?:\.exe)?$/i.test(name))
        .map((name) => path.join(bin, name))
        .filter((candidate) => {
          try {
            return fs.statSync(candidate).isFile();
          } catch {
            return false;
          }
        })
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (candidates[0]) return candidates[0];
    }
    const pathFolders = (process.env.PATH || '').split(path.delimiter);
    for (const folder of pathFolders) {
      for (const name of names) {
        const candidate = path.join(folder, name);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return undefined;
  }

  private expandWorkspaceFolder(value: string): string {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    return value.replace(/\$\{workspaceFolder\}/g, folder);
  }

  private apiUrl(): string {
    return (vscode.workspace.getConfiguration('codeMind').get<string>('apiUrl') || DEFAULT_API_URL).replace(/\/+$/, '');
  }
  private backendCwd(): string {
    return (
      vscode.workspace.getConfiguration('codeMind').get<string>('backendCwd') ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd()
    ).trim();
  }
  private dataDir(): string {
    return (vscode.workspace.getConfiguration('codeMind').get<string>('dataDir') || '').trim();
  }
  private captureOutput(text: string): void {
    this.output.append(text);
    this.lastLogLines.push(
      ...text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
    if (this.lastLogLines.length > 80) this.lastLogLines = this.lastLogLines.slice(-80);
  }

  private isHealthy(apiUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      let url: URL;
      try {
        url = new URL(`${apiUrl}/api/health`);
      } catch {
        resolve(false);
        return;
      }
      const client = url.protocol === 'https:' ? https : http;
      const req = client.get(
        {
          hostname: url.hostname,
          port: url.port || '80',
          path: url.pathname,
          timeout: 1500,
        },
        (res) => {
          res.resume();
          resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  private async waitUntilHealthy(apiUrl: string, timeoutMs: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.isHealthy(apiUrl)) return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const logs = this.recentLogs();
    throw new Error(
      `Code Mind backend did not become ready in ${timeoutMs / 1000}s.${logs ? ` Recent logs: ${logs}` : ''}`,
    );
  }
}

function terminateProcess(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
    if (!child.kill()) finish(false);
  });
}
