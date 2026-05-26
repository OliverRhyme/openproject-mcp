import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import type { Config } from '../config.js';
import { registerRelationTools } from './relations.js';

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
  registerRelationTools(server, client);
  return server;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {} as any);
}

const relationHal = {
  id: 1,
  name: 'blocks',
  type: 'blocks',
  reverseType: 'blocked',
  description: 'Blocks deployment',
  _links: {
    from: { href: '/api/v3/work_packages/10', title: 'WP 10' },
    to: { href: '/api/v3/work_packages/20', title: 'WP 20' },
  },
};

describe('registerRelationTools', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('registers all 4 relation tools', () => {
    const server = makeServer();
    const tools = (server as any)._registeredTools;
    expect('op_list_relations' in tools).toBe(true);
    expect('op_get_relation' in tools).toBe(true);
    expect('op_create_relation' in tools).toBe(true);
    expect('op_delete_relation' in tools).toBe(true);
  });

  test('op_list_relations fetches relations for a work package', async () => {
    const fetchMock = mockFetch(200, {
      total: 1, count: 1,
      _embedded: { elements: [relationHal] },
    });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_list_relations', { workPackageId: 10 });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/work_packages/10/relations');
    const data = JSON.parse(result.content[0].text);
    expect(data.elements[0].type).toBe('blocks');
    expect(data.elements[0].from.id).toBe(10);
    expect(data.elements[0].to.id).toBe(20);
  });

  test('op_get_relation fetches a single relation by id', async () => {
    globalThis.fetch = mockFetch(200, relationHal);
    const server = makeServer();
    const result = await callTool(server, 'op_get_relation', { id: 1 });
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(1);
    expect(data.type).toBe('blocks');
  });

  test('op_create_relation sends POST with correct link structure', async () => {
    const fetchMock = mockFetch(201, relationHal);
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_create_relation', {
      fromId: 10,
      toId: 20,
      type: 'blocks',
      description: 'Blocks deployment',
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body._links.from.href).toBe('/api/v3/work_packages/10');
    expect(body._links.to.href).toBe('/api/v3/work_packages/20');
    expect(body.type).toBe('blocks');
    expect(body.description).toBe('Blocks deployment');
  });

  test('op_delete_relation sends DELETE and returns confirmation', async () => {
    const fetchMock = mockFetch(204, '');
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_delete_relation', { id: 1 });
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(1);
  });
});
