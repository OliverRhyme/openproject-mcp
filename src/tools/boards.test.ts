import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import type { Config } from '../config.js';
import {
  registerBoardTools,
  computeInsertPosition,
  resolveUniquePosition,
  boardType,
  actionAttribute,
  laneWidgets,
  laneValue,
} from './boards.js';

const config: Config = {
  baseUrl: 'https://op.example.com',
  apiKey: 'test-key',
  defaultPageSize: 25,
  timeoutMs: 5000,
};

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function makeServer() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const client = new OpenProjectClient(config);
  registerBoardTools(server, client);
  return server;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {} as any);
}

const gridHal = {
  id: 3,
  name: 'Sprint Board',
  rowCount: 1,
  columnCount: 4,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-10T00:00:00Z',
  options: {},
  widgets: [
    {
      identifier: 'work_package_query',
      startRow: 1, endRow: 2, startColumn: 1, endColumn: 2,
      options: { queryId: '100', filters: [] },
    },
  ],
  _links: {
    scope: { href: '/api/v3/projects/5/boards', title: 'Alpha' },
  },
};

// Routes each fetch call to a matching response by url + method.
type Route = {
  match: (url: string, method: string, body: any) => boolean;
  status?: number;
  body: unknown;
};
function routeFetch(routes: Route[]) {
  return vi.fn().mockImplementation((url: string, opts: any) => {
    const method = (opts?.method ?? 'GET') as string;
    const body =
      opts?.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined;
    const route = routes.find((r) => r.match(url, method, body));
    if (!route) throw new Error(`No route for ${method} ${url}`);
    const status = route.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(route.body)),
    });
  });
}

function wpHal(id: number, subject: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    subject,
    lockVersion: 3,
    _links: { status: { href: '/api/v3/statuses/1', title: 'New' } },
    ...extra,
  };
}

function queryHal(opts: {
  id: number;
  name: string;
  cards: any[];
  total?: number;
  extraFilters?: any[];
}) {
  return {
    id: opts.id,
    name: opts.name,
    filters: [
      {
        _type: 'ManualSortQueryFilter',
        _links: { filter: { href: '/api/v3/queries/filters/manualSort' }, values: [] },
      },
      ...(opts.extraFilters ?? []),
    ],
    _embedded: {
      results: {
        total: opts.total ?? opts.cards.length,
        count: opts.cards.length,
        pageSize: 20,
        offset: 1,
        _embedded: { elements: opts.cards },
      },
    },
    _links: {
      updateOrderedWorkPackages: { href: `/api/v3/queries/${opts.id}/order`, method: 'put' },
    },
  };
}

const freeGrid = {
  id: 847,
  name: 'Issues',
  options: { type: 'free', filters: [], highlightingMode: 'priority' },
  widgets: [
    { identifier: 'work_package_query', startColumn: 2, options: { queryId: 101 } },
    { identifier: 'work_package_query', startColumn: 1, options: { queryId: 100 } },
  ],
  _links: { scope: { href: '/projects/asenso-mobile-v3/boards' } },
};

const actionGrid = {
  id: 900,
  name: 'Status board',
  options: { type: 'action', attribute: 'status' },
  widgets: [
    { identifier: 'work_package_query', startColumn: 1, options: { queryId: 200 } },
  ],
};

describe('registerBoardTools', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('registers both board tools', () => {
    const server = makeServer();
    const tools = (server as any)._registeredTools;
    expect('op_list_boards' in tools).toBe(true);
    expect('op_get_board' in tools).toBe(true);
  });

  test('op_list_boards filters grids to board scope for a project', async () => {
    const fetchMock = mockFetch(200, {
      total: 1, count: 1,
      _embedded: { elements: [gridHal] },
    });
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_list_boards', { projectIdOrIdentifier: '5' });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/grids');
    expect(url).toContain('filters');
    const data = JSON.parse(result.content[0].text);
    expect(data.elements).toHaveLength(1);
    expect(data.elements[0].name).toBe('Sprint Board');
  });

  test('op_get_board fetches a single grid by id', async () => {
    globalThis.fetch = mockFetch(200, gridHal);
    const server = makeServer();
    const result = await callTool(server, 'op_get_board', { id: 3 });
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(3);
    expect(data.name).toBe('Sprint Board');
    expect(data.widgets).toHaveLength(1);
  });
});

