import { z } from 'zod';
import { extractElements, hrefTitle, paginationMeta, pickLink, } from '../hal.js';
import { json, tryTool } from '../toolResult.js';
const filterSchema = z
    .array(z.object({
    field: z.string(),
    operator: z.string(),
    values: z.array(z.string()).nullable(),
}))
    .optional();
function summarizeNotification(n) {
    return {
        id: n.id,
        reason: n.reason,
        read: n.readIAN ?? false,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        project: hrefTitle(pickLink(n, 'project')),
        resource: hrefTitle(pickLink(n, 'resource')),
        actor: hrefTitle(pickLink(n, 'actor')),
    };
}
export function registerNotificationTools(server, client) {
    server.registerTool('op_list_notifications', {
        title: 'List notifications',
        description: 'List in-app notifications for the current user. ' +
            'Common filters: "readIAN" ("=" "t"/"f"), "reason" ("=" "assigned"/"mentioned"/"watched").',
        inputSchema: {
            filters: filterSchema,
            sortBy: z.array(z.tuple([z.string(), z.enum(['asc', 'desc'])])).optional(),
            offset: z.number().int().positive().optional(),
            pageSize: z.number().int().positive().max(1000).optional(),
            raw: z.boolean().optional(),
        },
    }, async ({ filters, sortBy, offset, pageSize, raw }) => tryTool(async () => {
        const data = await client.get('/notifications', {
            filters: filters,
            sortBy,
            offset,
            pageSize,
        });
        if (raw)
            return json(data);
        return json({
            ...paginationMeta(data),
            elements: extractElements(data).map(summarizeNotification),
        });
    }));
    server.registerTool('op_get_notification', {
        title: 'Get notification',
        description: 'Fetch a single notification by id.',
        inputSchema: {
            id: z.number().int().positive(),
            raw: z.boolean().optional(),
        },
    }, async ({ id, raw }) => tryTool(async () => {
        const data = await client.get(`/notifications/${id}`);
        return json(raw ? data : summarizeNotification(data));
    }));
    server.registerTool('op_mark_notification_read', {
        title: 'Mark notification read',
        description: 'Mark a single notification as read.',
        inputSchema: {
            id: z.number().int().positive(),
        },
    }, async ({ id }) => tryTool(async () => {
        await client.post(`/notifications/${id}/read_ian`, {});
        return json({ id, read: true });
    }));
    server.registerTool('op_mark_all_notifications_read', {
        title: 'Mark all notifications read',
        description: 'Mark all notifications as read for the current user.',
        inputSchema: {},
    }, async () => tryTool(async () => {
        await client.post('/notifications/read_ian', {});
        return json({ allRead: true });
    }));
}
//# sourceMappingURL=notifications.js.map