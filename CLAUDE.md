# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server that bridges Claude (or any MCP client) to OpenProject's REST API v3. It speaks stdio JSON-RPC and exposes ~20 typed tools covering projects, work packages, users, and reference data.

## Architecture

The code is intentionally flat. Read these files in order to understand the system:

- `src/index.ts` — entry point. Builds an `McpServer`, registers tool modules, connects `StdioServerTransport`.
- `src/config.ts` — env-var loader. The only side effect that can fail at startup; validates `OPENPROJECT_BASE_URL` and `OPENPROJECT_API_KEY`.
- `src/client.ts` — thin `fetch` wrapper. All tools go through this. Adds HTTP Basic auth (`apikey:$KEY`), serializes OpenProject's `filters`/`sortBy` JSON query params, and throws `ApiError` with `status` + parsed `body` on non-2xx.
- `src/hal.ts` — HAL+JSON helpers. OpenProject returns hypermedia documents with `_links` and `_embedded.elements`; the `summarize*` functions collapse these into flat objects so tool output stays small. The `raw: true` input flag on most list/get tools bypasses summarization and returns the full HAL document.
- `src/toolResult.ts` — `tryTool()` wraps every tool handler so API failures become `isError` tool responses instead of crashing the server.
- `src/tools/{projects,workPackages,users,reference}.ts` — one `registerXTools()` function per domain; each calls `server.registerTool('op_…', { title, description, inputSchema }, handler)`.

## Tool naming convention

All tools are prefixed `op_` so they don't collide with other MCP servers a user has installed. Keep this prefix for any new tools.

## Critical OpenProject semantics

- **`lockVersion` is mandatory on PATCH work packages.** OpenProject uses optimistic locking; the update will be rejected if `lockVersion` isn't passed or is stale. `op_update_work_package` requires it explicitly — fetch the current value via `op_get_work_package` first. This is the most common gotcha.
- **`description` fields are objects, not strings.** OpenProject expects `{ "raw": "markdown text" }` on create/update. The client helpers handle this; if you add new endpoints that touch description-like fields (comments, custom fields with formattable text), wrap raw strings the same way.
- **Foreign keys go through `_links`.** Status, assignee, type, priority, project, parent — all of these are HAL links of the form `{ "href": "/api/v3/<collection>/<id>" }`, not plain id fields. The `linkRef()` helper in `tools/workPackages.ts` is the canonical pattern.
- **Filter values are always strings, even for ids and booleans.** OpenProject expects `{ "operator": "=", "values": ["42"] }`, not `[42]`. The shared zod filter schema enforces `z.array(z.string()).nullable()`.
- **`/projects/{id}/work_packages` is deprecated** in favor of `/workspaces/{id}/work_packages` per the OpenProject docs, but the project-scoped path still works on current releases. We use it because workspaces aren't universal yet. Revisit if OpenProject 16+ drops compatibility.

## Commands

```bash
npm install          # install deps
npm run build        # compile TS → dist/
npm run typecheck    # tsc --noEmit
npm run dev          # tsx watch mode (no build step)
npm start            # node dist/index.js (needs build)
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

There is no test suite yet. End-to-end testing requires hitting a real OpenProject instance with a valid API token (`community.openproject.org` works for read-only smoke checks against public projects).

## Adding a new tool

1. Pick the domain file under `src/tools/` (or create one and import it from `src/index.ts`).
2. Inside the `registerXTools(server, client)` function, call `server.registerTool(name, { title, description, inputSchema }, handler)`.
3. `inputSchema` is an **object of zod fields**, not a zod object — the SDK wraps it. Use `z.string()`, `z.number().int().positive()`, etc.
4. Wrap the handler body in `tryTool(async () => { ... return json(...) })` so errors surface as structured tool errors instead of crashing the transport.
5. For list endpoints, accept the shared filter/sortBy/pageSize inputs and pass them through `client.get(path, params)`; the client serializes them.
6. Return a `summarize*` view by default and provide a `raw: boolean` input for callers who need the full HAL document.

## Dependency notes

- `@modelcontextprotocol/sdk` is pinned to the v1.x line. The repo's `main` branch is v2 pre-alpha — do **not** upgrade past `^1` until v2 is stable. Imports come from `@modelcontextprotocol/sdk/server/mcp.js` and `@modelcontextprotocol/sdk/server/stdio.js` (note the `.js` extension is required by NodeNext resolution even though the source is `.ts`).
- `zod` v3 is used because that's what the SDK currently re-exports. v4 also works but isn't required.
