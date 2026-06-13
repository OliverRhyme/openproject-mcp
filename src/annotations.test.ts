import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Read-only tools: must carry readOnlyHint:true so Claude can auto-run them
// without a permission prompt (Claude connector review criteria).
const READ_ONLY = [
  'op_list_projects',
  'op_get_project',
  'op_count_projects',
  'op_list_work_packages',
  'op_get_work_package',
  'op_count_work_packages',
  'op_list_work_package_activities',
  'op_list_users',
  'op_get_user',
  'op_current_user',
  'op_list_types',
  'op_list_statuses',
  'op_list_priorities',
  'op_list_versions',
  'op_api_passthrough',
  'op_list_relations',
  'op_get_relation',
  'op_list_attachments',
  'op_get_attachment',
  'op_list_notifications',
  'op_get_notification',
  'op_list_watchers',
  'op_list_boards',
  'op_get_board',
  'op_list_board_lanes',
];

// Writes that create/modify but do not delete data.
const WRITE = [
  'op_create_project',
  'op_update_project',
  'op_create_work_package',
  'op_update_work_package',
  'op_comment_work_package',
  'op_create_relation',
  'op_upload_attachment',
  'op_add_watcher',
  'op_mark_notification_read',
  'op_mark_all_notifications_read',
  'op_move_card',
  'op_rebalance_lane',
];

// Destructive tools: must carry destructiveHint:true so Claude always confirms.
const DESTRUCTIVE = [
  'op_delete_project',
  'op_delete_work_package',
  'op_delete_relation',
  'op_delete_attachment',
  'op_remove_watcher',
];

function annotationsOf(server: McpServer, name: string) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.annotations as
    | {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        openWorldHint?: boolean;
      }
    | undefined;
}

describe('tool annotations', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let server: McpServer;

  beforeEach(async () => {
    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      OPENPROJECT_BASE_URL: 'https://op.example.com',
      OPENPROJECT_API_KEY: 'test-key',
    };
    const mod = await import('./index.js');
    server = mod.createServer();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('every registered tool is classified read/write/destructive', () => {
    const registered = Object.keys((server as any)._registeredTools);
    const classified = new Set([...READ_ONLY, ...WRITE, ...DESTRUCTIVE]);
    const unclassified = registered.filter((n) => !classified.has(n));
    expect(unclassified).toEqual([]);
    const missing = [...classified].filter((n) => !registered.includes(n));
    expect(missing).toEqual([]);
  });

  test.each(READ_ONLY)('%s carries readOnlyHint:true', (name) => {
    expect(annotationsOf(server, name)?.readOnlyHint).toBe(true);
  });

  test.each([...WRITE, ...DESTRUCTIVE])('%s carries readOnlyHint:false', (name) => {
    expect(annotationsOf(server, name)?.readOnlyHint).toBe(false);
  });

  test.each(DESTRUCTIVE)('%s carries destructiveHint:true', (name) => {
    expect(annotationsOf(server, name)?.destructiveHint).toBe(true);
  });

  test.each(WRITE)('%s carries destructiveHint:false', (name) => {
    expect(annotationsOf(server, name)?.destructiveHint).toBe(false);
  });

  test('op_api_passthrough carries openWorldHint:true', () => {
    expect(annotationsOf(server, 'op_api_passthrough')?.openWorldHint).toBe(true);
  });

  test('op_api_passthrough description names the OpenProject API', () => {
    const tool = (server as any)._registeredTools['op_api_passthrough'];
    expect(tool.description).toMatch(/OpenProject/);
  });
});
