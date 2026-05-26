import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config.js';
describe('loadConfig', () => {
    const origEnv = process.env;
    beforeEach(() => {
        process.env = { ...origEnv };
    });
    afterEach(() => {
        process.env = origEnv;
    });
    test('throws when OPENPROJECT_BASE_URL is missing', () => {
        delete process.env.OPENPROJECT_BASE_URL;
        process.env.OPENPROJECT_API_KEY = 'key';
        expect(() => loadConfig()).toThrow('OPENPROJECT_BASE_URL');
    });
    test('throws when OPENPROJECT_API_KEY is missing', () => {
        process.env.OPENPROJECT_BASE_URL = 'https://op.example.com';
        delete process.env.OPENPROJECT_API_KEY;
        expect(() => loadConfig()).toThrow('OPENPROJECT_API_KEY');
    });
    test('throws when OPENPROJECT_BASE_URL is not a valid URL', () => {
        process.env.OPENPROJECT_BASE_URL = 'not-a-url';
        process.env.OPENPROJECT_API_KEY = 'key';
        expect(() => loadConfig()).toThrow('not a valid URL');
    });
    test('returns config with trailing slash stripped from baseUrl', () => {
        process.env.OPENPROJECT_BASE_URL = 'https://op.example.com///';
        process.env.OPENPROJECT_API_KEY = 'my-key';
        const config = loadConfig();
        expect(config.baseUrl).toBe('https://op.example.com');
        expect(config.apiKey).toBe('my-key');
    });
    test('uses default pageSize of 25 when not set', () => {
        process.env.OPENPROJECT_BASE_URL = 'https://op.example.com';
        process.env.OPENPROJECT_API_KEY = 'key';
        const config = loadConfig();
        expect(config.defaultPageSize).toBe(25);
    });
    test('uses default timeoutMs of 30000 when not set', () => {
        process.env.OPENPROJECT_BASE_URL = 'https://op.example.com';
        process.env.OPENPROJECT_API_KEY = 'key';
        const config = loadConfig();
        expect(config.timeoutMs).toBe(30_000);
    });
    test('parses OPENPROJECT_PAGE_SIZE from env', () => {
        process.env.OPENPROJECT_BASE_URL = 'https://op.example.com';
        process.env.OPENPROJECT_API_KEY = 'key';
        process.env.OPENPROJECT_PAGE_SIZE = '50';
        const config = loadConfig();
        expect(config.defaultPageSize).toBe(50);
    });
    test('falls back to default for invalid page size', () => {
        process.env.OPENPROJECT_BASE_URL = 'https://op.example.com';
        process.env.OPENPROJECT_API_KEY = 'key';
        process.env.OPENPROJECT_PAGE_SIZE = 'abc';
        const config = loadConfig();
        expect(config.defaultPageSize).toBe(25);
    });
    test('trims whitespace from baseUrl and apiKey', () => {
        process.env.OPENPROJECT_BASE_URL = '  https://op.example.com  ';
        process.env.OPENPROJECT_API_KEY = '  my-key  ';
        const config = loadConfig();
        expect(config.baseUrl).toBe('https://op.example.com');
        expect(config.apiKey).toBe('my-key');
    });
});
//# sourceMappingURL=config.test.js.map