import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenProjectClient } from '../client.js';
import {
  extractElements,
  hrefTitle,
  paginationMeta,
  pickLink,
  type HalCollection,
  type HalResource,
} from '../hal.js';
import { json, tryTool } from '../toolResult.js';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

function summarizeAttachment(a: HalResource) {
  return {
    id: a.id,
    fileName: a.fileName,
    fileSize: a.fileSize,
    contentType: a.contentType,
    description: (a.description as { raw?: string } | undefined)?.raw ?? null,
    author: hrefTitle(pickLink(a, 'author')),
    createdAt: a.createdAt,
    downloadUrl: pickLink(a, 'downloadLocation')?.href ?? null,
  };
}

interface EmbedLocation {
  location: 'description' | 'comment';
  activityId?: number;
  context: string;
}

async function findEmbedLocations(
  client: OpenProjectClient,
  containerHref: string | undefined,
  fileName: string,
): Promise<EmbedLocation[]> {
  if (!containerHref || !fileName) return [];

  const wpPath = containerHref.replace(/.*\/api\/v3/, '');
  const locations: EmbedLocation[] = [];
  const pattern = `attachment:${fileName}`;

  try {
    const wp = await client.get<HalResource>(wpPath);
    const desc = (wp.description as { raw?: string } | undefined)?.raw ?? '';
    if (desc.includes(pattern)) {
      locations.push({
        location: 'description',
        context: extractContext(desc, pattern),
      });
    }

    const activities = await client.get<HalCollection>(`${wpPath}/activities`);
    for (const activity of extractElements(activities)) {
      const comment = (activity.comment as { raw?: string } | undefined)?.raw ?? '';
      if (comment.includes(pattern)) {
        locations.push({
          location: 'comment',
          activityId: activity.id as number,
          context: extractContext(comment, pattern),
        });
      }
    }
  } catch {
    // Non-critical — return whatever we found
  }

  return locations;
}

function extractContext(text: string, pattern: string): string {
  const idx = text.indexOf(pattern);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 50);
  const end = Math.min(text.length, idx + pattern.length + 50);
  const snippet = text.slice(start, end);
  return (start > 0 ? '...' : '') + snippet + (end < text.length ? '...' : '');
}

