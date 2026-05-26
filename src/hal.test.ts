import { describe, test, expect } from 'vitest';
import {
  extractElements,
  hrefId,
  hrefTitle,
  pickLink,
  summarizeWorkPackage,
  summarizeProject,
  summarizeUser,
  paginationMeta,
  truncate,
  pickFields,
} from './hal.js';

describe('hrefId', () => {
  test('extracts numeric id from href', () => {
    expect(hrefId({ href: '/api/v3/statuses/1' })).toBe(1);
  });

  test('extracts string id when not numeric', () => {
    expect(hrefId({ href: '/api/v3/projects/my-project' })).toBe('my-project');
  });

  test('returns null for null/undefined link', () => {
    expect(hrefId(null)).toBeNull();
    expect(hrefId(undefined)).toBeNull();
  });

  test('returns null for empty href', () => {
    expect(hrefId({ href: null })).toBeNull();
    expect(hrefId({ href: '' })).toBeNull();
  });
});

describe('hrefTitle', () => {
  test('returns title from link', () => {
    expect(hrefTitle({ href: '/api/v3/users/1', title: 'Alice' })).toBe('Alice');
  });

  test('returns null when no title', () => {
    expect(hrefTitle({ href: '/api/v3/users/1' })).toBeNull();
  });

  test('returns null for null/undefined', () => {
    expect(hrefTitle(null)).toBeNull();
    expect(hrefTitle(undefined)).toBeNull();
  });
});

describe('pickLink', () => {
  test('returns single link by rel', () => {
    const resource = {
      _links: { status: { href: '/api/v3/statuses/1', title: 'New' } },
    };
    expect(pickLink(resource, 'status')).toEqual({
      href: '/api/v3/statuses/1',
      title: 'New',
    });
  });

  test('returns first element when link is an array', () => {
    const resource = {
      _links: {
        children: [
          { href: '/api/v3/work_packages/10' },
          { href: '/api/v3/work_packages/11' },
        ],
      },
    };
    expect(pickLink(resource, 'children')).toEqual({
      href: '/api/v3/work_packages/10',
    });
  });

  test('returns undefined for missing rel', () => {
    expect(pickLink({ _links: {} }, 'missing')).toBeUndefined();
  });

  test('returns undefined for undefined resource', () => {
    expect(pickLink(undefined, 'status')).toBeUndefined();
  });
});

