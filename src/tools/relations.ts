import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import {
  extractElements,
  hrefId,
  hrefTitle,
  paginationMeta,
  pickLink,
  type HalCollection,
  type HalResource,
} from '../hal.js';
import { json, tryTool } from '../toolResult.js';

function summarizeRelation(r: HalResource) {
  return {
    id: r.id,
    type: r.type,
    reverseType: r.reverseType,
    description: r.description,
    from: {
      id: hrefId(pickLink(r, 'from')),
      title: hrefTitle(pickLink(r, 'from')),
    },
    to: {
      id: hrefId(pickLink(r, 'to')),
      title: hrefTitle(pickLink(r, 'to')),
    },
  };
}

export function registerRelationTools(server: McpServer, client: OpenProjectClient) {
  server.registerTool(
    'op_list_relations',
    {
      title: 'List work package relations',
      description:
        'List relations for a work package. Relation types: relates, duplicates, duplicated, blocks, blocked, precedes, follows, includes, partOf, requires, required.',
      inputSchema: {
        workPackageId: z.number().int().positive(),
        raw: z.boolean().optional(),
      },
    },
    async ({ workPackageId, raw }) =>
      tryTool(async () => {
        const data = await client.get<HalCollection>(
          `/work_packages/${workPackageId}/relations`,
        );
        if (raw) return json(data);
        return json({
          ...paginationMeta(data),
          elements: extractElements(data).map(summarizeRelation),
        });
      }),
  );

  server.registerTool(
    'op_get_relation',
    {
      title: 'Get relation',
      description: 'Fetch a single relation by id.',
      inputSchema: {
        id: z.number().int().positive(),
        raw: z.boolean().optional(),
      },
    },
    async ({ id, raw }) =>
      tryTool(async () => {
        const data = await client.get<HalResource>(`/relations/${id}`);
        return json(raw ? data : summarizeRelation(data));
      }),
  );

  server.registerTool(
    'op_create_relation',
    {
      title: 'Create relation',
      description:
        'Create a relation between two work packages. Types: relates, duplicates, blocks, precedes, follows, includes, partOf, requires.',
      inputSchema: {
        fromId: z.number().int().positive().describe('Source work package id'),
        toId: z.number().int().positive().describe('Target work package id'),
        type: z.string().describe('Relation type, e.g. "blocks", "precedes", "relates"'),
        description: z.string().optional(),
      },
    },
    async ({ fromId, toId, type, description }) =>
      tryTool(async () => {
        const body: Record<string, unknown> = {
          type,
          _links: {
            from: { href: `/api/v3/work_packages/${fromId}` },
            to: { href: `/api/v3/work_packages/${toId}` },
          },
        };
        if (description) body.description = description;
        const data = await client.post<HalResource>('/relations', body);
        return json(summarizeRelation(data));
      }),
  );

  server.registerTool(
    'op_delete_relation',
    {
      title: 'Delete relation',
      description: 'Delete a relation between work packages.',
      inputSchema: {
        id: z.number().int().positive(),
      },
    },
    async ({ id }) =>
      tryTool(async () => {
        await client.delete(`/relations/${id}`);
        return json({ deleted: id });
      }),
  );
}
