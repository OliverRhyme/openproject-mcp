import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import type { Config } from '../config.js';
import { registerNotificationTools } from './notifications.js';

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
  registerNotificationTools(server, client);
  return server;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {} as any);
}

const notificationHal = {
  id: 77,
  reason: 'assigned',
  readIAN: false,
  createdAt: '2025-01-15T10:00:00Z',
  updatedAt: '2025-01-15T10:00:00Z',
  _links: {
    project: { href: '/api/v3/projects/5', title: 'Alpha' },
    resource: { href: '/api/v3/work_packages/42', title: 'Fix bug' },
    actor: { href: '/api/v3/users/10', title: 'Alice' },
  },
};

describe('registerNotificationTools', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('registers all 4 notification tools', () => {
    const server = makeServer();
    const tools = (server as any)._registeredTools;
    expect('op_list_notifications' in tools).toBe(true);
    expect('op_get_notification' in tools).toBe(true);
    expect('op_mark_notification_read' in tools).toBe(true);
    expect('op_mark_all_notifications_read' in tools).toBe(true);
  });

  test('op_list_notifications returns summarized list', async () => {
    globalThis.fetch = mockFetch(200, {
      total: 1, count: 1,
      _embedded: { elements: [notificationHal] },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_notifications');
    const data = JSON.parse(result.content[0].text);
    expect(data.elements).toHaveLength(1);
    expect(data.elements[0].reason).toBe('assigned');
    expect(data.elements[0].read).toBe(false);
    expect(data.elements[0].project).toBe('Alpha');
    expect(data.elements[0].actor).toBe('Alice');
  });

  test('op_list_notifications supports filters', async () => {
    const fetchMock = mockFetch(200, { _embedded: { elements: [] } });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_list_notifications', {
      filters: [{ field: 'readIAN', operator: '=', values: ['f'] }],
    });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('filters');
  });

  test('op_get_notification fetches a single notification', async () => {
    globalThis.fetch = mockFetch(200, notificationHal);
    const server = makeServer();
    const result = await callTool(server, 'op_get_notification', { id: 77 });
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(77);
    expect(data.reason).toBe('assigned');
  });

  test('op_mark_notification_read sends POST to read_ian', async () => {
    const fetchMock = mockFetch(200, { ...notificationHal, readIAN: true });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_mark_notification_read', { id: 77 });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/notifications/77/read_ian');
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
  });

  test('op_mark_all_notifications_read sends POST to bulk endpoint', async () => {
    const fetchMock = mockFetch(200, {});
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_mark_all_notifications_read');
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/notifications/read_ian');
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
  });

  test('op_list_notifications respects fields parameter', async () => {
    globalThis.fetch = mockFetch(200, {
      total: 1, count: 1, pageSize: 25, offset: 1,
      _embedded: { elements: [notificationHal] },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_notifications', {
      fields: ['id', 'reason'],
    });
    const data = JSON.parse(result.content[0].text);
    const el = data.elements[0];
    expect(Object.keys(el)).toEqual(['id', 'reason']);
    expect(el.id).toBe(77);
    expect(el.reason).toBe('assigned');
  });
});
