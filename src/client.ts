import type { Config } from './config.js';

export type FilterOperator =
  | '='
  | '!'
  | '~'
  | '!~'
  | '>'
  | '<'
  | '>='
  | '<='
  | 'o'
  | 'c'
  | '*'
  | '!*'
  | 't'
  | 'w'
  | '<>d'
  | '><d';

export interface Filter {
  field: string;
  operator: FilterOperator;
  values: string[] | null;
}

export interface ListParams {
  filters?: Filter[];
  sortBy?: [string, 'asc' | 'desc'][];
  groupBy?: string;
  showSums?: boolean;
  select?: string;
  offset?: number;
  pageSize?: number;
  search?: string;
}

export interface ApiError extends Error {
  status: number;
  body: unknown;
  url: string;
}

export class OpenProjectClient {
  constructor(private readonly config: Config) {}

  get apiKey(): string {
    return this.config.apiKey;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  async get<T = unknown>(path: string, params?: ListParams): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>('GET', url);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', this.buildUrl(path), body);
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', this.buildUrl(path), body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', this.buildUrl(path));
  }

  async postFormData<T = unknown>(path: string, formData: FormData): Promise<T> {
    return this.request<T>('POST', this.buildUrl(path), formData);
  }

  private buildUrl(path: string, params?: ListParams): string {
    const base = path.startsWith('http')
      ? path
      : `${this.config.baseUrl}/api/v3${path.startsWith('/') ? path : `/${path}`}`;

    if (!params) return base;

    const qs = new URLSearchParams();

    if (params.filters && params.filters.length > 0) {
      const serialized = params.filters.map((f) => ({
        [f.field]: { operator: f.operator, values: f.values },
      }));
      qs.set('filters', JSON.stringify(serialized));
    }
    if (params.sortBy && params.sortBy.length > 0) {
      qs.set('sortBy', JSON.stringify(params.sortBy));
    }
    if (params.groupBy) qs.set('groupBy', params.groupBy);
    if (params.showSums !== undefined) qs.set('showSums', String(params.showSums));
    if (params.select) qs.set('select', params.select);
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    if (params.pageSize !== undefined) {
      qs.set('pageSize', String(params.pageSize));
    } else {
      qs.set('pageSize', String(this.config.defaultPageSize));
    }
    if (params.search) qs.set('searchString', params.search);

    const query = qs.toString();
    return query ? `${base}?${query}` : base;
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`timeout after ${this.config.timeoutMs}ms`)),
      this.config.timeoutMs,
    );

    const auth = Buffer.from(`apikey:${this.config.apiKey}`).toString('base64');
    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/hal+json',
      'User-Agent': 'openproject-mcp/0.1.0',
    };
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : isFormData ? body as FormData : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;

      if (!res.ok) {
        const err = new Error(
          `OpenProject ${method} ${res.status}: ${describeError(parsed) ?? text.slice(0, 200)}`,
        ) as ApiError;
        err.status = res.status;
        err.body = parsed ?? text;
        err.url = url;
        throw err;
      }

      return (parsed as T) ?? (undefined as T);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeError(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const msg = typeof b.message === 'string' ? b.message : undefined;
  const id = typeof b.errorIdentifier === 'string' ? b.errorIdentifier : undefined;
  if (msg && id) return `${id}: ${msg}`;
  return msg ?? id;
}
