import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient, type Filter } from '../client.js';
import {
  extractElements,
  paginationMeta,
  pickFields,
  summarizeWorkPackage,
  truncate,
  type HalCollection,
  type HalResource,
} from '../hal.js';
import { json, tryTool } from '../toolResult.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const filterSchema = z
  .array(
    z.object({
      field: z.string(),
      operator: z.string(),
      values: z.array(z.string()).nullable(),
    }),
  )
  .optional();

const linkRef = (id: number | string | undefined, collection: string): string | undefined =>
  id === undefined ? undefined : `/api/v3/${collection}/${id}`;

export function registerWorkPackageTools(server: McpServer, client: OpenProjectClient) {
  server.registerTool(
    'op_list_work_packages',
    {
      title: 'List work packages',
      description:
        'List work packages, optionally scoped to a project. Supports OpenProject filter syntax. ' +
        'Common filter fields: "status_id", "assignee", "project", "type", "priority", "subject" ("~" search), "updatedAt".',
      inputSchema: {
        projectIdOrIdentifier: z
          .string()
          .optional()
          .describe('If set, lists work packages for that project; otherwise lists across all projects'),
        filters: filterSchema,
        sortBy: z.array(z.tuple([z.string(), z.enum(['asc', 'desc'])])).optional(),
        groupBy: z.string().optional(),
        offset: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().max(100).optional().describe('Max 100'),
        fields: z.array(z.string()).optional().describe('Return only these fields per element, e.g. ["id","subject","status"]'),
        raw: z.boolean().optional(),
      },
    },
    async ({ projectIdOrIdentifier, filters, sortBy, groupBy, offset, pageSize, fields, raw }) =>
      tryTool(async () => {
        const path = projectIdOrIdentifier
          ? `/projects/${encodeURIComponent(projectIdOrIdentifier)}/work_packages`
          : '/work_packages';
        const data = await client.get<HalCollection>(path, {
          filters: filters as Filter[] | undefined,
          sortBy,
          groupBy,
          offset,
          pageSize,
        });
        if (raw) return json(data);
        return json({
          ...paginationMeta(data),
          elements: extractElements(data).map((wp) => pickFields(summarizeWorkPackage(wp), fields)),
        });
      }),
  );

  server.registerTool(
    'op_get_work_package',
    {
      title: 'Get work package',
      description: 'Fetch a single work package by numeric id with full HAL detail.',
      inputSchema: {
        id: z.number().int().positive(),
        raw: z.boolean().optional(),
      },
    },
    async ({ id, raw }) =>
      tryTool(async () => {
        const data = await client.get<HalResource>(`/work_packages/${id}`);
        if (raw) return json(data);
        return json({
          ...summarizeWorkPackage(data),
          description: (data.description as { raw?: string } | undefined)?.raw ?? null,
        });
      }),
  );

  server.registerTool(
    'op_create_work_package',
    {
      title: 'Create work package',
      description:
        'Create a work package in a project. At minimum provide subject, projectId, and typeId. ' +
        'When patching dates use ISO YYYY-MM-DD strings. ',
      inputSchema: {
        projectId: z.union([z.number(), z.string()]).describe('Numeric project id or identifier slug'),
        subject: z.string().min(1),
        typeId: z.number().int().positive().describe('Use op_list_types to discover available type ids'),
        description: z.string().optional(),
        statusId: z.number().int().positive().optional(),
        priorityId: z.number().int().positive().optional(),
        assigneeId: z.number().int().positive().optional(),
        parentId: z.number().int().positive().optional(),
        startDate: z.string().optional().describe('YYYY-MM-DD'),
        dueDate: z.string().optional().describe('YYYY-MM-DD'),
        estimatedTime: z.string().optional().describe('ISO 8601 duration, e.g. PT4H'),
        notify: z.boolean().optional().describe('Send notifications about the creation (default true)'),
      },
    },
    async ({
      projectId,
      subject,
      typeId,
      description,
      statusId,
      priorityId,
      assigneeId,
      parentId,
      startDate,
      dueDate,
      estimatedTime,
      notify,
    }) =>
      tryTool(async () => {
        const body: Record<string, unknown> = { subject };
        if (description) body.description = { raw: description };
        if (startDate) body.startDate = startDate;
        if (dueDate) body.dueDate = dueDate;
        if (estimatedTime) body.estimatedTime = estimatedTime;

        const links: Record<string, { href: string }> = {
          project: { href: linkRef(projectId, 'projects')! },
          type: { href: linkRef(typeId, 'types')! },
        };
        const status = linkRef(statusId, 'statuses');
        if (status) links.status = { href: status };
        const priority = linkRef(priorityId, 'priorities');
        if (priority) links.priority = { href: priority };
        const assignee = linkRef(assigneeId, 'users');
        if (assignee) links.assignee = { href: assignee };
        const parent = linkRef(parentId, 'work_packages');
        if (parent) links.parent = { href: parent };
        body._links = links;

        const url =
          typeof projectId === 'string' && Number.isNaN(Number(projectId))
            ? `/projects/${encodeURIComponent(projectId)}/work_packages${notify === false ? '?notify=false' : ''}`
            : `/work_packages${notify === false ? '?notify=false' : ''}`;

        const data = await client.post<HalResource>(url, body);
        return json(summarizeWorkPackage(data));
      }),
  );

  server.registerTool(
    'op_update_work_package',
    {
      title: 'Update work package',
      description:
        'Patch fields on a work package. You MUST pass the current lockVersion (fetch it first with op_get_work_package) ' +
        'or OpenProject will reject the update with a stale-object error.',
      inputSchema: {
        id: z.number().int().positive(),
        lockVersion: z.number().int().nonnegative(),
        subject: z.string().optional(),
        description: z.string().optional(),
        statusId: z.number().int().positive().optional(),
        priorityId: z.number().int().positive().optional(),
        assigneeId: z.number().int().positive().nullable().optional().describe('Set null to unassign'),
        startDate: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        percentageDone: z.number().int().min(0).max(100).optional(),
        estimatedTime: z.string().nullable().optional(),
        notify: z.boolean().optional(),
      },
    },
    async ({
      id,
      lockVersion,
      subject,
      description,
      statusId,
      priorityId,
      assigneeId,
      startDate,
      dueDate,
      percentageDone,
      estimatedTime,
      notify,
    }) =>
      tryTool(async () => {
        const body: Record<string, unknown> = { lockVersion };
        if (subject !== undefined) body.subject = subject;
        if (description !== undefined) body.description = { raw: description };
        if (startDate !== undefined) body.startDate = startDate;
        if (dueDate !== undefined) body.dueDate = dueDate;
        if (percentageDone !== undefined) body.percentageDone = percentageDone;
        if (estimatedTime !== undefined) body.estimatedTime = estimatedTime;

        const links: Record<string, { href: string | null }> = {};
        if (statusId !== undefined) links.status = { href: `/api/v3/statuses/${statusId}` };
        if (priorityId !== undefined) links.priority = { href: `/api/v3/priorities/${priorityId}` };
        if (assigneeId !== undefined) {
          links.assignee = {
            href: assigneeId === null ? null : `/api/v3/users/${assigneeId}`,
          };
        }
        if (Object.keys(links).length > 0) body._links = links;

        const data = await client.patch<HalResource>(
          `/work_packages/${id}${notify === false ? '?notify=false' : ''}`,
          body,
        );
        return json(summarizeWorkPackage(data));
      }),
  );

  server.registerTool(
    'op_delete_work_package',
    {
      title: 'Delete work package',
      description: 'Permanently delete a work package. Destructive.',
      inputSchema: { id: z.number().int().positive() },
    },
    async ({ id }) =>
      tryTool(async () => {
        await client.delete(`/work_packages/${id}`);
        return json({ deleted: id });
      }),
  );

  server.registerTool(
    'op_list_work_package_activities',
    {
      title: 'List work package activities',
      description:
        'List activities (comments and changes) on a work package, oldest first. Comments are truncated to 500 chars by default; use full=true for complete text.',
      inputSchema: {
        id: z.number().int().positive(),
        full: z.boolean().optional().describe('Return full comment text instead of truncated'),
        raw: z.boolean().optional(),
      },
    },
    async ({ id, full, raw }) =>
      tryTool(async () => {
        const data = await client.get<HalCollection>(`/work_packages/${id}/activities`);
        if (raw) return json(data);
        return json({
          ...paginationMeta(data),
          elements: extractElements(data).map((a) => {
            const commentRaw = (a.comment as { raw?: string } | undefined)?.raw ?? null;
            return {
              id: a.id,
              createdAt: a.createdAt,
              comment: full ? commentRaw : truncate(commentRaw, 500),
              details: ((a.details as { raw?: string }[] | undefined) ?? []).map((d) => d.raw),
              version: a.version,
              attachmentRefs: extractAttachmentRefs(commentRaw),
            };
          }),
        });
      }),
  );

  server.registerTool(
    'op_comment_work_package',
    {
      title: 'Comment on work package',
      description:
        'Add a markdown comment to a work package activity stream. ' +
        'Optionally attach a file and embed it inline using attachFilePath.',
      inputSchema: {
        id: z.number().int().positive(),
        comment: z.string().min(1),
        notify: z.boolean().optional(),
        attachFilePath: z.string().optional()
          .describe('Local file path to upload and embed inline as ![](attachment:filename)'),
        attachFileName: z.string().optional()
          .describe('Override attached file name (defaults to basename of attachFilePath)'),
      },
    },
    async ({ id, comment, notify, attachFilePath, attachFileName }) =>
      tryTool(async () => {
        let finalComment = comment;

        if (attachFilePath) {
          const fileBuffer = await readFile(attachFilePath);
          const name = attachFileName ?? basename(attachFilePath);

          const formData = new FormData();
          formData.append('metadata', JSON.stringify({ fileName: name }));
          formData.append('file', new Blob([fileBuffer]), name);

          const attachment = await client.postFormData<HalResource>(
            `/work_packages/${id}/attachments`,
            formData,
          );
          const attachedName = (attachment.fileName as string) ?? name;
          finalComment = `${comment}\n\n![](attachment:${attachedName})`;
        }

        const data = await client.post<HalResource>(
          `/work_packages/${id}/activities${notify === false ? '?notify=false' : ''}`,
          { comment: { raw: finalComment } },
        );
        return json({
          id: data.id,
          createdAt: data.createdAt,
          comment: (data.comment as { raw?: string } | undefined)?.raw ?? null,
        });
      }),
  );
  server.registerTool(
    'op_count_work_packages',
    {
      title: 'Count work packages',
      description:
        'Return only the total count of work packages matching filters. Much cheaper than listing when you only need a number. ' +
        'Supports the same filter syntax as op_list_work_packages.',
      inputSchema: {
        projectIdOrIdentifier: z.string().optional(),
        filters: filterSchema,
      },
    },
    async ({ projectIdOrIdentifier, filters }) =>
      tryTool(async () => {
        const path = projectIdOrIdentifier
          ? `/projects/${encodeURIComponent(projectIdOrIdentifier)}/work_packages`
          : '/work_packages';
        const data = await client.get<HalCollection>(path, {
          filters: filters as Filter[] | undefined,
          pageSize: 1,
        });
        return json({ total: data.total ?? 0 });
      }),
  );
}

function extractAttachmentRefs(comment: string | null): string[] {
  if (!comment) return [];
  const matches = comment.matchAll(/attachment:([^\s)]+)/g);
  return [...matches].map((m) => m[1]!);
}
