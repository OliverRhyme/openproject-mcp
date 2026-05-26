import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
describe('index', () => {
    let originalEnv;
    beforeEach(() => {
        originalEnv = process.env;
        process.env = {
            ...originalEnv,
            OPENPROJECT_BASE_URL: 'https://op.example.com',
            OPENPROJECT_API_KEY: 'test-key',
        };
    });
    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });
    test('exports main function that creates server with all tool modules', async () => {
        const mod = await import('./index.js');
        expect(mod.createServer).toBeDefined();
        const server = mod.createServer();
        const tools = server._registeredTools;
        expect('op_list_projects' in tools).toBe(true);
        expect('op_list_work_packages' in tools).toBe(true);
        expect('op_current_user' in tools).toBe(true);
        expect('op_list_types' in tools).toBe(true);
        expect('op_list_relations' in tools).toBe(true);
        expect('op_list_attachments' in tools).toBe(true);
        expect('op_list_notifications' in tools).toBe(true);
        expect('op_list_watchers' in tools).toBe(true);
        expect('op_list_boards' in tools).toBe(true);
    });
});
//# sourceMappingURL=index.test.js.map