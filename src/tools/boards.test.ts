import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import type { Config } from '../config.js';
import { registerBoardTools } from './boards.js';

const config: Config = {
  baseUrl: 'https://op.example.com',
  apiKey: 'test-key',
  defaultPageSize: 25,
  timeoutMs: 5000,
};

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function makeServer() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const client = new OpenProjectClient(config);
  registerBoardTools(server, client);
  return server;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {} as any);
}

const gridHal = {
  id: 3,
  name: 'Sprint Board',
  rowCount: 1,
  columnCount: 4,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-10T00:00:00Z',
  options: {},
  widgets: [
    {
      identifier: 'work_package_query',
      startRow: 1, endRow: 2, startColumn: 1, endColumn: 2,
      options: { queryId: '100', filters: [] },
    },
  ],
  _links: {
    scope: { href: '/api/v3/projects/5/boards', title: 'Alpha' },
  },
};

// Routes each fetch call to a matching response by url + method.
type Route = {
  match: (url: string, method: string, body: any) => boolean;
  status?: number;
  body: unknown;
};
function routeFetch(routes: Route[]) {
  return vi.fn().mockImplementation((url: string, opts: any) => {
    const method = (opts?.method ?? 'GET') as string;
    const body =
      opts?.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined;
    const route = routes.find((r) => r.match(url, method, body));
    if (!route) throw new Error(`No route for ${method} ${url}`);
    const status = route.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(route.body)),
    });
  });
}

function wpHal(id: number, subject: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    subject,
    lockVersion: 3,
    _links: { status: { href: '/api/v3/statuses/1', title: 'New' } },
    ...extra,
  };
}

function queryHal(opts: {
  id: number;
  name: string;
  cards: any[];
  total?: number;
  extraFilters?: any[];
}) {
  return {
    id: opts.id,
    name: opts.name,
    filters: [
      {
        _type: 'ManualSortQueryFilter',
        _links: { filter: { href: '/api/v3/queries/filters/manualSort' }, values: [] },
      },
      ...(opts.extraFilters ?? []),
    ],
    _embedded: {
      results: {
        total: opts.total ?? opts.cards.length,
        count: opts.cards.length,
        pageSize: 20,
        offset: 1,
        _embedded: { elements: opts.cards },
      },
    },
    _links: {
      updateOrderedWorkPackages: { href: `/api/v3/queries/${opts.id}/order`, method: 'put' },
    },
  };
}

const freeGrid = {
  id: 847,
  name: 'Issues',
  options: { type: 'free', filters: [], highlightingMode: 'priority' },
  widgets: [
    { identifier: 'work_package_query', startColumn: 2, options: { queryId: 101 } },
    { identifier: 'work_package_query', startColumn: 1, options: { queryId: 100 } },
  ],
  _links: { scope: { href: '/projects/asenso-mobile-v3/boards' } },
};

const actionGrid = {
  id: 900,
  name: 'Status board',
  options: { type: 'action', attribute: 'status' },
  widgets: [
    { identifier: 'work_package_query', startColumn: 1, options: { queryId: 200 } },
  ],
};

describe('registerBoardTools', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('registers both board tools', () => {
    const server = makeServer();
    const tools = (server as any)._registeredTools;
    expect('op_list_boards' in tools).toBe(true);
    expect('op_get_board' in tools).toBe(true);
  });

  test('op_list_boards filters grids to board scope for a project', async () => {
    const fetchMock = mockFetch(200, {
      total: 1, count: 1,
      _embedded: { elements: [gridHal] },
    });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_list_boards', { projectIdOrIdentifier: '5' });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/grids');
    expect(url).toContain('filters');
    const data = JSON.parse(result.content[0].text);
    expect(data.elements).toHaveLength(1);
    expect(data.elements[0].name).toBe('Sprint Board');
  });

  test('op_get_board fetches a single grid by id', async () => {
    globalThis.fetch = mockFetch(200, gridHal);
    const server = makeServer();
    const result = await callTool(server, 'op_get_board', { id: 3 });
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(3);
    expect(data.name).toBe('Sprint Board');
    expect(data.widgets).toHaveLength(1);
  });
});
