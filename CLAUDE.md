# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server that bridges Claude (or any MCP client) to OpenProject's REST API v3. It speaks stdio JSON-RPC and exposes ~40 typed tools covering projects, work packages, users, reference data, relations, attachments, notifications, watchers, and boards.

## Architecture

The code is intentionally flat. Read these files in order to understand the system:

- `src/index.ts` — entry point. Builds an `McpServer`, registers tool modules, connects `StdioServerTransport`.
- `src/config.ts` — env-var loader. The only side effect that can fail at startup; validates `OPENPROJECT_BASE_URL` and `OPENPROJECT_API_KEY`.
- `src/client.ts` — thin `fetch` wrapper. All tools go through this. Adds HTTP Basic auth (`apikey:$KEY`), serializes OpenProject's `filters`/`sortBy` JSON query params, and throws `ApiError` with `status` + parsed `body` on non-2xx.
- `src/hal.ts` — HAL+JSON helpers. OpenProject returns hypermedia documents with `_links` and `_embedded.elements`; the `summarize*` functions collapse these into flat objects so tool output stays small. The `raw: true` input flag on most list/get tools bypasses summarization and returns the full HAL document.
- `src/toolResult.ts` — `tryTool()` wraps every tool handler so API failures become `isError` tool responses instead of crashing the server.
- `src/tools/{projects,workPackages,users,reference,relations,attachments,notifications,watchers,boards}.ts` — one `registerXTools()` function per domain; each calls `server.registerTool('op_…', { title, description, inputSchema, annotations }, handler)`. Every tool carries `annotations` (`readOnlyHint`/`destructiveHint`) — see "Tool annotations" below.

## Tool naming convention

All tools are prefixed `op_` so they don't collide with other MCP servers a user has installed. Keep this prefix for any new tools.

## Tool annotations

Every tool **must** declare `annotations` so Claude (and the connector review process) can reason about safety:

- **Read-only tools** (`op_list_*`, `op_get_*`, `op_count_*`, `op_current_user`, `op_api_passthrough`): `annotations: { readOnlyHint: true }`. Read-only tools can auto-run without a permission prompt, so this also improves UX.
- **Writes that create/modify** (`op_create_*`, `op_update_*`, `op_comment_*`, `op_upload_*`, `op_add_*`, `op_mark_*`, `op_move_card`, `op_rebalance_lane`): `annotations: { readOnlyHint: false, destructiveHint: false }`.
- **Destructive writes** (`op_delete_*`, `op_remove_watcher`): `annotations: { readOnlyHint: false, destructiveHint: true }` — Claude always confirms before running these.
- `op_api_passthrough` also sets `openWorldHint: true` (freeform endpoint) and names the OpenProject API in its description, per Claude's connector review criteria.

`src/annotations.test.ts` asserts the full classification and **fails if any registered tool is left unclassified** — add new tools to its READ_ONLY/WRITE/DESTRUCTIVE lists.

## Critical OpenProject semantics

- **`lockVersion` is mandatory on PATCH work packages.** OpenProject uses optimistic locking; the update will be rejected if `lockVersion` isn't passed or is stale. `op_update_work_package` requires it explicitly — fetch the current value via `op_get_work_package` first. This is the most common gotcha.
- **`description` fields are objects, not strings.** OpenProject expects `{ "raw": "markdown text" }` on create/update. The client helpers handle this; if you add new endpoints that touch description-like fields (comments, custom fields with formattable text), wrap raw strings the same way.
- **Foreign keys go through `_links`.** Status, assignee, type, priority, project, parent — all of these are HAL links of the form `{ "href": "/api/v3/<collection>/<id>" }`, not plain id fields. The `linkRef()` helper in `tools/workPackages.ts` is the canonical pattern.
- **Filter values are always strings, even for ids and booleans.** OpenProject expects `{ "operator": "=", "values": ["42"] }`, not `[42]`. The shared zod filter schema enforces `z.array(z.string()).nullable()`.
- **`/projects/{id}/work_packages` is deprecated** in favor of `/workspaces/{id}/work_packages` per the OpenProject docs, but the project-scoped path still works on current releases. We use it because workspaces aren't universal yet. Revisit if OpenProject 16+ drops compatibility.
- **Board lanes are query-backed.** A board is a Grid; each lane is a column widget pointing at a `queryId`, and the lane name is the **query's** name. Free boards (`grid.options.type === 'free'`) store lane membership as manual ordering — move a card with `PATCH /api/v3/queries/{id}/order` body `{ "delta": { "<wpId>": position } }` (`-1` removes; the `updateOrderedWorkPackages` HAL link wrongly advertises PUT — use PATCH). Action boards (`type === 'action'`, `options.attribute` = status/assignee/version/subproject) store membership as the work package's attribute — move by PATCHing that `_link`. `op_list_board_lanes` and `op_move_card` encapsulate both. The free-board order endpoint has no optimistic locking, so `op_move_card` verifies after writing — it re-reads the target to resolve position collisions, re-checks the source before removing, and reports the card's final lane membership with a `warning` if it isn't in exactly one lane (a concurrent same-card move). `op_rebalance_lane` rewrites a lane's positions to clean even gaps to fix accumulated ties/drift.