export function registerAttachmentTools(server: McpServer, client: OpenProjectClient) {
  server.registerTool(
    'op_list_attachments',
    {
      title: 'List attachments',
      annotations: { readOnlyHint: true },
      description: 'List attachments on a work package.',
      inputSchema: {
        workPackageId: z.number().int().positive(),
        raw: z.boolean().optional(),
      },
    },
    async ({ workPackageId, raw }) =>
      tryTool(async () => {
        const data = await client.get<HalCollection>(
          `/work_packages/${workPackageId}/attachments`,
        );
        if (raw) return json(data);
        return json({
          ...paginationMeta(data),
          elements: extractElements(data).map(summarizeAttachment),
        });
      }),
  );

  server.registerTool(
    'op_get_attachment',
    {
      title: 'Get attachment',
      annotations: { readOnlyHint: true },
      description:
        'Fetch attachment metadata by id. Set saveTo to download the file content to a local path ' +
        'and also return embedLocations showing where the file is referenced in the work package ' +
        '(description and comments).',
      inputSchema: {
        id: z.number().int().positive(),
        raw: z.boolean().optional(),
        saveTo: z.string().optional().describe('Local file path to save the downloaded content to'),
      },
    },
    async ({ id, raw, saveTo }) =>
      tryTool(async () => {
        const data = await client.get<HalResource>(`/attachments/${id}`);

        if (!saveTo) {
          return json(raw ? data : summarizeAttachment(data));
        }

        const rawHref = pickLink(data, 'downloadLocation')?.href;
        if (!rawHref) {
          throw new Error('No download URL available for this attachment');
        }

        const downloadUrl = rawHref.startsWith('http')
          ? rawHref
          : `${client.baseUrl}${rawHref}`;

        const auth = Buffer.from(`apikey:${client.apiKey}`).toString('base64');
        const res = await fetch(downloadUrl, {
          headers: {
            Authorization: `Basic ${auth}`,
            'User-Agent': 'openproject-mcp/0.1.0',
          },
        });
        if (!res.ok) {
          throw new Error(`Download failed: ${res.status}`);
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        await writeFile(saveTo, buffer);

        const fileName = (data.fileName as string) ?? '';
        const containerHref = pickLink(data, 'container')?.href ?? undefined;
        const embedLocations = await findEmbedLocations(client, containerHref, fileName);

        return json({ ...summarizeAttachment(data), savedTo: saveTo, embedLocations });
      }),
  );

  server.registerTool(
    'op_upload_attachment',
    {
      title: 'Upload attachment',
      annotations: { readOnlyHint: false, destructiveHint: false },
      description:
        'Upload a file from the local filesystem as an attachment on a work package. ' +
        'Provide the absolute path to the file. Optionally override the file name. ' +
        'Set embedIn to "comment" or "description" to also insert an image reference ' +
        '(![](attachment:filename)) into the work package.',
      inputSchema: {
        workPackageId: z.number().int().positive(),
        filePath: z.string().min(1).describe('Absolute path to the file on disk'),
        fileName: z.string().optional().describe('Override the file name (defaults to basename of filePath)'),
        description: z.string().optional(),
        embedIn: z.enum(['comment', 'description']).optional()
          .describe('Embed the uploaded file in a comment or the WP description'),
        embedText: z.string().optional()
          .describe('Text to include alongside the image reference (used with embedIn)'),
      },
    },
    async ({ workPackageId, filePath, fileName, description, embedIn, embedText }) =>
      tryTool(async () => {
        const fileBuffer = await readFile(filePath);
        const name = fileName ?? basename(filePath);

        const metadata: Record<string, unknown> = { fileName: name };
        if (description) metadata.description = { raw: description };

        const formData = new FormData();
        formData.append('metadata', JSON.stringify(metadata));
        formData.append('file', new Blob([fileBuffer]), name);

        const attachment = await client.postFormData<HalResource>(
          `/work_packages/${workPackageId}/attachments`,
          formData,
        );

        const attachmentFileName = (attachment.fileName as string) ?? name;
        const imageRef = `![](attachment:${attachmentFileName})`;

        if (!embedIn) {
          return json(summarizeAttachment(attachment));
        }

        if (embedIn === 'comment') {
          const commentRaw = embedText
            ? `${embedText}\n\n${imageRef}`
            : imageRef;
          const commentData = await client.post<HalResource>(
            `/work_packages/${workPackageId}/activities`,
            { comment: { raw: commentRaw } },
          );
          return json({
            attachment: summarizeAttachment(attachment),
            comment: {
              id: commentData.id,
              createdAt: commentData.createdAt,
              comment: (commentData.comment as { raw?: string } | undefined)?.raw ?? null,
            },
          });
        }

        // embedIn === 'description'
        const wp = await client.get<HalResource>(`/work_packages/${workPackageId}`);
        const existingDesc = (wp.description as { raw?: string } | undefined)?.raw ?? '';
        const newDesc = existingDesc
          ? `${existingDesc}\n\n${imageRef}`
          : imageRef;
        const updated = await client.patch<HalResource>(
          `/work_packages/${workPackageId}`,
          {
            lockVersion: wp.lockVersion,
            description: { raw: newDesc },
          },
        );
        return json({
          attachment: summarizeAttachment(attachment),
          description: (updated.description as { raw?: string } | undefined)?.raw ?? null,
        });
      }),
  );

  server.registerTool(
    'op_delete_attachment',
    {
      title: 'Delete attachment',
      annotations: { readOnlyHint: false, destructiveHint: true },
      description: 'Delete an attachment. Destructive.',
      inputSchema: {
        id: z.number().int().positive(),
      },
    },
    async ({ id }) =>
      tryTool(async () => {
        await client.delete(`/attachments/${id}`);
        return json({ deleted: id });
      }),
  );
}
