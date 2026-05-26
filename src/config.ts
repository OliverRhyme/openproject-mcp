export interface Config {
  baseUrl: string;
  apiKey: string;
  defaultPageSize: number;
  timeoutMs: number;
}

export function loadConfig(): Config {
  const baseUrl = process.env.OPENPROJECT_BASE_URL?.trim();
  const apiKey = process.env.OPENPROJECT_API_KEY?.trim();

  if (!baseUrl) {
    throw new Error(
      'OPENPROJECT_BASE_URL is required (e.g. https://community.openproject.org)',
    );
  }
  if (!apiKey) {
    throw new Error(
      'OPENPROJECT_API_KEY is required. Generate one in OpenProject → My account → Access tokens → API.',
    );
  }

  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`OPENPROJECT_BASE_URL is not a valid URL: ${baseUrl}`);
  }

  const defaultPageSize = parseIntOr(process.env.OPENPROJECT_PAGE_SIZE, 25);
  const timeoutMs = parseIntOr(process.env.OPENPROJECT_TIMEOUT_MS, 30_000);

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    defaultPageSize,
    timeoutMs,
  };
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
