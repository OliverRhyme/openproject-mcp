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