describe('op_list_board_lanes', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('free board: lanes ordered by column with names, counts, cards', async () => {
    globalThis.fetch = routeFetch([
      { match: (u, m) => m === 'GET' && u.includes('/grids/847'), body: freeGrid },
      { match: (u) => u.includes('/queries/100'), body:
        queryHal({ id: 100, name: 'TODO', cards: [wpHal(1, 'A'), wpHal(2, 'B')], total: 2 }) },
      { match: (u) => u.includes('/queries/101'), body:
        queryHal({ id: 101, name: 'IN PROGRESS', cards: [wpHal(3, 'C')], total: 5 }) },
    ]);
    const server = makeServer();
    const result = await callTool(server, 'op_list_board_lanes', { boardId: 847 });
    const data = JSON.parse(result.content[0].text);
    expect(data.type).toBe('free');
    expect(data.actionAttribute).toBeNull();
    expect(data.lanes.map((l: any) => l.name)).toEqual(['TODO', 'IN PROGRESS']);
    expect(data.lanes[0].queryId).toBe(100);
    expect(data.lanes[0].total).toBe(2);
    expect(data.lanes[0].cards.map((c: any) => c.id)).toEqual([1, 2]);
    expect(data.lanes[1].total).toBe(5);
    expect(data.lanes[1].hasMore).toBe(true); // total 5 > count 1
  });

  test('passes maxCardsPerLane as pageSize and respects cardFields', async () => {
    const fetchMock = routeFetch([
      { match: (u, m) => m === 'GET' && u.includes('/grids/847'), body: freeGrid },
      { match: (u) => u.includes('/queries/100'), body:
        queryHal({ id: 100, name: 'TODO', cards: [wpHal(1, 'A')] }) },
      { match: (u) => u.includes('/queries/101'), body:
        queryHal({ id: 101, name: 'IN PROGRESS', cards: [] }) },
    ]);
    globalThis.fetch = fetchMock;
    const server = makeServer();
    const result = await callTool(server, 'op_list_board_lanes', {
      boardId: 847, maxCardsPerLane: 10, cardFields: ['id', 'subject'],
    });
    const queryUrl = fetchMock.mock.calls.map((c: any) => c[0]).find((u: string) => u.includes('/queries/100'));
    expect(queryUrl).toContain('pageSize=10');
    const data = JSON.parse(result.content[0].text);
    expect(Object.keys(data.lanes[0].cards[0])).toEqual(['id', 'subject']);
  });

  test('action board: lane carries extracted value', async () => {
    globalThis.fetch = routeFetch([
      { match: (u, m) => m === 'GET' && u.includes('/grids/900'), body: actionGrid },
      { match: (u) => u.includes('/queries/200'), body: queryHal({
        id: 200, name: 'In progress', cards: [],
        extraFilters: [{ _type: 'StatusQueryFilter', _links: {
          filter: { href: '/api/v3/queries/filters/status' },
          values: [{ href: '/api/v3/statuses/7', title: 'In progress' }] } }],
      }) },
    ]);
    const server = makeServer();
    const result = await callTool(server, 'op_list_board_lanes', { boardId: 900, includeCards: false });
    const data = JSON.parse(result.content[0].text);
    expect(data.type).toBe('action');
    expect(data.actionAttribute).toBe('status');
    expect(data.lanes[0].value).toEqual({ id: 7, title: 'In progress' });
    expect(data.lanes[0].cards).toBeUndefined();
  });
});

