import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import type { Config } from '../config.js';
import { registerReferenceTools } from './reference.js';

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
  registerReferenceTools(server, client);
  return server;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {} as any);
}

describe('registerReferenceTools', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('registers all 5 reference tools', () => {
    const server = makeServer();
    const tools = (server as any)._registeredTools;
    expect('op_list_types' in tools).toBe(true);
    expect('op_list_statuses' in tools).toBe(true);
    expect('op_list_priorities' in tools).toBe(true);
    expect('op_list_versions' in tools).toBe(true);
    expect('op_api_passthrough' in tools).toBe(true);
  });

  test('op_list_types returns simplified type list', async () => {
    globalThis.fetch = mockFetch(200, {
      _embedded: {
        elements: [
          { id: 1, name: 'Task', position: 1, isDefault: true, isClosed: false, color: '#ccc' },
          { id: 2, name: 'Bug', position: 2, isDefault: false, isClosed: false, color: '#f00' },
        ],
      },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_types');
    const data = JSON.parse(result.content[0].text);
    expect(data.elements).toHaveLength(2);
    expect(data.elements[0].name).toBe('Task');
    expect(data.elements[0].isDefault).toBe(true);
  });

  test('op_list_types scopes to project when given', async () => {
    const fetchMock = mockFetch(200, { _embedded: { elements: [] } });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_list_types', { projectIdOrIdentifier: 'alpha' });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/projects/alpha/types');
  });

  test('op_list_statuses returns all statuses', async () => {
    globalThis.fetch = mockFetch(200, {
      _embedded: {
        elements: [
          { id: 1, name: 'New', position: 1, isDefault: true, isClosed: false },
        ],
      },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_statuses');
    const data = JSON.parse(result.content[0].text);
    expect(data.elements[0].name).toBe('New');
  });

  test('op_list_priorities returns all priorities', async () => {
    globalThis.fetch = mockFetch(200, {
      _embedded: {
        elements: [
          { id: 1, name: 'Low', position: 1, isDefault: false },
          { id: 2, name: 'Normal', position: 2, isDefault: true },
        ],
      },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_priorities');
    const data = JSON.parse(result.content[0].text);
    expect(data.elements).toHaveLength(2);
  });

  test('op_list_versions returns version details', async () => {
    globalThis.fetch = mockFetch(200, {
      _embedded: {
        elements: [
          { id: 1, name: 'v1.0', status: 'open', sharing: 'none', startDate: '2025-01-01', endDate: '2025-06-01' },
        ],
      },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_versions');
    const data = JSON.parse(result.content[0].text);
    expect(data.elements[0].name).toBe('v1.0');
    expect(data.elements[0].status).toBe('open');
  });

  test('op_api_passthrough calls arbitrary GET path', async () => {
    const fetchMock = mockFetch(200, { _type: 'Query', id: 42 });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_api_passthrough', { path: '/queries/42' });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/api/v3/queries/42');
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(42);
  });
});
