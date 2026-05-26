import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import type { Config } from '../config.js';
import { registerUserTools } from './users.js';

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
  registerUserTools(server, client);
  return server;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {} as any);
}

const userHal = {
  id: 10,
  name: 'Alice Smith',
  login: 'alice',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Smith',
  admin: false,
  status: 'active',
};

describe('registerUserTools', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('registers all 3 user tools', () => {
    const server = makeServer();
    const tools = (server as any)._registeredTools;
    expect('op_current_user' in tools).toBe(true);
    expect('op_list_users' in tools).toBe(true);
    expect('op_get_user' in tools).toBe(true);
  });

  test('op_current_user calls /users/me and returns summary', async () => {
    const fetchMock = mockFetch(200, userHal);
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_current_user');
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/users/me');
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe('Alice Smith');
    expect(data.login).toBe('alice');
  });

  test('op_list_users returns summarized user list', async () => {
    globalThis.fetch = mockFetch(200, {
      total: 1, count: 1, pageSize: 25, offset: 1,
      _embedded: { elements: [userHal] },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_users');
    const data = JSON.parse(result.content[0].text);
    expect(data.elements).toHaveLength(1);
    expect(data.elements[0].email).toBe('alice@example.com');
  });

  test('op_get_user fetches user by id', async () => {
    const fetchMock = mockFetch(200, userHal);
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_get_user', { id: 10 });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/users/10');
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(10);
  });

  test('op_list_users respects fields parameter', async () => {
    globalThis.fetch = mockFetch(200, {
      total: 1, count: 1, pageSize: 25, offset: 1,
      _embedded: { elements: [userHal] },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_users', {
      fields: ['id', 'name', 'email'],
    });
    const data = JSON.parse(result.content[0].text);
    const el = data.elements[0];
    expect(Object.keys(el)).toEqual(['id', 'name', 'email']);
    expect(el.id).toBe(10);
    expect(el.name).toBe('Alice Smith');
    expect(el.email).toBe('alice@example.com');
  });

  test('op_list_users includes hasMore in pagination', async () => {
    globalThis.fetch = mockFetch(200, {
      total: 100, count: 25, pageSize: 25, offset: 1,
      _embedded: { elements: [userHal] },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_users');
    const data = JSON.parse(result.content[0].text);
    expect(data.hasMore).toBe(true);
  });
});