describe('op_move_card (free board)', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // NOTE on route order: `/queries/100/order` contains `/queries/100`, so the
  // more specific `/order` routes MUST come before the plain query-name routes.
  // All GET routes are method-guarded so PATCH /order calls fall through to the
  // capture route instead of matching a GET route.
  function freeBoardRoutes(orders: Record<number, Record<string, number>>, patched: any[]) {
    return [
      { match: (u: string, m: string) => m === 'GET' && u.includes('/grids/847'), body: freeGrid },
      { match: (u: string, m: string) => m === 'GET' && u.includes('/queries/100/order'), body: orders[100] ?? {} },
      { match: (u: string, m: string) => m === 'GET' && u.includes('/queries/101/order'), body: orders[101] ?? {} },
      { match: (u: string, m: string) => m === 'GET' && u.includes('/queries/100'),
        body: queryHal({ id: 100, name: 'TODO', cards: [] }) },
      { match: (u: string, m: string) => m === 'GET' && u.includes('/queries/101'),
        body: queryHal({ id: 101, name: 'IN PROGRESS', cards: [] }) },
      // capture order PATCHes
      { match: (u: string, m: string, b: any) => m === 'PATCH' && u.includes('/order') && (patched.push({ u, b }), true),
        body: { t: '2026-06-13T00:00:00Z' } },
    ] as any[];
  }

  test('moves card to bottom of target, adds before removing from source', async () => {
    const patched: any[] = [];
    globalThis.fetch = routeFetch(freeBoardRoutes(
      { 100: { '1': -8192, '2': 16384 }, 101: { '3': 0 } }, patched,
    ));
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', {
      boardId: 847, workPackageId: 2, toLane: 'IN PROGRESS',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.boardType).toBe('free');
    expect(data.fromLane).toBe('TODO');
    expect(data.toLane).toBe('IN PROGRESS');
    expect(patched).toHaveLength(2);
    expect(patched[0].u).toContain('/queries/101/order');
    expect(patched[0].b).toEqual({ delta: { '2': 0 + 8192 } }); // bottom of [0]
    expect(patched[1].u).toContain('/queries/100/order');
    expect(patched[1].b).toEqual({ delta: { '2': -1 } });
  });

  test('toLane accepts a numeric query id', async () => {
    const patched: any[] = [];
    globalThis.fetch = routeFetch(freeBoardRoutes({ 100: { '2': 0 }, 101: {} }, patched));
    const server = makeServer();
    await callTool(server, 'op_move_card', { boardId: 847, workPackageId: 2, toLane: 101 });
    expect(patched[0].u).toContain('/queries/101/order');
    expect(patched[0].b).toEqual({ delta: { '2': 0 } }); // empty target → 0
  });

  test('card not yet on board → no source removal', async () => {
    const patched: any[] = [];
    globalThis.fetch = routeFetch(freeBoardRoutes({ 100: { '1': 0 }, 101: {} }, patched));
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 847, workPackageId: 99, toLane: 100 });
    const data = JSON.parse(result.content[0].text);
    expect(data.fromLane).toBeNull();
    expect(patched).toHaveLength(1); // only the add
    expect(patched[0].u).toContain('/queries/100/order');
  });

  test('unknown lane → error listing available lanes', async () => {
    globalThis.fetch = routeFetch(freeBoardRoutes({ 100: {}, 101: {} }, []));
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 847, workPackageId: 2, toLane: 'NOPE' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('TODO');
    expect(result.content[0].text).toContain('IN PROGRESS');
  });
});

