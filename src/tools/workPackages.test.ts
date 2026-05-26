import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import type { Config } from '../config.js';
import { registerWorkPackageTools } from './workPackages.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

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
  registerWorkPackageTools(server, client);
  return server;
}

function getTools(server: McpServer): Record<string, any> {
  return (server as any)._registeredTools;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = getTools(server)[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {} as any);
}

const wpHal = {
  id: 42,
  subject: 'Fix bug',
  startDate: '2025-01-01',
  dueDate: '2025-01-15',
  percentageDone: 0,
  estimatedTime: 'PT4H',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-02T00:00:00Z',
  lockVersion: 1,
  description: { raw: 'Detailed description' },
  _links: {
    type: { href: '/api/v3/types/1', title: 'Bug' },
    status: { href: '/api/v3/statuses/1', title: 'New' },
    priority: { href: '/api/v3/priorities/2', title: 'High' },
    project: { href: '/api/v3/projects/5', title: 'Alpha' },
    assignee: { href: '/api/v3/users/10', title: 'Alice' },
    author: { href: '/api/v3/users/11', title: 'Bob' },
  },
};

describe('registerWorkPackageTools', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('registers all 7 work package tools', () => {
    const server = makeServer();
    const tools = getTools(server);
    expect('op_list_work_packages' in tools).toBe(true);
    expect('op_get_work_package' in tools).toBe(true);
    expect('op_create_work_package' in tools).toBe(true);
    expect('op_update_work_package' in tools).toBe(true);
    expect('op_delete_work_package' in tools).toBe(true);
    expect('op_list_work_package_activities' in tools).toBe(true);
    expect('op_comment_work_package' in tools).toBe(true);
  });

  test('op_list_work_packages returns summarized list', async () => {
    globalThis.fetch = mockFetch(200, {
      total: 1, count: 1, pageSize: 25, offset: 1,
      _embedded: { elements: [wpHal] },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_work_packages');
    const data = JSON.parse(result.content[0].text);
    expect(data.total).toBe(1);
    expect(data.elements[0].subject).toBe('Fix bug');
    expect(data.elements[0].lockVersion).toBe(1);
  });

  test('op_list_work_packages scopes to project when projectIdOrIdentifier given', async () => {
    const fetchMock = mockFetch(200, { _embedded: { elements: [] } });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_list_work_packages', {
      projectIdOrIdentifier: 'alpha',
    });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/projects/alpha/work_packages');
  });

  test('op_get_work_package returns summary with description', async () => {
    globalThis.fetch = mockFetch(200, wpHal);
    const server = makeServer();
    const result = await callTool(server, 'op_get_work_package', { id: 42 });
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(42);
    expect(data.description).toBe('Detailed description');
    expect(data.lockVersion).toBe(1);
  });

  test('op_create_work_package sends correct HAL links', async () => {
    const fetchMock = mockFetch(201, wpHal);
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_create_work_package', {
      projectId: 5,
      subject: 'New task',
      typeId: 1,
      statusId: 1,
      priorityId: 2,
      assigneeId: 10,
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.subject).toBe('New task');
    expect(body._links.project.href).toBe('/api/v3/projects/5');
    expect(body._links.type.href).toBe('/api/v3/types/1');
    expect(body._links.status.href).toBe('/api/v3/statuses/1');
    expect(body._links.assignee.href).toBe('/api/v3/users/10');
  });

  test('op_create_work_package wraps description in raw object', async () => {
    const fetchMock = mockFetch(201, wpHal);
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_create_work_package', {
      projectId: 5,
      subject: 'Task',
      typeId: 1,
      description: 'Some **markdown**',
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.description).toEqual({ raw: 'Some **markdown**' });
  });

  test('op_update_work_package requires lockVersion and sends PATCH', async () => {
    const fetchMock = mockFetch(200, { ...wpHal, lockVersion: 2 });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_update_work_package', {
      id: 42,
      lockVersion: 1,
      subject: 'Updated',
      statusId: 2,
    });
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(opts.method).toBe('PATCH');
    expect(url).toContain('/work_packages/42');
    const body = JSON.parse(opts.body);
    expect(body.lockVersion).toBe(1);
    expect(body.subject).toBe('Updated');
    expect(body._links.status.href).toBe('/api/v3/statuses/2');
  });

  test('op_update_work_package sets assignee to null for unassign', async () => {
    const fetchMock = mockFetch(200, wpHal);
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_update_work_package', {
      id: 42,
      lockVersion: 1,
      assigneeId: null,
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body._links.assignee.href).toBeNull();
  });

  test('op_delete_work_package sends DELETE', async () => {
    const fetchMock = mockFetch(204, '');
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_delete_work_package', { id: 42 });
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(42);
  });

  test('op_list_work_package_activities returns summarized activities', async () => {
    globalThis.fetch = mockFetch(200, {
      _embedded: {
        elements: [
          {
            id: 1,
            createdAt: '2025-01-01T00:00:00Z',
            comment: { raw: 'A comment' },
            details: [{ raw: 'Status changed' }],
            version: 1,
          },
        ],
      },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_work_package_activities', { id: 42 });
    const data = JSON.parse(result.content[0].text);
    expect(data.elements[0].comment).toBe('A comment');
    expect(data.elements[0].details).toEqual(['Status changed']);
  });

  test('op_comment_work_package sends POST with comment wrapped in raw', async () => {
    const fetchMock = mockFetch(201, {
      id: 99,
      createdAt: '2025-01-01T00:00:00Z',
      comment: { raw: 'New comment' },
    });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_comment_work_package', {
      id: 42,
      comment: 'New comment',
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.comment).toEqual({ raw: 'New comment' });
    const data = JSON.parse(result.content[0].text);
    expect(data.comment).toBe('New comment');
  });

  test('op_comment_work_package with attachFilePath uploads file and embeds in comment', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    const filePath = path.join(tmpDir, 'error.png');
    await fs.writeFile(filePath, 'fake-png');

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Upload attachment
        return Promise.resolve({
          ok: true, status: 201,
          text: () => Promise.resolve(JSON.stringify({
            id: 7, fileName: 'error.png', fileSize: 8,
            _links: { author: {}, downloadLocation: {} },
          })),
        });
      }
      // Post comment
      return Promise.resolve({
        ok: true, status: 201,
        text: () => Promise.resolve(JSON.stringify({
          id: 100, createdAt: '2025-01-01T00:00:00Z',
          comment: { raw: 'Found this error\n\n![](attachment:error.png)' },
        })),
      });
    });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_comment_work_package', {
      id: 42,
      comment: 'Found this error',
      attachFilePath: filePath,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First call: multipart upload
    expect(fetchMock.mock.calls[0]![1].body).toBeInstanceOf(FormData);

    // Second call: comment with image appended
    const commentBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(commentBody.comment.raw).toContain('Found this error');
    expect(commentBody.comment.raw).toContain('![](attachment:error.png)');

    const data = JSON.parse(result.content[0].text);
    expect(data.comment).toContain('attachment:error.png');

    await fs.rm(tmpDir, { recursive: true });
  });

  test('op_list_work_package_activities includes attachmentRefs for comments with embedded images', async () => {
    globalThis.fetch = mockFetch(200, {
      _embedded: {
        elements: [
          {
            id: 1, createdAt: '2025-01-01T00:00:00Z',
            comment: { raw: 'See ![](attachment:bug.png) and ![](attachment:fix.png)' },
            details: [],
            version: 1,
          },
          {
            id: 2, createdAt: '2025-01-02T00:00:00Z',
            comment: { raw: 'Plain comment, no images' },
            details: [],
            version: 2,
          },
        ],
      },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_work_package_activities', { id: 42 });
    const data = JSON.parse(result.content[0].text);

    // First activity has image references
    expect(data.elements[0].attachmentRefs).toEqual(['bug.png', 'fix.png']);

    // Second activity has no references
    expect(data.elements[1].attachmentRefs).toEqual([]);
  });
});
