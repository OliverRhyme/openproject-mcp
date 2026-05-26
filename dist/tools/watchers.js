import { z } from 'zod';
import { extractElements, paginationMeta, summarizeUser, } from '../hal.js';
import { json, tryTool } from '../toolResult.js';
export function registerWatcherTools(server, client) {
    server.registerTool('op_list_watchers', {
        title: 'List watchers',
        description: 'List users watching a work package.',
        inputSchema: {
            workPackageId: z.number().int().positive(),
            raw: z.boolean().optional(),
        },
    }, async ({ workPackageId, raw }) => tryTool(async () => {
        const data = await client.get(`/work_packages/${workPackageId}/watchers`);
        if (raw)
            return json(data);
        return json({
            ...paginationMeta(data),
            elements: extractElements(data).map(summarizeUser),
        });
    }));
    server.registerTool('op_add_watcher', {
        title: 'Add watcher',
        description: 'Add a user as a watcher to a work package.',
        inputSchema: {
            workPackageId: z.number().int().positive(),
            userId: z.number().int().positive(),
        },
    }, async ({ workPackageId, userId }) => tryTool(async () => {
        const data = await client.post(`/work_packages/${workPackageId}/watchers`, { user: { href: `/api/v3/users/${userId}` } });
        return json(data);
    }));
    server.registerTool('op_remove_watcher', {
        title: 'Remove watcher',
        description: 'Remove a user from watching a work package.',
        inputSchema: {
            workPackageId: z.number().int().positive(),
            userId: z.number().int().positive(),
        },
    }, async ({ workPackageId, userId }) => tryTool(async () => {
        await client.delete(`/work_packages/${workPackageId}/watchers/${userId}`);
        return json({ removed: userId });
    }));
}
//# sourceMappingURL=watchers.js.map