describe('op_move_card (free board — concurrency hardening)', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // Stateful mock: maintains live order maps per query so GET-after-PATCH reflects writes,
  // and lets a test seed a "concurrent" collider into the target after the first add PATCH.
  function statefulFetch(opts: {
    grid: any;
    queryNames: Record<number, string>;
    orders: Record<number, Record<string, number>>;
    onTargetAdd?: (orders: Record<number, Record<string, number>>) => void;
  }) {
    const { grid, queryNames, orders } = opts;
    let targetAddSeen = false;
    return vi.fn().mockImplementation((url: string, o: any) => {
      const method = o?.method ?? 'GET';
      const body = o?.body ? JSON.parse(o.body) : undefined;
      const respond = (b: unknown) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(b)) });
      if (method === 'GET' && /\/grids\/\d+/.test(url)) return respond(grid);
      const om = url.match(/\/queries\/(\d+)\/order/);
      if (om) {
        const qid = Number(om[1]);
        if (method === 'GET') return respond(orders[qid] ?? {});
        if (method === 'PATCH') {
          for (const [wp, pos] of Object.entries(body.delta as Record<string, number>)) {
            orders[qid] = orders[qid] ?? {};
            if (pos === -1) delete orders[qid][wp];
            else orders[qid][wp] = pos;
          }
          if (!targetAddSeen && opts.onTargetAdd) { targetAddSeen = true; opts.onTargetAdd(orders); }
          return respond({ t: 'x' });
        }
      }
      const qm = url.match(/\/queries\/(\d+)/);
      if (method === 'GET' && qm) {
        const qid = Number(qm[1]);
        return respond(queryHal({ id: qid, name: queryNames[qid] ?? `Q${qid}`, cards: [] }));
      }
      throw new Error(`No route for ${method} ${url}`);
    });
  }

  test('clean move reports single-lane membership, no warning, not repositioned', async () => {
    globalThis.fetch = statefulFetch({
      grid: freeGrid,
      queryNames: { 100: 'TODO', 101: 'IN PROGRESS' },
      orders: { 100: { '2': 0 }, 101: {} },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 847, workPackageId: 2, toLane: 101 });
    const data = JSON.parse(result.content[0].text);
    expect(data.lanes).toEqual(['IN PROGRESS']);
    expect(data.repositioned).toBe(false);
    expect(data.warning).toBeUndefined();
  });

  test('collision in target → repositions to a unique slot', async () => {
    globalThis.fetch = statefulFetch({
      grid: freeGrid,
      queryNames: { 100: 'TODO', 101: 'IN PROGRESS' },
      orders: { 100: { '2': 0 }, 101: {} },
      onTargetAdd: (orders) => { orders[101]!['3'] = 0; }, // concurrent collider at same pos (0)
    });
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 847, workPackageId: 2, toLane: 101, position: 'bottom' });
    const data = JSON.parse(result.content[0].text);
    expect(data.repositioned).toBe(true);
    expect(data.lanes).toEqual(['IN PROGRESS']);
    expect(data.warning).toBeUndefined();
  });

  test('warns when card ends up in zero lanes', async () => {
    globalThis.fetch = statefulFetch({
      grid: freeGrid,
      queryNames: { 100: 'TODO', 101: 'IN PROGRESS' },
      orders: { 100: { '2': 0 }, 101: {} },
      onTargetAdd: (orders) => { delete orders[101]!['2']; delete orders[100]!['2']; },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 847, workPackageId: 2, toLane: 101 });
    const data = JSON.parse(result.content[0].text);
    expect(data.lanes).toEqual([]);
    expect(Array.isArray(data.warning)).toBe(true);
    expect(data.warning[0]).toContain('0 lane');
  });

  test('skips source removal when the card already left the source lane', async () => {
    const patches: { qid: number; delta: any }[] = [];
    let order100Reads = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string, o: any) => {
      const method = o?.method ?? 'GET';
      const body = o?.body ? JSON.parse(o.body) : undefined;
      const respond = (b: unknown) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(b)) });
      if (method === 'GET' && url.includes('/grids/847')) return respond(freeGrid);
      const om = url.match(/\/queries\/(\d+)\/order/);
      if (om) {
        const qid = Number(om[1]);
        if (method === 'PATCH') { patches.push({ qid, delta: body.delta }); return respond({ t: 'x' }); }
        if (qid === 100) { order100Reads++; return respond(order100Reads === 1 ? { '2': 0 } : {}); }
        return respond({}); // query 101 (target) always empty
      }
      const qm = url.match(/\/queries\/(\d+)/);
      if (method === 'GET' && qm) return respond(queryHal({ id: Number(qm[1]), name: Number(qm[1]) === 100 ? 'TODO' : 'IN PROGRESS', cards: [] }));
      throw new Error(`No route for ${method} ${url}`);
    });
    const server = makeServer();
    await callTool(server, 'op_move_card', { boardId: 847, workPackageId: 2, toLane: 101 });
    const removeFromSource = patches.find((p) => p.qid === 100 && p.delta?.['2'] === -1);
    expect(removeFromSource).toBeUndefined();
  });

  test('warns when card ends up in two lanes (duplicate)', async () => {
    // Card starts in NO lane, so source is undefined and no source-removal PATCH runs.
    // A concurrent writer adds the card to lane 100 right after our add to 101, leaving it
    // in BOTH lanes through the final anomaly scan.
    globalThis.fetch = statefulFetch({
      grid: freeGrid,
      queryNames: { 100: 'TODO', 101: 'IN PROGRESS' },
      orders: { 100: {}, 101: {} },
      onTargetAdd: (orders) => { orders[100]!['2'] = 999; }, // concurrent duplicate into another lane
    });
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 847, workPackageId: 2, toLane: 101 });
    const data = JSON.parse(result.content[0].text);
    expect(data.lanes.sort()).toEqual(['IN PROGRESS', 'TODO']);
    expect(Array.isArray(data.warning)).toBe(true);
    expect(data.warning[0]).toContain('2 lane');
    expect(data.warning[0]).toContain('op_list_board_lanes');
  });

  test('zero-lane anomaly leaves repositioned false', async () => {
    globalThis.fetch = statefulFetch({
      grid: freeGrid,
      queryNames: { 100: 'TODO', 101: 'IN PROGRESS' },
      orders: { 100: { '2': 0 }, 101: {} },
      onTargetAdd: (orders) => { delete orders[101]!['2']; delete orders[100]!['2']; },
    });
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 847, workPackageId: 2, toLane: 101 });
    const data = JSON.parse(result.content[0].text);
    expect(data.repositioned).toBe(false);
    expect(data.lanes).toEqual([]);
  });
});

