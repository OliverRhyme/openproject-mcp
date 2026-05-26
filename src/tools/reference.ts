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

const simpleRef = (r: HalResource) => ({
  id: r.id,
  name: r.name,
  position: r.position,
  isDefault: r.isDefault,
  isClosed: r.isClosed,
  color: r.color,
});

export function registerReferenceTools(server: McpServer, client: OpenProjectClient) {
  server.registerTool(
    'op_list_types',
    {
      title: 'List work package types',
      description:
        'List work package types (Task, Bug, Feature, Milestone, etc.). Optionally scope to a project.',
      inputSchema: {
        projectIdOrIdentifier: z.string().optional(),
      },
    },
    async ({ projectIdOrIdentifier }) =>
      tryTool(async () => {
        const path = projectIdOrIdentifier
          ? `/projects/${encodeURIComponent(projectIdOrIdentifier)}/types`
          : '/types';
        const data = await client.get<HalCollection>(path);
        return json({
          ...paginationMeta(data),
          elements: extractElements(data).map(simpleRef),
        });
      }),
  );

  server.registerTool(
    'op_list_statuses',
    {
      title: 'List statuses',
      description: 'List all work package statuses defined on the instance.',
      inputSchema: {},
    },
    async () =>
      tryTool(async () => {
        const data = await client.get<HalCollection>('/statuses');
        return json({
          ...paginationMeta(data),
          elements: extractElements(data).map(simpleRef),
        });
      }),
  );

  server.registerTool(
    'op_list_priorities',
    {
      title: 'List priorities',
      description: 'List all priorities defined on the instance.',
      inputSchema: {},
    },
    async () =>
      tryTool(async () => {
        const data = await client.get<HalCollection>('/priorities');
        return json({
          ...paginationMeta(data),
          elements: extractElements(data).map(simpleRef),
        });
      }),
  );

  server.registerTool(
    'op_list_versions',
    {
      title: 'List versions (milestones)',
      description: 'List versions, optionally filtered to a project.',
      inputSchema: {
        projectIdOrIdentifier: z.string().optional(),
      },
    },
    async ({ projectIdOrIdentifier }) =>
      tryTool(async () => {
        const path = projectIdOrIdentifier
          ? `/projects/${encodeURIComponent(projectIdOrIdentifier)}/versions`
          : '/versions';
        const data = await client.get<HalCollection>(path);
        return json({
          ...paginationMeta(data),
          elements: extractElements(data).map((v) => ({
            id: v.id,
            name: v.name,
            status: v.status,
            sharing: v.sharing,
            startDate: v.startDate,
            endDate: v.endDate,
          })),
        });
      }),
  );

  server.registerTool(
    'op_api_passthrough',
    {
      title: 'Raw API passthrough',
      description:
        'Escape hatch: call any GET endpoint under /api/v3 directly. Path should start with "/" (e.g. "/queries/42"). ' +
        'Use sparingly — prefer the typed tools above.',
      inputSchema: {
        path: z
          .string()
          .startsWith('/')
          .describe('Path beneath /api/v3, e.g. "/queries/42" or "/relations"'),
      },
    },
    async ({ path }) =>
      tryTool(async () => {
        const data = await client.get(path);
        return json(data);
      }),
  );
}
