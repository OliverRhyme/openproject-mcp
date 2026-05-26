import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenProjectClient } from './client.js';
import type { Config } from './config.js';

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

describe('OpenProjectClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('get', () => {
    test('sends GET request with Basic auth to /api/v3 path', async () => {
      const fetchMock = mockFetch(200, { id: 1 });
      globalThis.fetch = fetchMock;
      const client = new OpenProjectClient(config);

      const result = await client.get('/projects/1');

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://op.example.com/api/v3/projects/1');
      expect(opts.method).toBe('GET');
      expect(opts.headers.Authorization).toMatch(/^Basic /);
      expect(opts.headers.Accept).toBe('application/hal+json');
      expect(result).toEqual({ id: 1 });
    });

    test('serializes filters as JSON query param', async () => {
      const fetchMock = mockFetch(200, { _embedded: { elements: [] } });
      globalThis.fetch = fetchMock;
      const client = new OpenProjectClient(config);

      await client.get('/work_packages', {
        filters: [{ field: 'status_id', operator: '=', values: ['1'] }],
      });

      const url = fetchMock.mock.calls[0]![0] as string;
      const parsed = new URL(url);
      const filters = JSON.parse(parsed.searchParams.get('filters')!);
      expect(filters).toEqual([
        { status_id: { operator: '=', values: ['1'] } },
      ]);
    });

    test('serializes sortBy as JSON query param', async () => {
      const fetchMock = mockFetch(200, {});
      globalThis.fetch = fetchMock;
      const client = new OpenProjectClient(config);

      await client.get('/work_packages', {
        sortBy: [['updatedAt', 'desc']],
      });

      const url = fetchMock.mock.calls[0]![0] as string;
      const parsed = new URL(url);
      const sortBy = JSON.parse(parsed.searchParams.get('sortBy')!);
      expect(sortBy).toEqual([['updatedAt', 'desc']]);
    });

    test('applies default page size when not specified', async () => {
      const fetchMock = mockFetch(200, {});
      globalThis.fetch = fetchMock;
      const client = new OpenProjectClient(config);

      await client.get('/projects', {});

      const url = fetchMock.mock.calls[0]![0] as string;
      const parsed = new URL(url);
      expect(parsed.searchParams.get('pageSize')).toBe('25');
    });

    test('uses explicit pageSize over default', async () => {
      const fetchMock = mockFetch(200, {});
      globalThis.fetch = fetchMock;
      const client = new OpenProjectClient(config);

      await client.get('/projects', { pageSize: 10 });

      const url = fetchMock.mock.calls[0]![0] as string;
      const parsed = new URL(url);
      expect(parsed.searchParams.get('pageSize')).toBe('10');
    });
  });

  describe('post', () => {
    test('sends POST with JSON body', async () => {
      const fetchMock = mockFetch(201, { id: 99 });
      globalThis.fetch = fetchMock;
      const client = new OpenProjectClient(config);

      const result = await client.post('/work_packages', { subject: 'Test' });

      const [, opts] = fetchMock.mock.calls[0]!;
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(opts.body)).toEqual({ subject: 'Test' });
      expect(result).toEqual({ id: 99 });
    });
  });

  describe('patch', () => {
    test('sends PATCH with JSON body', async () => {
      const fetchMock = mockFetch(200, { id: 1, lockVersion: 2 });
      globalThis.fetch = fetchMock;
      const client = new OpenProjectClient(config);

      await client.patch('/work_packages/1', { lockVersion: 1, subject: 'Updated' });

      const [, opts] = fetchMock.mock.calls[0]!;
      expect(opts.method).toBe('PATCH');
    });
  });

  describe('delete', () => {
    test('sends DELETE request', async () => {
      const fetchMock = mockFetch(204, '');
      globalThis.fetch = fetchMock;
      const client = new OpenProjectClient(config);

      await client.delete('/work_packages/1');

      const [, opts] = fetchMock.mock.calls[0]!;
      expect(opts.method).toBe('DELETE');
    });
  });

  describe('postFormData', () => {
    test('sends POST with FormData body and no Content-Type header', async () => {
      const fetchMock = mockFetch(201, { id: 7 });
      globalThis.fetch = fetchMock;
      const client = new OpenProjectClient(config);

      const formData = new FormData();
      formData.append('metadata', JSON.stringify({ fileName: 'test.txt' }));
      formData.append('file', new Blob(['hello']), 'test.txt');

      const result = await client.postFormData('/work_packages/42/attachments', formData);

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://op.example.com/api/v3/work_packages/42/attachments');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBeUndefined();
      expect(opts.body).toBe(formData);
      expect(result).toEqual({ id: 7 });
    });
  });

  describe('error handling', () => {
    test('throws ApiError on non-2xx with message and status', async () => {
      const fetchMock = mockFetch(404, {
        errorIdentifier: 'urn:openproject-org:api:v3:errors:NotFound',
        message: 'The requested resource could not be found.',
      });
      globalThis.fetch = fetchMock;
      const client = new OpenProjectClient(config);

      const err = await client.get('/work_packages/999').catch((e) => e) as any;
      expect(err.message).toContain('404');
      expect(err.message).toContain('NotFound');
      expect(err.status).toBe(404);
      expect(err.body).toBeDefined();
    });
  });
});
