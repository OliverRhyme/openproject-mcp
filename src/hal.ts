export interface HalLink {
  href?: string | null;
  title?: string;
  method?: string;
}

export interface HalResource {
  _type?: string;
  _links?: Record<string, HalLink | HalLink[] | undefined>;
  _embedded?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HalCollection<T = HalResource> extends HalResource {
  total?: number;
  count?: number;
  pageSize?: number;
  offset?: number;
  _embedded?: { elements?: T[] } & Record<string, unknown>;
}

export function extractElements<T = HalResource>(
  collection: HalCollection<T> | undefined,
): T[] {
  return collection?._embedded?.elements ?? [];
}

export function hrefId(link: HalLink | undefined | null): number | string | null {
  if (!link?.href) return null;
  const last = link.href.split('/').filter(Boolean).pop();
  if (!last) return null;
  const n = Number(last);
  return Number.isFinite(n) ? n : last;
}

export function hrefTitle(link: HalLink | undefined | null): string | null {
  return link?.title ?? null;
}

export function pickLink(
  resource: HalResource | undefined,
  rel: string,
): HalLink | undefined {
  const v = resource?._links?.[rel];
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export function summarizeWorkPackage(wp: HalResource): Record<string, unknown> {
  return {
    id: wp.id,
    subject: wp.subject,
    type: hrefTitle(pickLink(wp, 'type')),
    status: hrefTitle(pickLink(wp, 'status')),
    priority: hrefTitle(pickLink(wp, 'priority')),
    project: {
      id: hrefId(pickLink(wp, 'project')),
      name: hrefTitle(pickLink(wp, 'project')),
    },
    assignee: hrefTitle(pickLink(wp, 'assignee')),
    author: hrefTitle(pickLink(wp, 'author')),
    startDate: wp.startDate,
    dueDate: wp.dueDate,
    percentageDone: wp.percentageDone,
    estimatedTime: wp.estimatedTime,
    createdAt: wp.createdAt,
    updatedAt: wp.updatedAt,
    lockVersion: wp.lockVersion,
  };
}

export function summarizeProject(
  p: HalResource,
  opts?: { truncateDescription?: number },
): Record<string, unknown> {
  const desc = (p.description as { raw?: string } | undefined)?.raw ?? null;
  return {
    id: p.id,
    name: p.name,
    identifier: p.identifier,
    description: opts?.truncateDescription ? truncate(desc, opts.truncateDescription) : desc,
    active: p.active,
    public: p.public,
    parent: {
      id: hrefId(pickLink(p, 'parent')),
      name: hrefTitle(pickLink(p, 'parent')),
    },
    status: hrefTitle(pickLink(p, 'status')),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function summarizeUser(u: HalResource): Record<string, unknown> {
  return {
    id: u.id,
    name: u.name,
    login: u.login,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    admin: u.admin,
    status: u.status,
  };
}

export function truncate(text: string | null | undefined, maxLen = 200): string | null {
  if (!text) return null;
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

export function pickFields<T extends Record<string, unknown>>(
  obj: T,
  fields: string[] | undefined,
): Record<string, unknown> {
  if (!fields || fields.length === 0) return obj;
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in obj) result[f] = obj[f];
  }
  return result;
}

export function paginationMeta(
  c: HalCollection | undefined,
): Record<string, unknown> {
  if (!c) return {};
  const total = c.total ?? 0;
  const offset = c.offset ?? 1;
  const pageSize = c.pageSize ?? 0;
  const count = c.count ?? 0;
  return {
    total,
    count,
    pageSize,
    offset,
    hasMore: offset + count - 1 < total,
  };
}
