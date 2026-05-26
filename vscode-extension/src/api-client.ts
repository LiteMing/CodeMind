import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/**
 * CodeMindAPI — HTTP client for the Code Mind REST API.
 * Reads apiUrl and apiKey from VS Code workspace settings.
 *
 * Requirements: 2.6, 2.7, 2.8, 2.9, 2.10
 */

export interface MapSummary {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface NodeData {
  id: string;
  title: string;
  note?: string;
  parentId?: string;
  childrenIds?: string[];
  children?: NodeData[];
  [k: string]: unknown;
}

export interface CreateNodeRequest {
  parentId: string;
  title: string;
  note?: string;
}

export interface UpdateNodeRequest {
  title?: string;
  note?: string;
}

export class CodeMindAPIError extends Error {
  constructor(public status: number, message: string, public detail?: string) {
    super(message);
    this.name = 'CodeMindAPIError';
  }
}

export class CodeMindNetworkError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'CodeMindNetworkError';
  }
}

export class CodeMindTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'CodeMindTimeoutError';
  }
}

export class CodeMindUnauthorizedError extends CodeMindAPIError {
  constructor(message: string, detail?: string) {
    super(401, message, detail);
    this.name = 'CodeMindUnauthorizedError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class CodeMindAPI {
  constructor(private timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  /** Read configuration on every call to track settings.json changes. */
  private getConfig(): { apiUrl: string; apiKey: string } {
    const cfg = vscode.workspace.getConfiguration('codeMind');
    const apiUrl = (cfg.get<string>('apiUrl') || 'http://127.0.0.1:34117').replace(/\/+$/, '');
    const apiKey = cfg.get<string>('apiKey') || '';
    return { apiUrl, apiKey };
  }

  async listMaps(): Promise<MapSummary[]> {
    const data = await this.request<MapSummary[] | { maps: MapSummary[] }>('GET', '/api/maps', undefined, true);
    // Accept either bare array or { maps: [...] } shape
    if (Array.isArray(data)) {
      return data;
    }
    return data?.maps ?? [];
  }

  async getTree(mapId: string): Promise<NodeData> {
    return this.request<NodeData>('GET', `/api/maps/${encodeURIComponent(mapId)}/tree`, undefined, true);
  }

  async getNode(mapId: string, nodeId: string): Promise<NodeData> {
    return this.request<NodeData>(
      'GET',
      `/api/maps/${encodeURIComponent(mapId)}/nodes/${encodeURIComponent(nodeId)}`,
      undefined,
      false,
    );
  }

  async createNode(mapId: string, body: CreateNodeRequest): Promise<NodeData> {
    return this.request<NodeData>(
      'POST',
      `/api/maps/${encodeURIComponent(mapId)}/nodes`,
      body,
      false,
    );
  }

  async updateNode(mapId: string, nodeId: string, body: UpdateNodeRequest): Promise<NodeData> {
    return this.request<NodeData>(
      'PATCH',
      `/api/maps/${encodeURIComponent(mapId)}/nodes/${encodeURIComponent(nodeId)}`,
      body,
      false,
    );
  }

  async deleteNode(mapId: string, nodeId: string, cascade: boolean = true): Promise<void> {
    const query = cascade ? '?cascade=true' : '';
    await this.request<void>(
      'DELETE',
      `/api/maps/${encodeURIComponent(mapId)}/nodes/${encodeURIComponent(nodeId)}${query}`,
      undefined,
      false,
    );
  }

  /** Generic JSON-over-HTTP request. */
  private request<T>(method: string, path: string, body: unknown, compact: boolean): Promise<T> {
    const { apiUrl, apiKey } = this.getConfig();
    let fullUrl = apiUrl + path;
    if (compact) {
      fullUrl += (fullUrl.includes('?') ? '&' : '?') + 'compact=true';
    }

    return new Promise<T>((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(fullUrl);
      } catch (err) {
        reject(new CodeMindNetworkError(`invalid API URL: ${fullUrl}`));
        return;
      }

      const lib = url.protocol === 'https:' ? https : http;

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }

      let payload: string | undefined;
      if (body !== undefined && body !== null) {
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(payload, 'utf8'));
      }

      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const responseBody = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;

            if (status === 401) {
              reject(new CodeMindUnauthorizedError('authentication required or invalid', responseBody));
              return;
            }

            if (status >= 400) {
              let detail = responseBody;
              try {
                const parsed = JSON.parse(responseBody);
                detail = parsed?.error || parsed?.message || responseBody;
              } catch {
                // keep raw body
              }
              reject(new CodeMindAPIError(status, `HTTP ${status}`, detail));
              return;
            }

            if (!responseBody || method === 'DELETE') {
              resolve(undefined as T);
              return;
            }

            try {
              resolve(JSON.parse(responseBody) as T);
            } catch (err) {
              reject(new CodeMindNetworkError('failed to parse JSON response', err as Error));
            }
          });
          res.on('error', (err) => {
            reject(new CodeMindNetworkError(err.message, err));
          });
        },
      );

      req.on('error', (err) => {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') {
          reject(new CodeMindNetworkError(`cannot reach Code Mind at ${apiUrl}`, err));
        } else {
          reject(new CodeMindNetworkError(err.message, err));
        }
      });

      req.setTimeout(this.timeoutMs, () => {
        req.destroy();
        reject(new CodeMindTimeoutError(this.timeoutMs));
      });

      if (payload !== undefined) {
        req.write(payload);
      }
      req.end();
    });
  }
}
