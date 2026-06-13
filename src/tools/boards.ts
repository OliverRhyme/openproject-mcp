import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import {
  extractElements,
  hrefId,
  paginationMeta,
  pickFields,
  summarizeWorkPackage,
  type HalCollection,
  type HalResource,
} from '../hal.js';
import { json, tryTool } from '../toolResult.js';

const POSITION_GAP = 8192;

/**
 * Integer position for inserting a card into a free-board lane.
 * `positions` are the EXISTING positions in the target lane, excluding the moving card.
 * Position -1 is reserved by OpenProject for removal, so it is never returned.
 */
export function computeInsertPosition(
  positions: number[],
  position: 'top' | 'bottom' | number,
): number {
  if (positions.length === 0) return 0;
  const sorted = [...positions].sort((a, b) => a - b);
  const guardTop = (p: number) => (p === -1 ? -2 : p);
  const append = () => sorted[sorted.length - 1]! + POSITION_GAP;
  const prepend = () => guardTop(sorted[0]! - POSITION_GAP);

  if (position === 'bottom') return append();
  if (position === 'top') return prepend();

  const k = Math.max(0, Math.min(position, sorted.length));
  if (k === 0) return prepend();
  if (k >= sorted.length) return append();
  const prev = sorted[k - 1]!;
  const next = sorted[k]!;
  const mid = Math.floor((prev + next) / 2);
  return mid <= prev ? append() : mid; // no gap between neighbors → append
}

export function boardType(grid: HalResource): 'free' | 'action' {
  const opts = grid.options as { type?: string } | undefined;
  return opts?.type === 'action' ? 'action' : 'free';
}

export function actionAttribute(grid: HalResource): string | null {
  if (boardType(grid) !== 'action') return null;
  const opts = grid.options as { attribute?: string } | undefined;
  return opts?.attribute ?? null;
}

export interface LaneWidget {
  queryId: number;
  startColumn: number;
}

export function laneWidgets(grid: HalResource): LaneWidget[] {
  const widgets = (grid.widgets as any[]) ?? [];
  return widgets
    .filter((w) => w?.identifier === 'work_package_query' && w?.options?.queryId != null)
    .map((w) => ({ queryId: Number(w.options.queryId), startColumn: Number(w.startColumn ?? 0) }))
    .sort((a, b) => a.startColumn - b.startColumn);
}

export interface LaneValue {
  id: number | string | null;
  title: string | null;
}

/** The attribute value an action-board lane represents: the first non-manualSort filter's first value. */
export function laneValue(query: HalResource): LaneValue | null {
  const filters = (query.filters as any[]) ?? [];
  const attr = filters.find((f) => f?._type !== 'ManualSortQueryFilter');
  const v = attr?._links?.values?.[0];
  if (!v) return null;
  return { id: hrefId(v), title: v.title ?? null };
}

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

  server.registerTool(
    'op_list_board_lanes',
    {
      title: 'List board lanes',
      description:
        'List the lanes (columns) of a board with each lane’s name, backing query id, card count, and cards. ' +
        'Works for free and action boards. For action boards each lane includes the attribute value it represents.',
      inputSchema: {
        boardId: z.number().int().positive().describe('The grid id (the number in /boards/{id})'),
        includeCards: z.boolean().optional().describe('Include cards per lane (default true)'),
        maxCardsPerLane: z.number().int().positive().max(100).optional().describe('Max cards per lane (default 20, max 100)'),
        cardFields: z.array(z.string()).optional().describe('Return only these fields per card, e.g. ["id","subject","status"]'),
        raw: z.boolean().optional(),
      },
    },
    async ({ boardId, includeCards, maxCardsPerLane, cardFields, raw }) =>
      tryTool(async () => {
        const grid = await client.get<HalResource>(`/grids/${boardId}`);
        const type = boardType(grid);
        const attr = actionAttribute(grid);
        const widgets = laneWidgets(grid);
        const pageSize = maxCardsPerLane ?? 20;
        const withCards = includeCards !== false;

        const queries = await Promise.all(
          widgets.map((w) => client.get<HalResource>(`/queries/${w.queryId}`, { pageSize })),
        );
        if (raw) return json({ grid, queries });

        const lanes = widgets.map((w, i) => {
          const q = queries[i]!;
          const results = (q._embedded as { results?: HalCollection } | undefined)?.results;
          const cards = extractElements(results).map((wp) =>
            pickFields(summarizeWorkPackage(wp), cardFields),
          );
          return {
            name: (q.name as string | undefined) ?? null,
            queryId: w.queryId,
            value: type === 'action' ? laneValue(q) : null,
            total: results?.total ?? 0,
            hasMore: paginationMeta(results).hasMore,
            ...(withCards ? { cards } : {}),
          };
        });

        return json({
          boardId,
          name: (grid.name as string | undefined) ?? null,
          type,
          actionAttribute: attr,
          lanes,
        });
      }),
  );
}
