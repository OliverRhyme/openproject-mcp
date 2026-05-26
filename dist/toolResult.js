export function json(value) {
    return {
        content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    };
}
export function text(value) {
    return { content: [{ type: 'text', text: value }] };
}
export function errorResponse(err) {
    const e = err;
    const payload = {
        error: e?.message ?? String(err),
        status: e?.status,
        details: e?.body,
    };
    return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
}
export async function tryTool(fn) {
    try {
        return await fn();
    }
    catch (err) {
        return errorResponse(err);
    }
}
//# sourceMappingURL=toolResult.js.map