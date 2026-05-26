import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import type { Config } from '../config.js';
import { registerAttachmentTools } from './attachments.js';
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
  registerAttachmentTools(server, client);
  return server;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {} as any);
}

const attachmentHal = {
  id: 5,
  fileName: 'screenshot.png',
  fileSize: 12345,
  contentType: 'image/png',
  description: { raw: 'A screenshot' },
  digest: { algorithm: 'md5', hash: 'abc123' },
  createdAt: '2025-01-01T00:00:00Z',
  _links: {
    author: { href: '/api/v3/users/10', title: 'Alice' },
    container: { href: '/api/v3/work_packages/42', title: 'Fix bug' },
    downloadLocation: { href: 'https://op.example.com/attachments/5/screenshot.png' },
    self: { href: '/api/v3/attachments/5' },
  },
};

describe('registerAttachmentTools', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('registers all 4 attachment tools', () => {
    const server = makeServer();
    const tools = (server as any)._registeredTools;
    expect('op_list_attachments' in tools).toBe(true);
    expect('op_get_attachment' in tools).toBe(true);
    expect('op_upload_attachment' in tools).toBe(true);
    expect('op_delete_attachment' in tools).toBe(true);
  });

  test('op_list_attachments lists attachments for a work package', async () => {
    globalThis.fetch = mockFetch(200, {
      total: 1, count: 1,
      _embedded: { elements: [attachmentHal] },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_list_attachments', { workPackageId: 42 });
    const data = JSON.parse(result.content[0].text);
    expect(data.elements).toHaveLength(1);
    expect(data.elements[0].fileName).toBe('screenshot.png');
    expect(data.elements[0].author).toBe('Alice');
    expect(data.elements[0].downloadUrl).toBeDefined();
  });

  test('op_get_attachment fetches attachment metadata', async () => {
    globalThis.fetch = mockFetch(200, attachmentHal);
    const server = makeServer();
    const result = await callTool(server, 'op_get_attachment', { id: 5 });
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(5);
    expect(data.fileName).toBe('screenshot.png');
    expect(data.contentType).toBe('image/png');
  });

  test('op_get_attachment with saveTo downloads content and returns embedLocations', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    const savePath = path.join(tmpDir, 'downloaded.png');

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: get attachment metadata
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify(attachmentHal)),
        });
      }
      if (callCount === 2) {
        // Second call: download content from downloadLocation
        return Promise.resolve({
          ok: true, status: 200,
          arrayBuffer: () => Promise.resolve(new Uint8Array([137, 80, 78, 71]).buffer),
          text: () => Promise.resolve(''),
        });
      }
      if (callCount === 3) {
        // Third call: get work package (container) for description
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({
            id: 42,
            description: { raw: 'Bug steps:\n\n![](attachment:screenshot.png)\n\nSee above.' },
            _links: {},
          })),
        });
      }
      // Fourth call: get activities for comments
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({
          _embedded: {
            elements: [
              {
                id: 101, createdAt: '2025-01-05T00:00:00Z',
                comment: { raw: 'Attached ![](attachment:screenshot.png) for reference' },
              },
              {
                id: 102, createdAt: '2025-01-06T00:00:00Z',
                comment: { raw: 'Looks good to me' },
              },
            ],
          },
        })),
      });
    });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_get_attachment', { id: 5, saveTo: savePath });

    expect(fetchMock).toHaveBeenCalledTimes(4);

    // File should exist on disk
    const savedContent = await fs.readFile(savePath);
    expect(savedContent).toEqual(Buffer.from([137, 80, 78, 71]));

    const data = JSON.parse(result.content[0].text);
    expect(data.savedTo).toBe(savePath);
    expect(data.embedLocations).toBeDefined();
    expect(data.embedLocations).toHaveLength(2);
    expect(data.embedLocations[0].location).toBe('description');
    expect(data.embedLocations[0].context).toContain('screenshot.png');
    expect(data.embedLocations[1].location).toBe('comment');
    expect(data.embedLocations[1].activityId).toBe(101);

    await fs.rm(tmpDir, { recursive: true });
  });

  test('op_get_attachment with saveTo resolves relative downloadLocation href', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    const savePath = path.join(tmpDir, 'downloaded.png');

    const relativeHal = {
      ...attachmentHal,
      _links: {
        ...attachmentHal._links,
        downloadLocation: { href: '/api/v3/attachments/5/content' },
      },
    };

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify(relativeHal)),
        });
      }
      if (callCount === 2) {
        return Promise.resolve({
          ok: true, status: 200,
          arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
          text: () => Promise.resolve(''),
        });
      }
      // container + activities lookups
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({
          _embedded: { elements: [] },
          description: { raw: '' },
          _links: {},
        })),
      });
    });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_get_attachment', { id: 5, saveTo: savePath });

    const downloadCallUrl = fetchMock.mock.calls[1]![0] as string;
    expect(downloadCallUrl).toBe('https://op.example.com/api/v3/attachments/5/content');

    await fs.rm(tmpDir, { recursive: true });
  });

  test('op_get_attachment with saveTo returns error when download URL missing', async () => {
    const noDownloadHal = {
      ...attachmentHal,
      _links: { ...attachmentHal._links, downloadLocation: undefined },
    };
    globalThis.fetch = mockFetch(200, noDownloadHal);
    const server = makeServer();
    const result = await callTool(server, 'op_get_attachment', { id: 5, saveTo: '/tmp/out.png' });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toContain('download');
  });

  test('op_upload_attachment reads file from disk and sends multipart POST', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    const filePath = path.join(tmpDir, 'report.txt');
    await fs.writeFile(filePath, 'hello world');

    const fetchMock = mockFetch(201, attachmentHal);
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_upload_attachment', {
      workPackageId: 42,
      filePath,
      description: 'A report',
    });

    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/work_packages/42/attachments');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);

    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(5);
    expect(data.fileName).toBe('screenshot.png');

    await fs.rm(tmpDir, { recursive: true });
  });

  test('op_upload_attachment uses custom fileName when provided', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    const filePath = path.join(tmpDir, 'temp.dat');
    await fs.writeFile(filePath, 'data');

    const fetchMock = mockFetch(201, { ...attachmentHal, fileName: 'custom.csv' });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    await callTool(server, 'op_upload_attachment', {
      workPackageId: 42,
      filePath,
      fileName: 'custom.csv',
    });

    const formData = fetchMock.mock.calls[0]![1].body as FormData;
    const metadata = JSON.parse(formData.get('metadata') as string);
    expect(metadata.fileName).toBe('custom.csv');

    await fs.rm(tmpDir, { recursive: true });
  });

  test('op_upload_attachment returns error for nonexistent file', async () => {
    const server = makeServer();
    const result = await callTool(server, 'op_upload_attachment', {
      workPackageId: 42,
      filePath: '/nonexistent/file.txt',
    });
    expect(result.isError).toBe(true);
  });

  test('op_upload_attachment with embedIn=comment uploads then posts comment with image reference', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    const filePath = path.join(tmpDir, 'screenshot.png');
    await fs.writeFile(filePath, 'fake-png-data');

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Upload response
        return Promise.resolve({
          ok: true, status: 201,
          text: () => Promise.resolve(JSON.stringify(attachmentHal)),
        });
      }
      // Comment response
      return Promise.resolve({
        ok: true, status: 201,
        text: () => Promise.resolve(JSON.stringify({
          id: 99, createdAt: '2025-01-01T00:00:00Z',
          comment: { raw: 'See screenshot above\n\n![](attachment:screenshot.png)' },
        })),
      });
    });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_upload_attachment', {
      workPackageId: 42,
      filePath,
      embedIn: 'comment',
      embedText: 'See screenshot above',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First call: multipart upload
    expect(fetchMock.mock.calls[0]![1].body).toBeInstanceOf(FormData);

    // Second call: comment with image reference
    const commentBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(commentBody.comment.raw).toContain('![](attachment:screenshot.png)');
    expect(commentBody.comment.raw).toContain('See screenshot above');

    const data = JSON.parse(result.content[0].text);
    expect(data.attachment.id).toBe(5);
    expect(data.comment).toBeDefined();

    await fs.rm(tmpDir, { recursive: true });
  });

  test('op_upload_attachment with embedIn=description uploads then patches description', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    const filePath = path.join(tmpDir, 'diagram.png');
    await fs.writeFile(filePath, 'fake-data');

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true, status: 201,
          text: () => Promise.resolve(JSON.stringify({ ...attachmentHal, fileName: 'diagram.png' })),
        });
      }
      // GET work package (to get lockVersion)
      if (callCount === 2) {
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({
            id: 42, lockVersion: 3,
            description: { raw: 'Existing description' },
            _links: {},
          })),
        });
      }
      // PATCH work package
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({
          id: 42, lockVersion: 4,
          description: { raw: 'Existing description\n\n![](attachment:diagram.png)' },
          _links: {},
        })),
      });
    });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_upload_attachment', {
      workPackageId: 42,
      filePath,
      embedIn: 'description',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Third call: PATCH with updated description
    const patchBody = JSON.parse(fetchMock.mock.calls[2]![1].body);
    expect(patchBody.description.raw).toContain('![](attachment:diagram.png)');
    expect(patchBody.description.raw).toContain('Existing description');
    expect(patchBody.lockVersion).toBe(3);

    const data = JSON.parse(result.content[0].text);
    expect(data.attachment.id).toBe(5);

    await fs.rm(tmpDir, { recursive: true });
  });

  test('op_upload_attachment without embedIn returns just attachment (no extra calls)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    const filePath = path.join(tmpDir, 'doc.pdf');
    await fs.writeFile(filePath, 'pdf-data');

    const fetchMock = mockFetch(201, attachmentHal);
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_upload_attachment', {
      workPackageId: 42,
      filePath,
    });

    // Only one call — the upload
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(5);
    expect(data.comment).toBeUndefined();

    await fs.rm(tmpDir, { recursive: true });
  });

  test('op_delete_attachment sends DELETE', async () => {
    const fetchMock = mockFetch(204, '');
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_delete_attachment', { id: 5 });
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(5);
  });
});
