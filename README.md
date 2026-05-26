# openproject-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes the
[OpenProject](https://www.openproject.org) REST API (v3) as tools usable by
Claude Desktop, Claude Code, Cursor, and any other MCP client.

## Install

> **Before you start:** you need an OpenProject API token. Get one from
> _My account > Access tokens > API_ in your OpenProject instance.

Pick your MCP client and run one command:

### Claude Code

```bash
claude mcp add openproject \
  --env OPENPROJECT_BASE_URL=https://your-instance.openproject.com \
  --env OPENPROJECT_API_KEY=your-token \
  -- npx -y github:OliverRhyme/openproject-mcp
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "openproject": {
      "command": "npx",
      "args": ["-y", "github:OliverRhyme/openproject-mcp"],
      "env": {
        "OPENPROJECT_BASE_URL": "https://your-instance.openproject.com",
        "OPENPROJECT_API_KEY": "your-token"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "openproject": {
      "command": "npx",
      "args": ["-y", "github:OliverRhyme/openproject-mcp"],
      "env": {
        "OPENPROJECT_BASE_URL": "https://your-instance.openproject.com",
        "OPENPROJECT_API_KEY": "your-token"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "openproject": {
      "command": "npx",
      "args": ["-y", "github:OliverRhyme/openproject-mcp"],
      "env": {
        "OPENPROJECT_BASE_URL": "https://your-instance.openproject.com",
        "OPENPROJECT_API_KEY": "your-token"
      }
    }
  }
}
```

### Any other MCP client (generic stdio)

Run this as the server process:

```bash
OPENPROJECT_BASE_URL=https://your-instance.openproject.com \
OPENPROJECT_API_KEY=your-token \
npx -y github:OliverRhyme/openproject-mcp
```

The server speaks JSON-RPC over stdio. No build step needed — `npx` fetches, installs, and runs it directly from GitHub.

## Configuration

| Variable                 | Required | Default | Notes                                    |
| ------------------------ | -------- | ------- | ---------------------------------------- |
| `OPENPROJECT_BASE_URL`   | yes      | --      | e.g. `https://community.openproject.org` |
| `OPENPROJECT_API_KEY`    | yes      | --      | From _My account > Access tokens > API_  |
| `OPENPROJECT_PAGE_SIZE`  | no       | `25`    | Default page size for list endpoints     |
| `OPENPROJECT_TIMEOUT_MS` | no       | `30000` | HTTP request timeout in milliseconds     |

## Features

- **Projects** -- list, get, create, update, delete, count
- **Work packages** -- list, get, create, update (with `lockVersion`), delete, activity/comment thread, inline file attachments on comments, count
- **Relations** -- list, get, create, delete (blocks, precedes, relates, duplicates, etc.)
- **Attachments** -- list, get (with download), upload (with auto-embed in description or comment), delete
- **Users** -- current user, list, get
- **Notifications** -- list, get, mark read, mark all read
- **Watchers** -- list, add, remove watchers on work packages
- **Boards** -- list and get Kanban-style boards
- **Reference data** -- work package types, statuses, priorities, versions
- **Raw passthrough** -- call any GET endpoint under `/api/v3` directly
- Filter, sort, group, and paginate via OpenProject's native query syntax
- **Output optimization** -- field selection, description truncation, `hasMore` pagination flag, lightweight count tools

## Tools reference

All tools are prefixed `op_` to avoid collisions with other MCP servers.

### Projects

| Tool                  | Description                              |
| --------------------- | ---------------------------------------- |
| `op_list_projects`    | List projects with filter/sort/paginate  |
| `op_get_project`      | Get project by id or identifier slug     |
| `op_create_project`   | Create a new project                     |
| `op_update_project`   | Patch project fields                     |
| `op_delete_project`   | Delete a project (destructive, async)    |
| `op_count_projects`   | Count projects matching filters          |

### Work packages

| Tool                              | Description                                                       |
| --------------------------------- | ----------------------------------------------------------------- |
| `op_list_work_packages`           | List work packages, optionally scoped to a project                |
| `op_get_work_package`             | Get a single work package by id                                   |
| `op_create_work_package`          | Create a work package (requires subject, projectId, typeId)       |
| `op_update_work_package`          | Patch work package fields (requires `lockVersion`)                |
| `op_delete_work_package`          | Delete a work package (destructive)                               |
| `op_list_work_package_activities` | List comments and change history                                  |
| `op_comment_work_package`         | Add a comment, optionally attaching and embedding a file inline   |
| `op_count_work_packages`          | Count work packages matching filters                              |

### Relations

| Tool                 | Description                                                                      |
| -------------------- | -------------------------------------------------------------------------------- |
| `op_list_relations`  | List relations on a work package (blocks, precedes, duplicates, etc.)             |
| `op_get_relation`    | Get a single relation by id                                                      |
| `op_create_relation` | Create a relation between two work packages                                      |
| `op_delete_relation` | Delete a relation                                                                |

### Attachments

| Tool                   | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `op_list_attachments`  | List attachments on a work package                                       |
| `op_get_attachment`    | Get attachment metadata; optionally download to a local path             |
| `op_upload_attachment` | Upload a local file; optionally embed in a comment or WP description     |
| `op_delete_attachment` | Delete an attachment (destructive)                                       |

### Users

| Tool              | Description                               |
| ----------------- | ----------------------------------------- |
| `op_current_user` | Get the user tied to the configured API key |
| `op_list_users`   | List users with filter/sort/paginate      |
| `op_get_user`     | Get a user by id                          |

### Notifications

| Tool                           | Description                                   |
| ------------------------------ | --------------------------------------------- |
| `op_list_notifications`        | List in-app notifications for the current user |
| `op_get_notification`          | Get a single notification by id               |
| `op_mark_notification_read`    | Mark one notification as read                 |
| `op_mark_all_notifications_read` | Mark all notifications as read              |

### Watchers

| Tool                | Description                            |
| ------------------- | -------------------------------------- |
| `op_list_watchers`  | List users watching a work package     |
| `op_add_watcher`    | Add a user as a watcher                |
| `op_remove_watcher` | Remove a user from watching            |

### Boards

| Tool              | Description                                    |
| ----------------- | ---------------------------------------------- |
| `op_list_boards`  | List Kanban-style boards for a project         |
| `op_get_board`    | Get board details including column config       |

### Reference data

| Tool                | Description                                         |
| ------------------- | --------------------------------------------------- |
| `op_list_types`     | List work package types (Task, Bug, Feature, etc.)  |
| `op_list_statuses`  | List all work package statuses                      |
| `op_list_priorities` | List all priorities                                |
| `op_list_versions`  | List versions/milestones, optionally per project    |
| `op_api_passthrough` | Raw GET against any `/api/v3` path (escape hatch)  |

## Usage patterns

### Filter syntax

List endpoints accept OpenProject's structured filter format:

```jsonc
{
  "projectIdOrIdentifier": "web",
  "filters": [
    { "field": "status_id", "operator": "o", "values": null },
    { "field": "assignee", "operator": "=", "values": ["42"] },
    { "field": "type", "operator": "=", "values": ["1"] }
  ],
  "sortBy": [["updatedAt", "desc"]],
  "pageSize": 50
}
```

Common operators:

| Operator | Meaning              |
| -------- | -------------------- |
| `=`      | Equals               |
| `!`      | Not equals           |
| `~`      | Contains (substring) |
| `o`      | Open statuses        |
| `c`      | Closed statuses      |
| `>=`     | Greater or equal     |
| `<=`     | Less or equal        |
| `*`      | Any (not empty)      |
| `!*`     | None (empty)         |

Filter values are always strings, even for numeric ids: `"values": ["42"]`, not `[42]`.

### Output optimization

List tools return summarized output by default. Several options keep responses small:

**`fields`** -- Return only specific fields per element:
```jsonc
// op_list_work_packages
{ "fields": ["id", "subject", "status"] }
// -> elements contain only { id, subject, status }
```

**`raw`** -- Get the full HAL+JSON document from OpenProject:
```jsonc
// op_get_work_package
{ "id": 17, "raw": true }
```

**Count tools** -- When you only need a number, use `op_count_work_packages` or `op_count_projects` instead of listing:
```jsonc
// op_count_work_packages
{ "projectIdOrIdentifier": "web", "filters": [{ "field": "status_id", "operator": "o", "values": null }] }
// -> { "total": 42 }
```

**Pagination** -- All list responses include `hasMore: true|false` so you know if there are more pages. Max `pageSize` is 100; default is 25.

**Truncation** -- Project descriptions are truncated to 200 chars in list mode. Activity comments are truncated to 500 chars by default; pass `full: true` to `op_list_work_package_activities` for complete text.

### Updating work packages (lockVersion)

OpenProject uses optimistic locking. You must pass the current `lockVersion`
when updating a work package -- fetch it first with `op_get_work_package`:

```jsonc
// 1. Get current state
// op_get_work_package { "id": 17 }
// -> { ..., "lockVersion": 4 }

// 2. Update with lockVersion
// op_update_work_package
{
  "id": 17,
  "lockVersion": 4,
  "statusId": 7,
  "percentageDone": 50
}
```

### Uploading and embedding attachments

Upload a file and auto-embed it as an image in a comment:

```jsonc
// op_upload_attachment
{
  "workPackageId": 17,
  "filePath": "/path/to/screenshot.png",
  "embedIn": "comment",
  "embedText": "Here's the updated design:"
}
```

Or attach a file when commenting:

```jsonc
// op_comment_work_package
{
  "id": 17,
  "comment": "Fixed in latest build, see attached screenshot.",
  "attachFilePath": "/path/to/screenshot.png"
}
```

### Creating relations

Link work packages with dependency or reference relations:

```jsonc
// op_create_relation
{
  "fromId": 17,
  "toId": 23,
  "type": "blocks"
}
```

Relation types: `relates`, `duplicates`, `blocks`, `precedes`, `follows`,
`includes`, `partOf`, `requires`.

## Local development

```bash
git clone https://github.com/OliverRhyme/openproject-mcp.git
cd openproject-mcp
npm install
npm run dev
```

| Command              | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `npm install`        | Install dependencies                      |
| `npm run build`      | Compile TypeScript to `dist/`             |
| `npm start`          | Run the compiled server (requires build)  |
| `npm run dev`        | Watch-mode server via `tsx` (no build)    |
| `npm test`           | Run test suite                            |
| `npm run test:watch` | Run tests in watch mode                   |
| `npm run typecheck`  | Type-check without emitting               |

### Smoke test

Verify the server boots and lists tools without a real OpenProject instance:

```bash
OPENPROJECT_BASE_URL=https://example.openproject.com OPENPROJECT_API_KEY=fake \
  node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
EOF
```

## License

MIT
