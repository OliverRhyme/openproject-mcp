import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import type { Config } from '../config.js';
import { registerWatcherTools } from './watchers.js';

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
  registerWatcherTools(server, client);
  return server;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {} as any);
}

describe('registerWatcherTools', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('registers all 3 watcher tools', () => {
    const server = makeServer();
    const tools = (server as any)._registeredTools;
    expect('op_list_watchers' in tools).toBe(true);
    expect('op_add_watcher' in tools).toBe(true);
    expect('op_remove_watcher' in tools).toBe(true);
  });

  test('op_list_watchers returns user summaries for a work package', async () => {
    globalThis.fetch = mockFetch(200, {
      total: 1, count: 1,
      _embedded: {
        elements: [
          {
            id: 10, name: 'Alice Smith', login: 'alice',
            email: 'alice@example.com', firstName: 'Alice',
            lastName: 'Smith', admin: false, status: 'active',
          },
        ],
      },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_watchers', { workPackageId: 42 });
    const data = JSON.parse(result.content[0].text);
    expect(data.elements).toHaveLength(1);
    expect(data.elements[0].name).toBe('Alice Smith');
  });

  test('op_add_watcher sends POST with user link', async () => {
    const fetchMock = mockFetch(200, {
      _embedded: { elements: [] },
    });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_add_watcher', { workPackageId: 42, userId: 10 });
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/work_packages/42/watchers');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.user.href).toBe('/api/v3/users/10');
  });

  test('op_remove_watcher sends DELETE with user id in path', async () => {
    const fetchMock = mockFetch(204, '');
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_remove_watcher', { workPackageId: 42, userId: 10 });
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/work_packages/42/watchers/10');
    expect(opts.method).toBe('DELETE');
    const data = JSON.parse(result.content[0].text);
    expect(data.removed).toBe(10);
  });
});
