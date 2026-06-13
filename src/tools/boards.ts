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
}