describe('extractElements', () => {
  test('returns elements from HAL collection', () => {
    const collection = {
      _embedded: { elements: [{ id: 1 }, { id: 2 }] },
    };
    expect(extractElements(collection)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('returns empty array when no elements', () => {
    expect(extractElements({ _embedded: {} })).toEqual([]);
  });

  test('returns empty array for undefined collection', () => {
    expect(extractElements(undefined)).toEqual([]);
  });
});

describe('paginationMeta', () => {
  test('extracts pagination fields with hasMore=true when more results exist', () => {
    const collection = { total: 42, count: 25, pageSize: 25, offset: 1 };
    expect(paginationMeta(collection)).toEqual({
      total: 42,
      count: 25,
      pageSize: 25,
      offset: 1,
      hasMore: true,
    });
  });

  test('hasMore is false when all results are returned', () => {
    const collection = { total: 3, count: 3, pageSize: 25, offset: 1 };
    expect(paginationMeta(collection)).toEqual({
      total: 3,
      count: 3,
      pageSize: 25,
      offset: 1,
      hasMore: false,
    });
  });

  test('hasMore is false on the last page', () => {
    const collection = { total: 30, count: 5, pageSize: 25, offset: 26 };
    expect(paginationMeta(collection)).toEqual({
      total: 30,
      count: 5,
      pageSize: 25,
      offset: 26,
      hasMore: false,
    });
  });

  test('returns empty object for undefined', () => {
    expect(paginationMeta(undefined)).toEqual({});
  });
});

describe('truncate', () => {
  test('returns text unchanged when under maxLen', () => {
    expect(truncate('short text', 200)).toBe('short text');
  });

  test('truncates text exceeding maxLen with ellipsis', () => {
    const long = 'a'.repeat(300);
    const result = truncate(long, 200);
    expect(result).toHaveLength(201); // 200 chars + '…'
    expect(result!.endsWith('…')).toBe(true);
  });

  test('returns null for null/undefined input', () => {
    expect(truncate(null)).toBeNull();
    expect(truncate(undefined)).toBeNull();
  });

  test('returns empty string as-is', () => {
    expect(truncate('')).toBeNull();
  });

  test('uses default maxLen of 200', () => {
    const exactly200 = 'x'.repeat(200);
    expect(truncate(exactly200)).toBe(exactly200);
    const over200 = 'x'.repeat(201);
    expect(truncate(over200)).toHaveLength(201);
  });

  test('respects custom maxLen', () => {
    expect(truncate('abcdef', 3)).toBe('abc…');
  });
});

describe('pickFields', () => {
  test('returns only specified fields', () => {
    const obj = { id: 1, name: 'Test', status: 'open', priority: 'high' };
    expect(pickFields(obj, ['id', 'name'])).toEqual({ id: 1, name: 'Test' });
  });

  test('ignores fields not present in object', () => {
    const obj = { id: 1, name: 'Test' };
    expect(pickFields(obj, ['id', 'missing'])).toEqual({ id: 1 });
  });

  test('returns full object when fields is undefined', () => {
    const obj = { id: 1, name: 'Test' };
    expect(pickFields(obj, undefined)).toEqual({ id: 1, name: 'Test' });
  });

  test('returns full object when fields is empty array', () => {
    const obj = { id: 1, name: 'Test' };
    expect(pickFields(obj, [])).toEqual({ id: 1, name: 'Test' });
  });
});

describe('summarizeWorkPackage', () => {
  test('extracts key fields and link titles', () => {
    const wp = {
      id: 100,
      subject: 'Fix login',
      startDate: '2025-01-01',
      dueDate: '2025-01-15',
      percentageDone: 50,
      estimatedTime: 'PT8H',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-10T00:00:00Z',
      lockVersion: 3,
      _links: {
        type: { href: '/api/v3/types/1', title: 'Bug' },
        status: { href: '/api/v3/statuses/1', title: 'New' },
        priority: { href: '/api/v3/priorities/2', title: 'High' },
        project: { href: '/api/v3/projects/5', title: 'Alpha' },
        assignee: { href: '/api/v3/users/10', title: 'Alice' },
        author: { href: '/api/v3/users/11', title: 'Bob' },
      },
    };
    const summary = summarizeWorkPackage(wp);
    expect(summary).toEqual({
      id: 100,
      subject: 'Fix login',
      type: 'Bug',
      status: 'New',
      priority: 'High',
      project: { id: 5, name: 'Alpha' },
      assignee: 'Alice',
      author: 'Bob',
      startDate: '2025-01-01',
      dueDate: '2025-01-15',
      percentageDone: 50,
      estimatedTime: 'PT8H',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-10T00:00:00Z',
      lockVersion: 3,
    });
  });
});

describe('summarizeProject', () => {
  test('extracts key fields including description raw text', () => {
    const project = {
      id: 5,
      name: 'Alpha',
      identifier: 'alpha',
      description: { raw: 'A test project' },
      active: true,
      public: false,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-10T00:00:00Z',
      _links: {
        parent: { href: '/api/v3/projects/1', title: 'Root' },
        status: { href: '/api/v3/project_statuses/on_track', title: 'On track' },
      },
    };
    expect(summarizeProject(project)).toEqual({
      id: 5,
      name: 'Alpha',
      identifier: 'alpha',
      description: 'A test project',
      active: true,
      public: false,
      parent: { id: 1, name: 'Root' },
      status: 'On track',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-10T00:00:00Z',
    });
  });

  test('returns null description when not present', () => {
    const project = { id: 1, name: 'X', _links: {} };
    expect(summarizeProject(project).description).toBeNull();
  });

  test('returns full description by default (no truncation)', () => {
    const long = 'a'.repeat(500);
    const project = { id: 1, name: 'X', description: { raw: long }, _links: {} };
    expect(summarizeProject(project).description).toBe(long);
  });

  test('truncates description when truncateDescription option is set', () => {
    const long = 'a'.repeat(500);
    const project = { id: 1, name: 'X', description: { raw: long }, _links: {} };
    const result = summarizeProject(project, { truncateDescription: 200 });
    expect((result.description as string).length).toBe(201); // 200 + '…'
  });

  test('does not truncate short description even with truncateDescription set', () => {
    const project = { id: 1, name: 'X', description: { raw: 'Short' }, _links: {} };
    const result = summarizeProject(project, { truncateDescription: 200 });
    expect(result.description).toBe('Short');
  });
});

describe('summarizeUser', () => {
  test('extracts user fields', () => {
    const user = {
      id: 10,
      name: 'Alice Smith',
      login: 'alice',
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Smith',
      admin: false,
      status: 'active',
    };
    expect(summarizeUser(user)).toEqual({
      id: 10,
      name: 'Alice Smith',
      login: 'alice',
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Smith',
      admin: false,
      status: 'active',
    });
  });
});