describe('op_move_card (action board)', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const actionQuery = queryHal({
    id: 200, name: 'In progress', cards: [],
    extraFilters: [{ _type: 'StatusQueryFilter', _links: {
      filter: { href: '/api/v3/queries/filters/status' },
      values: [{ href: '/api/v3/statuses/7', title: 'In progress' }] } }],
  });

  test('changes the work package status link with current lockVersion', async () => {
    const patched: any[] = [];
    globalThis.fetch = routeFetch([
      { match: (u, m) => m === 'GET' && u.includes('/grids/900'), body: actionGrid },
      { match: (u) => u.includes('/queries/200') && !u.includes('/order'), body: actionQuery },
      { match: (u, m) => m === 'GET' && u.includes('/work_packages/5'), body: wpHal(5, 'X', { lockVersion: 11 }) },
      { match: (u, m, b) => m === 'PATCH' && u.includes('/work_packages/5') && (patched.push(b), true),
        body: wpHal(5, 'X', { lockVersion: 12 }) },
    ]);
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 900, workPackageId: 5, toLane: 'In progress' });
    const data = JSON.parse(result.content[0].text);
    expect(data.boardType).toBe('action');
    expect(data.toLane).toBe('In progress');
    expect(patched[0]).toEqual({
      lockVersion: 11,
      _links: { status: { href: '/api/v3/statuses/7' } },
    });
  });

  test('retries once on 409 with a fresh lockVersion', async () => {
    const patched: any[] = [];
    let wpVersion = 11;
    let patchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
      const method = opts?.method ?? 'GET';
      const respond = (status: number, body: unknown) =>
        Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) });
      if (method === 'GET' && url.includes('/grids/900')) return respond(200, actionGrid);
      if (url.includes('/queries/200') && !url.includes('/order')) return respond(200, actionQuery);
      if (method === 'GET' && url.includes('/work_packages/5')) return respond(200, wpHal(5, 'X', { lockVersion: wpVersion }));
      if (method === 'PATCH' && url.includes('/work_packages/5')) {
        patchCount++;
        patched.push(JSON.parse(opts.body));
        if (patchCount === 1) { wpVersion = 12; return respond(409, { _type: 'Error', message: 'stale' }); }
        return respond(200, wpHal(5, 'X', { lockVersion: 13 }));
      }
      throw new Error(`No route for ${method} ${url}`);
    });
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 900, workPackageId: 5, toLane: 200 });
    expect(result.isError).toBeUndefined();
    expect(patchCount).toBe(2);
    expect(patched[0].lockVersion).toBe(11);
    expect(patched[1].lockVersion).toBe(12); // refetched
  });
});

