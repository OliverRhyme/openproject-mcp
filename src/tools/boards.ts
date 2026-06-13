import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient, type ApiError } from '../client.js';
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

/**
 * A unique position just above `pos` for a card that collided onto another card's
 * exact position. `others` are the OTHER cards' positions in the lane (excluding the
 * moving card). Never returns the reserved -1.
 */
export function resolveUniquePosition(others: number[], pos: number): number {
  const guard = (p: number) => (p === -1 ? -2 : p);
  const above = others.filter((p) => p > pos).sort((a, b) => a - b);
  if (above.length === 0) return guard(pos + POSITION_GAP);
  const next = above[0]!;
  const mid = Math.floor((pos + next) / 2);
  return mid > pos ? guard(mid) : guard(pos + POSITION_GAP);
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

const ATTRIBUTE_LINKS: Record<string, { rel: string; collection: string }> = {
  status: { rel: 'status', collection: 'statuses' },
  assignee: { rel: 'assignee', collection: 'users' },
  version: { rel: 'version', collection: 'versions' },
  subproject: { rel: 'project', collection: 'projects' },
};

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

  server.registerTool(
    'op_move_card',
    {
      title: 'Move board card',
      description:
        'Move a work package into a lane of a board. Free boards: repositions via manual ordering ' +
        '(position top/bottom/index). Action boards: changes the work package attribute the board is keyed on ' +
        '(status/assignee/version/subproject); position is ignored. toLane may be a lane query id or lane name.',
      inputSchema: {
        boardId: z.number().int().positive(),
        workPackageId: z.number().int().positive(),
        toLane: z.union([z.string(), z.number()]).describe('Lane query id, or lane name (case-insensitive)'),
        position: z.union([z.literal('top'), z.literal('bottom'), z.number().int().nonnegative()]).optional()
          .describe('Free boards only. Default "bottom".'),
        notify: z.boolean().optional().describe('Action boards: send work-package notifications (default true)'),
      },
    },
    async ({ boardId, workPackageId, toLane, position, notify }) =>
      tryTool(async () => {
        const grid = await client.get<HalResource>(`/grids/${boardId}`);
        const type = boardType(grid);
        const widgets = laneWidgets(grid);

        // Resolve each lane's query for name (+ value for action boards).
        const lanes = await Promise.all(
          widgets.map(async (w) => {
            const q = await client.get<HalResource>(`/queries/${w.queryId}`);
            return { queryId: w.queryId, name: (q.name as string | undefined) ?? null, query: q };
          }),
        );

        const target = lanes.find((l) =>
          typeof toLane === 'number'
            ? l.queryId === toLane
            : l.name?.toLowerCase() === String(toLane).toLowerCase(),
        );
        if (!target) {
          throw new Error(
            `Lane "${toLane}" not found on board ${boardId}. Available lanes: ` +
              lanes.map((l) => `${l.name} (${l.queryId})`).join(', '),
          );
        }

        if (type === 'free') {
          // Read each lane's order to find the source lane and the target's positions.
          const orders = await Promise.all(
            lanes.map((l) => client.get<Record<string, number>>(`/queries/${l.queryId}/order`)),
          );
          const orderByQuery = new Map(lanes.map((l, i) => [l.queryId, orders[i] ?? {}]));
          const source = lanes.find((l) => String(workPackageId) in (orderByQuery.get(l.queryId) ?? {}));

          const targetOrder = orderByQuery.get(target.queryId) ?? {};
          const positions = Object.entries(targetOrder)
            .filter(([id]) => Number(id) !== workPackageId)
            .map(([, p]) => p);
          const pos = computeInsertPosition(positions, position ?? 'bottom');

          // Add to target FIRST, then remove from source (never makes the card vanish).
          await client.patch(`/queries/${target.queryId}/order`, { delta: { [String(workPackageId)]: pos } });
          if (source && source.queryId !== target.queryId) {
            await client.patch(`/queries/${source.queryId}/order`, { delta: { [String(workPackageId)]: -1 } });
          }

          return json({
            moved: workPackageId,
            boardId,
            boardType: 'free',
            fromLane: source?.name ?? null,
            toLane: target.name,
            position: pos,
          });
        }

        // Action board: move = set the work package's attribute to the target lane's value.
        const attr = actionAttribute(grid);
        const mapping = attr ? ATTRIBUTE_LINKS[attr] : undefined;
        if (!attr || !mapping) {
          throw new Error(`Unsupported action board attribute: ${attr ?? 'unknown'}`);
        }
        const value = laneValue(target.query);
        if (value?.id == null) {
          throw new Error(`Could not determine target value for lane "${target.name}"`);
        }
        const href = `/api/v3/${mapping.collection}/${value.id}`;
        const suffix = notify === false ? '?notify=false' : '';

        const patchOnce = async () => {
          const wp = await client.get<HalResource>(`/work_packages/${workPackageId}`);
          return client.patch<HalResource>(`/work_packages/${workPackageId}${suffix}`, {
            lockVersion: wp.lockVersion,
            _links: { [mapping.rel]: { href } },
          });
        };

        try {
          await patchOnce();
        } catch (err) {
          if ((err as ApiError).status === 409) {
            await patchOnce(); // retry once with a fresh lockVersion
          } else {
            throw err;
          }
        }

        return json({
          moved: workPackageId,
          boardId,
          boardType: 'action',
          attribute: attr,
          toLane: target.name,
          value,
        });
      }),
  );
}
