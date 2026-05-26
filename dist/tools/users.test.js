import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import { registerUserTools } from './users.js';
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
    registerUserTools(server, client);
    return server;
}
async function callTool(server, name, args = {}) {
    const tool = server._registeredTools[name];
    if (!tool)
        throw new Error(`Tool ${name} not registered`);
    return tool.handler(args, {});
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
    let originalFetch;
    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    test('registers all 3 user tools', () => {
        const server = makeServer();
        const tools = server._registeredTools;
        expect('op_current_user' in tools).toBe(true);
        expect('op_list_users' in tools).toBe(true);
        expect('op_get_user' in tools).toBe(true);
    });
    test('op_current_user calls /users/me and returns summary', async () => {
        const fetchMock = mockFetch(200, userHal);
        globalThis.fetch = fetchMock;
        const server = makeServer();
        const result = await callTool(server, 'op_current_user');
        const url = fetchMock.mock.calls[0][0];
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
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain('/users/10');
        const data = JSON.parse(result.content[0].text);
        expect(data.id).toBe(10);
    });
});
//# sourceMappingURL=users.test.js.map