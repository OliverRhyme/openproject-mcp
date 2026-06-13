import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient, type Filter } from '../client.js';
import {
  extractElements,
  paginationMeta,
  pickFields,
  summarizeUser,
  type HalCollection,
  type HalResource,
} from '../hal.js';
import { json, tryTool } from '../toolResult.js';

const filterSchema = z
  .array(
    z.object({
      field: z.string(),
      operator: z.string(),
      values: z.array(z.string()).nullable(),
    }),
  )
  .optional();

export function registerUserTools(server: McpServer, client: OpenProjectClient) {
  server.registerTool(
    'op_current_user',
    {
      title: 'Current user',
      annotations: { readOnlyHint: true },
      description: 'Return the user associated with the configured API key.',
      inputSchema: {},
    },
    async () =>
      tryTool(async () => {
        const data = await client.get<HalResource>('/users/me');
        return json(summarizeUser(data));
      }),
  );

  server.registerTool(
    'op_list_users',
    {
      title: 'List users',
      annotations: { readOnlyHint: true },
      description:
        'List users visible to the current API key. Supports filters such as ' +
        '"name" ("~" search), "status" ("=" "active"/"locked"/"invited"), "login" ("=" exact).',
      inputSchema: {
        filters: filterSchema,
        sortBy: z.array(z.tuple([z.string(), z.enum(['asc', 'desc'])])).optional(),
        offset: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().max(100).optional().describe('Max 100'),
        fields: z.array(z.string()).optional().describe('Return only these fields per element, e.g. ["id","name","email"]'),
        raw: z.boolean().optional(),
      },
    },
    async ({ filters, sortBy, offset, pageSize, fields, raw }) =>
      tryTool(async () => {
        const data = await client.get<HalCollection>('/users', {
          filters: filters as Filter[] | undefined,
          sortBy,
          offset,
          pageSize,
        });
        if (raw) return json(data);
        return json({
          ...paginationMeta(data),
          elements: extractElements(data).map((u) => pickFields(summarizeUser(u), fields)),
        });
      }),
  );

  server.registerTool(
    'op_get_user',
    {
      title: 'Get user',
      annotations: { readOnlyHint: true },
      description: 'Fetch a user by numeric id.',
      inputSchema: {
        id: z.number().int().positive(),
        raw: z.boolean().optional(),
      },
    },
    async ({ id, raw }) =>
      tryTool(async () => {
        const data = await client.get<HalResource>(`/users/${id}`);
        return json(raw ? data : summarizeUser(data));
      }),
  );
}
