#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { OpenProjectClient } from './client.js';
import { registerProjectTools } from './tools/projects.js';
import { registerWorkPackageTools } from './tools/workPackages.js';
import { registerUserTools } from './tools/users.js';
import { registerReferenceTools } from './tools/reference.js';
import { registerRelationTools } from './tools/relations.js';
import { registerAttachmentTools } from './tools/attachments.js';
import { registerNotificationTools } from './tools/notifications.js';
import { registerWatcherTools } from './tools/watchers.js';
import { registerBoardTools } from './tools/boards.js';
export function createServer() {
    const config = loadConfig();
    const client = new OpenProjectClient(config);
    const server = new McpServer({
        name: 'openproject-mcp',
        version: '0.1.0',
    });
    registerProjectTools(server, client);
    registerWorkPackageTools(server, client);
    registerUserTools(server, client);
    registerReferenceTools(server, client);
    registerRelationTools(server, client);
    registerAttachmentTools(server, client);
    registerNotificationTools(server, client);
    registerWatcherTools(server, client);
    registerBoardTools(server, client);
    return server;
}
async function main() {
    const server = createServer();
    const config = loadConfig();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`openproject-mcp connected to ${config.baseUrl} (page size ${config.defaultPageSize})\n`);
}
const isMainModule = typeof process !== 'undefined' &&
    process.argv[1] &&
    (process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('/index.ts'));
if (isMainModule) {
    main().catch((err) => {
        process.stderr.write(`openproject-mcp fatal: ${err.message}\n`);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map