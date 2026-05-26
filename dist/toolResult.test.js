import { describe, test, expect } from 'vitest';
import { json, text, errorResponse, tryTool } from './toolResult.js';
describe('json', () => {
    test('wraps value as pretty-printed JSON text content', () => {
        const result = json({ id: 1, name: 'test' });
        expect(result).toEqual({
            content: [{ type: 'text', text: '{\n  "id": 1,\n  "name": "test"\n}' }],
        });
    });
});
describe('text', () => {
    test('wraps string as text content', () => {
        const result = text('hello');
        expect(result).toEqual({
            content: [{ type: 'text', text: 'hello' }],
        });
    });
});
describe('errorResponse', () => {
    test('formats Error with message and no status', () => {
        const result = errorResponse(new Error('boom'));
        expect(result.isError).toBe(true);
        const payload = JSON.parse(result.content[0].text);
        expect(payload.error).toBe('boom');
    });
    test('includes status and body from ApiError-shaped objects', () => {
        const err = Object.assign(new Error('not found'), {
            status: 404,
            body: { message: 'Work package not found' },
        });
        const result = errorResponse(err);
        const payload = JSON.parse(result.content[0].text);
        expect(payload.status).toBe(404);
        expect(payload.details).toEqual({ message: 'Work package not found' });
    });
    test('handles non-Error values', () => {
        const result = errorResponse('string error');
        const payload = JSON.parse(result.content[0].text);
        expect(payload.error).toBe('string error');
    });
});
describe('tryTool', () => {
    test('returns successful tool response', async () => {
        const result = await tryTool(async () => json({ ok: true }));
        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.content[0].text)).toEqual({ ok: true });
    });
    test('catches thrown errors and returns error response', async () => {
        const result = await tryTool(async () => {
            throw new Error('failed');
        });
        expect(result.isError).toBe(true);
        const payload = JSON.parse(result.content[0].text);
        expect(payload.error).toBe('failed');
    });
});
//# sourceMappingURL=toolResult.test.js.map