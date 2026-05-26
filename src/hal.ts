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

export function summarizeProject(p: HalResource): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    identifier: p.identifier,
    description: (p.description as { raw?: string } | undefined)?.raw ?? null,
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

export function paginationMeta(
  c: HalCollection | undefined,
): Record<string, unknown> {
  if (!c) return {};
  return {
    total: c.total,
    count: c.count,
    pageSize: c.pageSize,
    offset: c.offset,
  };
}