describe('op_move_card (action board — edge cases)', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const statusQuery = queryHal({
    id: 200, name: 'In progress', cards: [],
    extraFilters: [{ _type: 'StatusQueryFilter', _links: {
      filter: { href: '/api/v3/queries/filters/status' },
      values: [{ href: '/api/v3/statuses/7', title: 'In progress' }] } }],
  });

  test('appends ?notify=false to the work package PATCH when notify:false', async () => {
    const calls: { url: string; method: string }[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
      const method = opts?.method ?? 'GET';
      calls.push({ url, method });
      const respond = (b: unknown) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(b)) });
      if (url.includes('/grids/900')) return respond(actionGrid);
      if (url.includes('/queries/200') && !url.includes('/order')) return respond(statusQuery);
      if (url.includes('/work_packages/5')) return respond(wpHal(5, 'X', { lockVersion: 11 }));
      throw new Error(`No route for ${method} ${url}`);
    });
    const server = makeServer();
    await callTool(server, 'op_move_card', { boardId: 900, workPackageId: 5, toLane: 200, notify: false });
    const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/work_packages/5'));
    expect(patchCall).toBeDefined();
    expect(patchCall!.url).toContain('notify=false');
  });

  test('unsupported action attribute → error', async () => {
    const weirdGrid = { id: 901, name: 'Weird', options: { type: 'action', attribute: 'category' },
      widgets: [{ identifier: 'work_package_query', startColumn: 1, options: { queryId: 200 } }] };
    globalThis.fetch = routeFetch([
      { match: (u, m) => m === 'GET' && u.includes('/grids/901'), body: weirdGrid },
      { match: (u) => u.includes('/queries/200') && !u.includes('/order'), body: statusQuery },
    ]);
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 901, workPackageId: 5, toLane: 200 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('category');
  });

  test('lane with no resolvable value → error', async () => {
    // query with only the manualSort filter → laneValue returns null
    const valuelessQuery = queryHal({ id: 200, name: 'In progress', cards: [] });
    globalThis.fetch = routeFetch([
      { match: (u, m) => m === 'GET' && u.includes('/grids/900'), body: actionGrid },
      { match: (u) => u.includes('/queries/200') && !u.includes('/order'), body: valuelessQuery },
    ]);
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 900, workPackageId: 5, toLane: 200 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('In progress');
  });

  test('a second 409 propagates as an error (only one retry)', async () => {
    let patchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
      const method = opts?.method ?? 'GET';
      const respond = (status: number, b: unknown) =>
        Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(b)) });
      if (url.includes('/grids/900')) return respond(200, actionGrid);
      if (url.includes('/queries/200') && !url.includes('/order')) return respond(200, statusQuery);
      if (method === 'GET' && url.includes('/work_packages/5')) return respond(200, wpHal(5, 'X', { lockVersion: 11 }));
      if (method === 'PATCH' && url.includes('/work_packages/5')) { patchCount++; return respond(409, { _type: 'Error', message: 'stale' }); }
      throw new Error(`No route for ${method} ${url}`);
    });
    const server = makeServer();
    const result = await callTool(server, 'op_move_card', { boardId: 900, workPackageId: 5, toLane: 200 });
    expect(result.isError).toBe(true);
    expect(patchCount).toBe(2); // initial + one retry, then gives up
  });
});

