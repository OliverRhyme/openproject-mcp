import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import { registerProjectTools } from './projects.js';
const config = {
    baseUrl: 'https://op.example.com',
    apiKey: 'test-key',
    defaultPageSize: 25,
    timeoutMs: 5000,
};
function mockFetch(status, body) {
    return vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
    });
}
function makeServer() {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const client = new OpenProjectClient(config);
    registerProjectTools(server, client);
    return server;
}
function getTools(server) {
    return server._registeredTools;
}
async function callTool(server, name, args = {}) {
    const tool = getTools(server)[name];
    if (!tool)
        throw new Error(`Tool ${name} not registered`);
    return tool.handler(args, {});
}
describe('registerProjectTools', () => {
    let originalFetch;
    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    test('registers op_list_projects tool', () => {
        const server = makeServer();
        const tools = getTools(server);
        expect('op_list_projects' in tools).toBe(true);
    });
    test('registers op_get_project tool', () => {
        const server = makeServer();
        const tools = getTools(server);
        expect('op_get_project' in tools).toBe(true);
    });
    test('registers op_create_project tool', () => {
        const server = makeServer();
        const tools = getTools(server);
        expect('op_create_project' in tools).toBe(true);
    });
    test('registers op_update_project tool', () => {
        const server = makeServer();
        const tools = getTools(server);
        expect('op_update_project' in tools).toBe(true);
    });
    test('registers op_delete_project tool', () => {
        const server = makeServer();
        const tools = getTools(server);
        expect('op_delete_project' in tools).toBe(true);
    });
    test('op_list_projects returns summarized projects', async () => {
        globalThis.fetch = mockFetch(200, {
            total: 1,
            count: 1,
            pageSize: 25,
            offset: 1,
            _embedded: {
                elements: [
                    {
                        id: 5,
                        name: 'Alpha',
                        identifier: 'alpha',
                        description: { raw: 'Test' },
                        active: true,
                        public: false,
                        createdAt: '2025-01-01T00:00:00Z',
                        updatedAt: '2025-01-02T00:00:00Z',
                        _links: { parent: {}, status: {} },
                    },
                ],
            },
        });
        const server = makeServer();
        const result = await callTool(server, 'op_list_projects');
        const data = JSON.parse(result.content[0].text);
        expect(data.total).toBe(1);
        expect(data.elements).toHaveLength(1);
        expect(data.elements[0].name).toBe('Alpha');
    });
    test('op_get_project returns single project summary', async () => {
        globalThis.fetch = mockFetch(200, {
            id: 5,
            name: 'Alpha',
            identifier: 'alpha',
            description: { raw: 'A project' },
            active: true,
            public: false,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
            _links: { parent: {}, status: {} },
        });
        const server = makeServer();
        const result = await callTool(server, 'op_get_project', { idOrIdentifier: 'alpha' });
        const data = JSON.parse(result.content[0].text);
        expect(data.id).toBe(5);
        expect(data.name).toBe('Alpha');
    });
    test('op_create_project sends POST with name and wraps description', async () => {
        const fetchMock = mockFetch(201, {
            id: 10,
            name: 'New',
            identifier: 'new',
            active: true,
            public: false,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            _links: { parent: {}, status: {} },
        });
        globalThis.fetch = fetchMock;
        const server = makeServer();
        await callTool(server, 'op_create_project', {
            name: 'New',
            description: 'A new project',
        });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.name).toBe('New');
        expect(body.description).toEqual({ raw: 'A new project' });
    });
    test('op_create_project sets parent _link when parentId provided', async () => {
        const fetchMock = mockFetch(201, {
            id: 11,
            name: 'Child',
            identifier: 'child',
            active: true,
            public: false,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            _links: { parent: { href: '/api/v3/projects/1' }, status: {} },
        });
        globalThis.fetch = fetchMock;
        const server = makeServer();
        await callTool(server, 'op_create_project', { name: 'Child', parentId: 1 });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body._links.parent.href).toBe('/api/v3/projects/1');
    });
    test('op_update_project sends PATCH with only changed fields', async () => {
        const fetchMock = mockFetch(200, {
            id: 5,
            name: 'Renamed',
            identifier: 'alpha',
            active: true,
            public: false,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-03T00:00:00Z',
            _links: { parent: {}, status: {} },
        });
        globalThis.fetch = fetchMock;
        const server = makeServer();
        await callTool(server, 'op_update_project', {
            idOrIdentifier: 'alpha',
            name: 'Renamed',
        });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.name).toBe('Renamed');
        expect(body.description).toBeUndefined();
    });
    test('op_delete_project sends DELETE and returns confirmation', async () => {
        const fetchMock = mockFetch(204, '');
        globalThis.fetch = fetchMock;
        const server = makeServer();
        const result = await callTool(server, 'op_delete_project', { idOrIdentifier: '5' });
        const data = JSON.parse(result.content[0].text);
        expect(data.deleted).toBe('5');
        expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    });
    test('tools return isError on API failure', async () => {
        globalThis.fetch = mockFetch(500, { message: 'Internal error' });
        const server = makeServer();
        const result = await callTool(server, 'op_list_projects');
        expect(result.isError).toBe(true);
    });
});
//# sourceMappingURL=projects.test.js.map