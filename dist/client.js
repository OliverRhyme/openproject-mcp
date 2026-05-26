export class OpenProjectClient {
    config;
    constructor(config) {
        this.config = config;
    }
    get apiKey() {
        return this.config.apiKey;
    }
    get baseUrl() {
        return this.config.baseUrl;
    }
    async get(path, params) {
        const url = this.buildUrl(path, params);
        return this.request('GET', url);
    }
    async post(path, body) {
        return this.request('POST', this.buildUrl(path), body);
    }
    async patch(path, body) {
        return this.request('PATCH', this.buildUrl(path), body);
    }
    async delete(path) {
        return this.request('DELETE', this.buildUrl(path));
    }
    async postFormData(path, formData) {
        return this.request('POST', this.buildUrl(path), formData);
    }
    buildUrl(path, params) {
        const base = path.startsWith('http')
            ? path
            : `${this.config.baseUrl}/api/v3${path.startsWith('/') ? path : `/${path}`}`;
        if (!params)
            return base;
        const qs = new URLSearchParams();
        if (params.filters && params.filters.length > 0) {
            const serialized = params.filters.map((f) => ({
                [f.field]: { operator: f.operator, values: f.values },
            }));
            qs.set('filters', JSON.stringify(serialized));
        }
        if (params.sortBy && params.sortBy.length > 0) {
            qs.set('sortBy', JSON.stringify(params.sortBy));
        }
        if (params.groupBy)
            qs.set('groupBy', params.groupBy);
        if (params.showSums !== undefined)
            qs.set('showSums', String(params.showSums));
        if (params.select)
            qs.set('select', params.select);
        if (params.offset !== undefined)
            qs.set('offset', String(params.offset));
        if (params.pageSize !== undefined) {
            qs.set('pageSize', String(params.pageSize));
        }
        else {
            qs.set('pageSize', String(this.config.defaultPageSize));
        }
        if (params.search)
            qs.set('searchString', params.search);
        const query = qs.toString();
        return query ? `${base}?${query}` : base;
    }
    async request(method, url, body) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error(`timeout after ${this.config.timeoutMs}ms`)), this.config.timeoutMs);
        const auth = Buffer.from(`apikey:${this.config.apiKey}`).toString('base64');
        const headers = {
            Authorization: `Basic ${auth}`,
            Accept: 'application/hal+json',
            'User-Agent': 'openproject-mcp/0.1.0',
        };
        const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
        if (body !== undefined && !isFormData)
            headers['Content-Type'] = 'application/json';
        try {
            const res = await fetch(url, {
                method,
                headers,
                body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
                signal: controller.signal,
            });
            const text = await res.text();
            const parsed = text ? safeJson(text) : undefined;
            if (!res.ok) {
                const err = new Error(`OpenProject ${method} ${res.status}: ${describeError(parsed) ?? text.slice(0, 200)}`);
                err.status = res.status;
                err.body = parsed ?? text;
                err.url = url;
                throw err;
            }
            return parsed ?? undefined;
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function describeError(body) {
    if (!body || typeof body !== 'object')
        return undefined;
    const b = body;
    const msg = typeof b.message === 'string' ? b.message : undefined;
    const id = typeof b.errorIdentifier === 'string' ? b.errorIdentifier : undefined;
    if (msg && id)
        return `${id}: ${msg}`;
    return msg ?? id;
}
//# sourceMappingURL=client.js.map