describe('op_rebalance_lane', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('rewrites positions to even gaps preserving order (pos then id)', async () => {
    const patched: any[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, o: any) => {
      const method = o?.method ?? 'GET';
      const body = o?.body ? JSON.parse(o.body) : undefined;
      const respond = (b: unknown) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(b)) });
      if (method === 'GET' && url.includes('/grids/847')) return respond(freeGrid);
      if (url.includes('/queries/100/order')) {
        if (method === 'PATCH') { patched.push(body); return respond({ t: 'x' }); }
        return respond({ '7': 0, '3': 0, '5': -8192 }); // ties + out-of-order
      }
      const qm = url.match(/\/queries\/(\d+)/);
      if (method === 'GET' && qm) return respond(queryHal({ id: Number(qm[1]), name: Number(qm[1]) === 100 ? 'TODO' : 'IN PROGRESS', cards: [] }));
      throw new Error(`No route for ${method} ${url}`);
    });
    const server = makeServer();
    const result = await callTool(server, 'op_rebalance_lane', { boardId: 847, lane: 'TODO' });
    const data = JSON.parse(result.content[0].text);
    // visual order: 5 (-8192), then 3 and 7 tied at 0 → id tiebreak 3 before 7
    expect(data.lane).toBe('TODO');
    expect(data.order).toEqual({ '5': 0, '3': 8192, '7': 16384 });
    expect(patched).toHaveLength(1);
    expect(patched[0]).toEqual({ delta: { '5': 0, '3': 8192, '7': 16384 } });
  });

  test('custom gap', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string, o: any) => {
      const method = o?.method ?? 'GET';
      const respond = (b: unknown) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(b)) });
      if (method === 'GET' && url.includes('/grids/847')) return respond(freeGrid);
      if (url.includes('/queries/100/order')) return respond(method === 'PATCH' ? { t: 'x' } : { '1': 5, '2': 9 });
      const qm = url.match(/\/queries\/(\d+)/);
      if (method === 'GET' && qm) return respond(queryHal({ id: Number(qm[1]), name: Number(qm[1]) === 100 ? 'TODO' : 'IN PROGRESS', cards: [] }));
      throw new Error(`No route for ${method} ${url}`);
    });
    const server = makeServer();
    const result = await callTool(server, 'op_rebalance_lane', { boardId: 847, lane: 100, gap: 100 });
    const data = JSON.parse(result.content[0].text);
    expect(data.order).toEqual({ '1': 0, '2': 100 });
  });

  test('empty lane → no PATCH, empty order', async () => {
    const patched: any[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, o: any) => {
      const method = o?.method ?? 'GET';
      const respond = (b: unknown) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(b)) });
      if (method === 'GET' && url.includes('/grids/847')) return respond(freeGrid);
      if (url.includes('/queries/100/order')) { if (method === 'PATCH') { patched.push(1); return respond({ t: 'x' }); } return respond({}); }
      const qm = url.match(/\/queries\/(\d+)/);
      if (method === 'GET' && qm) return respond(queryHal({ id: Number(qm[1]), name: Number(qm[1]) === 100 ? 'TODO' : 'IN PROGRESS', cards: [] }));
      throw new Error(`No route for ${method} ${url}`);
    });
    const server = makeServer();
    const result = await callTool(server, 'op_rebalance_lane', { boardId: 847, lane: 'TODO' });
    const data = JSON.parse(result.content[0].text);
    expect(data.order).toEqual({});
    expect(patched).toHaveLength(0);
  });

  test('unknown lane → error listing available lanes', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string, o: any) => {
      const method = o?.method ?? 'GET';
      const respond = (b: unknown) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(b)) });
      if (method === 'GET' && url.includes('/grids/847')) return respond(freeGrid);
      const qm = url.match(/\/queries\/(\d+)/);
      if (method === 'GET' && qm) return respond(queryHal({ id: Number(qm[1]), name: Number(qm[1]) === 100 ? 'TODO' : 'IN PROGRESS', cards: [] }));
      throw new Error(`No route for ${method} ${url}`);
    });
    const server = makeServer();
    const result = await callTool(server, 'op_rebalance_lane', { boardId: 847, lane: 'NOPE' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('TODO');
  });
});

