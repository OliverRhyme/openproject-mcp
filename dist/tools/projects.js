import { z } from 'zod';
import { extractElements, paginationMeta, summarizeProject, } from '../hal.js';
import { json, tryTool } from '../toolResult.js';
const filterSchema = z
    .array(z.object({
    field: z.string().describe('OpenProject filter field, e.g. "active", "name_and_identifier"'),
    operator: z.string().describe('Filter operator, e.g. "=", "!", "~", "o"'),
    values: z.array(z.string()).nullable().describe('Filter values, or null for operators that take no values'),
}))
    .optional();
const listInput = {
    filters: filterSchema,
    sortBy: z
        .array(z.tuple([z.string(), z.enum(['asc', 'desc'])]))
        .optional()
        .describe('e.g. [["name", "asc"]]'),
    offset: z.number().int().positive().optional().describe('Page number (1-based)'),
    pageSize: z.number().int().positive().max(1000).optional(),
    raw: z.boolean().optional().describe('Return full HAL response instead of summary'),
};
export function registerProjectTools(server, client) {
    server.registerTool('op_list_projects', {
        title: 'List projects',
        description: 'List OpenProject projects visible to the API key. Supports OpenProject filter syntax. ' +
            'Common fields: "active" ("=" true/false), "name_and_identifier" ("~" substring), "parent_id" ("=" id).',
        inputSchema: listInput,
    }, async ({ filters, sortBy, offset, pageSize, raw }) => tryTool(async () => {
        const data = await client.get('/projects', {
            filters: filters,
            sortBy,
            offset,
            pageSize,
        });
        if (raw)
            return json(data);
        return json({
            ...paginationMeta(data),
            elements: extractElements(data).map(summarizeProject),
        });
    }));
    server.registerTool('op_get_project', {
        title: 'Get project',
        description: 'Get a single project by numeric id or identifier slug.',
        inputSchema: {
            idOrIdentifier: z.string().describe('Project numeric id (e.g. "42") or identifier slug'),
            raw: z.boolean().optional(),
        },
    }, async ({ idOrIdentifier, raw }) => tryTool(async () => {
        const data = await client.get(`/projects/${encodeURIComponent(idOrIdentifier)}`);
        return json(raw ? data : summarizeProject(data));
    }));
    server.registerTool('op_create_project', {
        title: 'Create project',
        description: 'Create a new project. Requires admin or "add project" permission. ' +
            'Pass either a parent identifier or numeric id via _links.parent.href if creating a sub-project.',
        inputSchema: {
            name: z.string().min(1),
            identifier: z
                .string()
                .regex(/^[a-z0-9-_]+$/)
                .optional()
                .describe('URL-safe slug; auto-generated from name when omitted'),
            description: z.string().optional(),
            public: z.boolean().optional(),
            parentId: z.union([z.string(), z.number()]).optional().describe('Numeric id of parent project'),
        },
    }, async ({ name, identifier, description, public: isPublic, parentId }) => tryTool(async () => {
        const body = { name };
        if (identifier)
            body.identifier = identifier;
        if (description)
            body.description = { raw: description };
        if (isPublic !== undefined)
            body.public = isPublic;
        if (parentId !== undefined) {
            body._links = {
                parent: { href: `/api/v3/projects/${parentId}` },
            };
        }
        const data = await client.post('/projects', body);
        return json(summarizeProject(data));
    }));
    server.registerTool('op_update_project', {
        title: 'Update project',
        description: 'Patch an existing project. Only include the fields you want to change.',
        inputSchema: {
            idOrIdentifier: z.string(),
            name: z.string().optional(),
            description: z.string().optional(),
            public: z.boolean().optional(),
            active: z.boolean().optional(),
        },
    }, async ({ idOrIdentifier, name, description, public: isPublic, active }) => tryTool(async () => {
        const body = {};
        if (name !== undefined)
            body.name = name;
        if (description !== undefined)
            body.description = { raw: description };
        if (isPublic !== undefined)
            body.public = isPublic;
        if (active !== undefined)
            body.active = active;
        const data = await client.patch(`/projects/${encodeURIComponent(idOrIdentifier)}`, body);
        return json(summarizeProject(data));
    }));
    server.registerTool('op_delete_project', {
        title: 'Delete project',
        description: 'Delete a project. Destructive; requires admin permission. The deletion is processed asynchronously by OpenProject.',
        inputSchema: {
            idOrIdentifier: z.string(),
        },
    }, async ({ idOrIdentifier }) => tryTool(async () => {
        await client.delete(`/projects/${encodeURIComponent(idOrIdentifier)}`);
        return json({ deleted: idOrIdentifier });
    }));
}
//# sourceMappingURL=projects.js.map