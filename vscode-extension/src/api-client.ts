import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { randomUUID } from 'crypto';
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
  revision: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectFiles {
  mapId: string;
  revision: number;
  semantic: string;
  layout: string;
}

export type BindingType = 'file' | 'directory' | 'glob' | 'symbol' | 'asset';

export interface NodeBinding {
  id: string;
  type: BindingType;
  path: string;
  symbol?: string;
  glob?: string;
  contentHash?: string;
}

export interface NodeData {
  id: string;
  title: string;
  revision?: number;
  note?: string;
  parentId?: string;
  order?: number;
  bindings?: NodeBinding[];
  childrenIds?: string[];
  children?: NodeData[];
  [k: string]: unknown;
}

export interface CreateNodeRequest {
  parentId: string;
  title: string;
  note?: string;
  order?: number;
  bindings?: NodeBinding[];
}

export interface UpdateNodeRequest {
  parentId?: string;
  order?: number;
  title?: string;
  note?: string;
  bindings?: NodeBinding[];
}

export class CodeMindAPIError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string,
    public expectedRevision?: number,
    public actualRevision?: number,
  ) {
    super(message);
    this.name = 'CodeMindAPIError';
  }
}

export class CodeMindNetworkError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
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
  private revisions: Map<string, number> = new Map();

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
    const maps = Array.isArray(data) ? data : (data?.maps ?? []);
    for (const map of maps) {
      this.rememberRevision(map.id, map.revision);
    }
    return maps;
  }

  async getTree(mapId: string): Promise<NodeData> {
    const tree = await this.request<NodeData>('GET', `/api/maps/${encodeURIComponent(mapId)}/tree`, undefined, true, {
      mapId,
    });
    this.rememberRevision(mapId, tree.revision);
    return tree;
  }

  async getProjectFiles(mapId: string): Promise<ProjectFiles> {
    const files = await this.request<ProjectFiles>(
      'GET',
      `/api/maps/${encodeURIComponent(mapId)}/project-files`,
      undefined,
      false,
      { mapId },
    );
    this.rememberRevision(mapId, files.revision);
    return files;
  }

  async getNode(mapId: string, nodeId: string): Promise<NodeData> {
    const detail = await this.request<{ revision: number; node: NodeData }>(
      'GET',
      `/api/maps/${encodeURIComponent(mapId)}/nodes/${encodeURIComponent(nodeId)}`,
      undefined,
      false,
      { mapId },
    );
    this.rememberRevision(mapId, detail.revision);
    return detail.node;
  }

  async createNode(mapId: string, body: CreateNodeRequest): Promise<NodeData> {
    const expectedRevision = await this.currentRevision(mapId);
    return this.request<NodeData>('POST', `/api/maps/${encodeURIComponent(mapId)}/nodes`, body, false, {
      mapId,
      expectedRevision,
    });
  }

  async updateNode(mapId: string, nodeId: string, body: UpdateNodeRequest): Promise<NodeData> {
    const expectedRevision = await this.currentRevision(mapId);
    return this.request<NodeData>(
      'PATCH',
      `/api/maps/${encodeURIComponent(mapId)}/nodes/${encodeURIComponent(nodeId)}`,
      body,
      false,
      { mapId, expectedRevision },
    );
  }

  async deleteNode(mapId: string, nodeId: string, cascade: boolean = true): Promise<void> {
    const expectedRevision = await this.currentRevision(mapId);
    const query = cascade ? '?cascade=true' : '?cascade=false';
    await this.request<void>(
      'DELETE',
      `/api/maps/${encodeURIComponent(mapId)}/nodes/${encodeURIComponent(nodeId)}${query}`,
      undefined,
      false,
      { mapId, expectedRevision },
    );
  }

  private async currentRevision(mapId: string): Promise<number> {
    const cached = this.revisions.get(mapId);
    if (cached !== undefined) {
      return cached;
    }
    const version = await this.request<{ revision: number }>(
      'GET',
      `/api/maps/${encodeURIComponent(mapId)}/version`,
      undefined,
      false,
      { mapId },
    );
    this.rememberRevision(mapId, version.revision);
    return version.revision;
  }

  private rememberRevision(mapId: string, revision: unknown): void {
    if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0) {
      this.revisions.set(mapId, revision);
    }
  }

  /** Generic JSON-over-HTTP request. */
  private request<T>(
    method: string,
    path: string,
    body: unknown,
    compact: boolean,
    revisionContext?: { mapId: string; expectedRevision?: number },
  ): Promise<T> {
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
      if (revisionContext?.expectedRevision !== undefined) {
        headers['If-Match'] = `"rev-${revisionContext.expectedRevision}"`;
        headers['X-CodeMind-Partition'] = 'development';
        headers['Idempotency-Key'] = `vscode-${randomUUID()}`;
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
            if (revisionContext) {
              const etag = Array.isArray(res.headers.etag) ? res.headers.etag[0] : res.headers.etag;
              const match = typeof etag === 'string' ? /^"rev-(\d+)"$/.exec(etag) : null;
              if (match) {
                this.rememberRevision(revisionContext.mapId, Number(match[1]));
              }
            }

            if (status === 401) {
              reject(new CodeMindUnauthorizedError('authentication required or invalid', responseBody));
              return;
            }

            if (status >= 400) {
              let detail = responseBody;
              let expectedRevision: number | undefined;
              let actualRevision: number | undefined;
              try {
                const parsed = JSON.parse(responseBody);
                detail = parsed?.error || parsed?.message || responseBody;
                expectedRevision = normalizeRevision(parsed?.expectedRevision);
                actualRevision = normalizeRevision(parsed?.actualRevision);
              } catch {
                // keep raw body
              }
              reject(new CodeMindAPIError(status, `HTTP ${status}`, detail, expectedRevision, actualRevision));
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

function normalizeRevision(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