describe('computeInsertPosition', () => {
  test('empty lane → 0', () => {
    expect(computeInsertPosition([], 'bottom')).toBe(0);
    expect(computeInsertPosition([], 'top')).toBe(0);
    expect(computeInsertPosition([], 5)).toBe(0);
  });
  test('bottom → max + 8192', () => {
    expect(computeInsertPosition([-8192, 16384], 'bottom')).toBe(16384 + 8192);
  });
  test('top → min - 8192', () => {
    expect(computeInsertPosition([0, 8192], 'top')).toBe(-8192);
  });
  test('top guards the reserved -1 sentinel', () => {
    // min 8191 → 8191-8192 = -1 → must become -2
    expect(computeInsertPosition([8191], 'top')).toBe(-2);
  });
  test('numeric index inserts at midpoint between neighbors', () => {
    expect(computeInsertPosition([0, 8192], 1)).toBe(4096);
  });
  test('numeric index 0 → before first', () => {
    expect(computeInsertPosition([0, 8192], 0)).toBe(-8192);
  });
  test('numeric index past end → append', () => {
    expect(computeInsertPosition([0, 8192], 9)).toBe(8192 + 8192);
  });
  test('adjacent neighbors with no gap → append to bottom', () => {
    expect(computeInsertPosition([0, 1], 1)).toBe(1 + 8192);
  });
});

describe('resolveUniquePosition', () => {
  test('inserts midpoint between collision and next card up', () => {
    // collided at 0; next card up at 8192 → midpoint 4096
    expect(resolveUniquePosition([8192], 0)).toBe(4096);
  });
  test('no card above → push above by a gap', () => {
    expect(resolveUniquePosition([], 16384)).toBe(16384 + 8192);
    expect(resolveUniquePosition([-8192], 16384)).toBe(16384 + 8192);
  });
  test('adjacent next card (no room) → escalate above by a gap', () => {
    // collided at 0, next at 1 → no integer between → 0 + 8192
    expect(resolveUniquePosition([1], 0)).toBe(0 + 8192);
  });
  test('never returns the reserved -1', () => {
    // collided at -2, next at 0 → midpoint -1 → must escalate
    expect(resolveUniquePosition([0], -2)).not.toBe(-1);
  });
});

describe('board metadata helpers', () => {
  test('boardType reads options.type, defaulting to free', () => {
    expect(boardType(freeGrid as any)).toBe('free');
    expect(boardType(actionGrid as any)).toBe('action');
    expect(boardType({ options: {} } as any)).toBe('free');
  });
  test('actionAttribute is null for free boards, attribute for action', () => {
    expect(actionAttribute(freeGrid as any)).toBeNull();
    expect(actionAttribute(actionGrid as any)).toBe('status');
  });
  test('laneWidgets keeps query widgets sorted by startColumn', () => {
    const lanes = laneWidgets(freeGrid as any);
    expect(lanes.map((l) => l.queryId)).toEqual([100, 101]); // 100 is startColumn 1
  });
  test('laneValue returns first non-manualSort filter value', () => {
    const q = queryHal({
      id: 200,
      name: 'In progress',
      cards: [],
      extraFilters: [
        {
          _type: 'StatusQueryFilter',
          _links: {
            filter: { href: '/api/v3/queries/filters/status' },
            values: [{ href: '/api/v3/statuses/7', title: 'In progress' }],
          },
        },
      ],
    });
    expect(laneValue(q as any)).toEqual({ id: 7, title: 'In progress' });
  });
  test('laneValue is null when only manualSort filter present', () => {
    const q = queryHal({ id: 100, name: 'TODO', cards: [] });
    expect(laneValue(q as any)).toBeNull();
  });
});
