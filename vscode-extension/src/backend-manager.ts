import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import { URL } from 'url';

const DEFAULT_API_URL = 'http://127.0.0.1:34117';

export class LocalBackendManager implements vscode.Disposable {
  private process: ChildProcessWithoutNullStreams | null = null;
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  async ensureStarted(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    const autoStart = cfg.get<boolean>('autoStartBackend') ?? true;
    if (!autoStart) {
      return;
    }

    const apiUrl = this.apiUrl();
    if (await this.isHealthy(apiUrl)) {
      return;
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
    const cwd = this.backendCwd();
    const dataDir = this.dataDir(cwd);
    const [command, ...args] = this.splitCommand(commandLine);
    const apiUrl = new URL(this.apiUrl());
    const port = apiUrl.port || (apiUrl.protocol === 'https:' ? '443' : '80');

    this.output.appendLine(`Starting Code Mind backend: ${commandLine}`);
    this.output.appendLine(`Backend cwd: ${cwd}`);
    this.output.appendLine(`Backend data dir: ${dataDir}`);

    this.process = spawn(command, args, {
      cwd,
      shell: true,
      env: {
        ...process.env,
        CODE_MIND_PORT: port,
        CODE_MIND_DATA_DIR: dataDir,
      },
    });

    this.process.stdout.on('data', (chunk) => this.output.append(chunk.toString()));
    this.process.stderr.on('data', (chunk) => this.output.append(chunk.toString()));
    this.process.on('exit', (code, signal) => {
      this.output.appendLine(`Code Mind backend exited: code=${code ?? ''} signal=${signal ?? ''}`);
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

  private apiUrl(): string {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    return (cfg.get<string>('apiUrl') || DEFAULT_API_URL).replace(/\/+$/, '');
  }

  private backendCommand(): string {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    return (cfg.get<string>('backendCommand') || 'go run ./cmd/server').trim();
  }

  private backendCwd(): string {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    const configured = (cfg.get<string>('backendCwd') || '').trim();
    if (configured) {
      return configured;
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  }

  private dataDir(cwd: string): string {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    const configured = (cfg.get<string>('dataDir') || '').trim();
    if (configured) {
      return configured;
    }
    return path.join(cwd, 'data');
  }

  private splitCommand(commandLine: string): string[] {
    const matches = commandLine.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    return matches.map((part) => part.replace(/^"|"$/g, ''));
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
    throw new Error('Code Mind backend did not become ready in time. Check the Code Mind output panel.');
  }
}
