import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as http from 'http';
import { URL } from 'url';

const DEFAULT_API_URL = 'http://127.0.0.1:34117';

/**
 * Thin-client backend manager. The extension no longer bundles or builds its
 * own server binary; it connects to an already-running Code Mind backend
 * (desktop app or `codemind serve`). Spawning a backend is only supported
 * when the user explicitly configures `codeMind.backendCommand`.
 */
export class LocalBackendManager implements vscode.Disposable {
  private process: ChildProcessWithoutNullStreams | null = null;
  private output: vscode.OutputChannel;
  private lastLogLines: string[] = [];

  constructor(output: vscode.OutputChannel, _context: vscode.ExtensionContext) {
    this.output = output;
  }

  async ensureStarted(): Promise<void> {
    const apiUrl = this.apiUrl();
    if (await this.isHealthy(apiUrl)) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration('codeMind');
    const autoStart = cfg.get<boolean>('autoStartBackend') ?? true;
    if (!autoStart || !this.backendCommand()) {
      throw new Error(
        `No Code Mind backend is reachable at ${apiUrl}. ` +
          'Start the Code Mind desktop app or run `codemind serve`, ' +
          'or set `codeMind.backendCommand` to let VS Code start one.',
      );
    }

    await this.start();
    await this.waitUntilHealthy(apiUrl, 12_000);
  }

  async start(): Promise<void> {
    if (this.process && !this.process.killed) {
      vscode.window.showInformationMessage('Code Mind backend is already running from VS Code.');
      return;
    }

    const commandLine = this.backendCommand();
    if (!commandLine) {
      throw new Error(
        'No backend command configured. The extension is a thin client: ' +
          'start the Code Mind desktop app or run `codemind serve` yourself, ' +
          'or set `codeMind.backendCommand` (e.g. `C:\\path\\to\\codemind.exe serve`).',
      );
    }

    const cwd = this.backendCwd();
    const dataDir = this.dataDir();
    const apiUrl = new URL(this.apiUrl());
    const port = apiUrl.port || (apiUrl.protocol === 'https:' ? '443' : '80');

    this.output.appendLine(`Starting Code Mind backend: ${commandLine}`);
    this.output.appendLine(`Backend cwd: ${cwd}`);
    this.output.appendLine(`Backend data dir: ${dataDir}`);
    this.recordLog(`Starting Code Mind backend: ${commandLine}`);

    this.process = spawn(commandLine, {
      cwd,
      shell: true,
      env: {
        ...process.env,
        CODE_MIND_PORT: port,
        ...(dataDir ? { CODE_MIND_DATA_DIR: dataDir } : {}),
      },
    });

    this.process.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      this.output.append(text);
      this.recordLog(text);
    });
    this.process.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      this.output.append(text);
      this.recordLog(text);
    });
    this.process.on('error', (err) => {
      this.output.appendLine(`Code Mind backend failed to start: ${err.message}`);
      this.recordLog(`Code Mind backend failed to start: ${err.message}`);
    });
    this.process.on('exit', (code, signal) => {
      this.output.appendLine(`Code Mind backend exited: code=${code ?? ''} signal=${signal ?? ''}`);
      this.recordLog(`Code Mind backend exited: code=${code ?? ''} signal=${signal ?? ''}`);
      this.process = null;
    });
  }

  stop(): void {
    if (!this.process || this.process.killed) {
      vscode.window.showInformationMessage('Code Mind backend is not running from VS Code.');
      return;
    }
    this.process.kill();
    this.process = null;
    vscode.window.showInformationMessage('Code Mind backend stopped.');
  }

  dispose(): void {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }

  showLogs(): void {
    this.output.show(true);
  }

  recentLogs(): string {
    return this.lastLogLines.slice(-12).join('\n').trim();
  }

  private apiUrl(): string {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    return (cfg.get<string>('apiUrl') || DEFAULT_API_URL).replace(/\/+$/, '');
  }

  private backendCommand(): string {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    return (cfg.get<string>('backendCommand') || '').trim();
  }

  private backendCwd(): string {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    const configured = (cfg.get<string>('backendCwd') || '').trim();
    if (configured) {
      return configured;
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }

  private dataDir(): string {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    return (cfg.get<string>('dataDir') || '').trim();
  }

  private recordLog(text: string): void {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    this.lastLogLines.push(...lines);
    if (this.lastLogLines.length > 80) {
      this.lastLogLines = this.lastLogLines.slice(-80);
    }
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

      const req = http.get(
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
      if (await this.isHealthy(apiUrl)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const recentLogs = this.recentLogs();
    throw new Error(
      `Code Mind backend did not become ready in ${timeoutMs / 1000}s.${recentLogs ? ` Recent logs: ${recentLogs}` : ''}`,
    );
  }
}