## Commands

```bash
npm install          # install deps
npm run build        # compile TS → dist/
npm run typecheck    # tsc --noEmit
npm run dev          # tsx watch mode (no build step)
npm start            # node dist/index.js (needs build)
npm test             # vitest run (full suite)
npm run test:watch   # vitest watch mode
```

Smoke test without a real OpenProject instance — confirms the server boots and lists tools:

```bash
OPENPROJECT_BASE_URL=https://example.openproject.com OPENPROJECT_API_KEY=fake \
  node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
EOF
```

There is a vitest unit suite (`npm test`) covering every tool module, the client, HAL helpers, config, and tool annotations — `fetch` is mocked, so it runs offline. End-to-end testing still requires hitting a real OpenProject instance with a valid API token (`community.openproject.org` works for read-only smoke checks against public projects).

## Output optimization

Several mechanisms keep tool output small and context-window-friendly:

- **Summarization by default.** All list/get tools return flat summaries via `summarize*` helpers. The `raw: true` flag bypasses this for callers who need the full HAL document.
- **Description truncation.** `summarizeProject` truncates descriptions to 200 chars in list mode. `op_list_work_package_activities` truncates comments to 500 chars (use `full: true` for complete text). Single-item get tools always return full text.
- **`fields` parameter.** List tools for work packages, projects, users, and notifications accept `fields: string[]` to return only specified fields per element (e.g. `["id","subject","status"]`). Uses `pickFields()` from `hal.ts`.
- **Page size cap.** All list tools cap `pageSize` at 100 (default remains 25). This prevents accidental multi-MB responses.
- **`hasMore` flag.** `paginationMeta()` includes `hasMore: boolean` so callers know whether more pages exist without computing it themselves.
- **Aggregation tools.** `op_count_work_packages` and `op_count_projects` return only the total count matching filters (fetches `pageSize=1` internally). Use these instead of listing when you only need a number.

When adding new list tools, follow these patterns: accept `fields` and `pageSize` (max 100), truncate long text in list mode, and use `paginationMeta()` for consistent pagination metadata.

## Adding a new tool

1. Pick the domain file under `src/tools/` (or create one and import it from `src/index.ts`).
2. Inside the `registerXTools(server, client)` function, call `server.registerTool(name, { title, description, inputSchema, annotations }, handler)`.
3. Set `annotations` (`readOnlyHint`/`destructiveHint`, plus `openWorldHint` for freeform endpoints) per the "Tool annotations" section, and add the new tool to the matching list in `src/annotations.test.ts` (its "every registered tool is classified" test will fail otherwise).
4. `inputSchema` is an **object of zod fields**, not a zod object — the SDK wraps it. Use `z.string()`, `z.number().int().positive()`, etc.
5. Wrap the handler body in `tryTool(async () => { ... return json(...) })` so errors surface as structured tool errors instead of crashing the transport.
6. For list endpoints, accept the shared filter/sortBy/pageSize inputs and pass them through `client.get(path, params)`; the client serializes them.
7. Return a `summarize*` view by default and provide a `raw: boolean` input for callers who need the full HAL document.

## Dependency notes

- `@modelcontextprotocol/sdk` is pinned to the v1.x line. The repo's `main` branch is v2 pre-alpha — do **not** upgrade past `^1` until v2 is stable. Imports come from `@modelcontextprotocol/sdk/server/mcp.js` and `@modelcontextprotocol/sdk/server/stdio.js` (note the `.js` extension is required by NodeNext resolution even though the source is `.ts`).
- `zod` v3 is used because that's what the SDK currently re-exports. v4 also works but isn't required.
