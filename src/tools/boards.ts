import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import {
  extractElements,
  paginationMeta,
  type HalCollection,
  type HalResource,
} from '../hal.js';
import { json, tryTool } from '../toolResult.js';

function summarizeBoard(g: HalResource) {
  return {
    id: g.id,
    name: g.name,
    rowCount: g.rowCount,
    columnCount: g.columnCount,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    widgets: g.widgets,
  };
}

export function registerBoardTools(server: McpServer, client: OpenProjectClient) {
  server.registerTool(
    'op_list_boards',
    {
      title: 'List boards',
      description:
        'List boards (Kanban-style) for a project. Boards are stored as grids scoped to /projects/{id}/boards.',
      inputSchema: {
        projectIdOrIdentifier: z.string().describe('Project id or identifier'),
        raw: z.boolean().optional(),
      },
    },
    async ({ projectIdOrIdentifier, raw }) =>
      tryTool(async () => {
        const scope = `/projects/${encodeURIComponent(projectIdOrIdentifier)}/boards`;
        const data = await client.get<HalCollection>('/grids', {
          filters: [
            { field: 'scope', operator: '=', values: [scope] },
          ],
        });
        if (raw) return json(data);
        return json({
          ...paginationMeta(data),
          elements: extractElements(data).map(summarizeBoard),
        });
      }),
  );

  server.registerTool(
    'op_get_board',
    {
      title: 'Get board',
      description: 'Fetch a single board (grid) by id, including its widget/column configuration.',
      inputSchema: {
        id: z.number().int().positive(),
        raw: z.boolean().optional(),
      },
    },
    async ({ id, raw }) =>
      tryTool(async () => {
        const data = await client.get<HalResource>(`/grids/${id}`);
        return json(raw ? data : summarizeBoard(data));
      }),
  );
}
