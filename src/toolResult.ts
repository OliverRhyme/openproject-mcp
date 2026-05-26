export type ToolContent = { type: 'text'; text: string };

export interface ToolResponse {
  content: ToolContent[];
  isError?: boolean;
  [key: string]: unknown;
}

export function json(value: unknown): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

export function text(value: string): ToolResponse {
  return { content: [{ type: 'text', text: value }] };
}

export function errorResponse(err: unknown): ToolResponse {
  const e = err as { message?: string; status?: number; body?: unknown };
  const payload = {
    error: e?.message ?? String(err),
    status: e?.status,
    details: e?.body,
  };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

export async function tryTool(
  fn: () => Promise<ToolResponse>,
): Promise<ToolResponse> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}
