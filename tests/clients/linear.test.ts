import { describe, expect, it, vi } from 'vitest';
import { DependencyError } from '../../src/errors.js';
import { createLinearClient } from '../../src/clients/linear.js';
import { ISSUE_FIELDS, ISSUES_UPDATED_SINCE, TRIAGE_ISSUES } from '../../src/clients/linear-queries.js';

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status }); }
function linearFetch(...responses: Response[]): any {
  let index = 0;
  return vi.fn(async () => {
    const response = responses[index];
    index += 1;
    return response ?? new Response(null, { status: 500 });
  });
}
function oauthToken(value = 'token', expiresIn = 172_800): Response { return json({ access_token: value, expires_in: expiresIn }); }
function data(value: unknown): Response { return json({ data: value }); }
function client(fetch: typeof globalThis.fetch, now = vi.fn(() => new Date('2026-10-20T00:00:00.000Z'))) { return { client: createLinearClient({ clientId: 'client', clientSecret: 'secret', fetch, clock: now }), now }; }
function issue(id: string, extra: Record<string, unknown> = {}) { return { id, identifier: 'PRE-1', number: 1, title: 'Title', description: 'Description', createdAt: '2026-01-01', updatedAt: '2026-01-02', completedAt: null, state: { id: 's', type: 'triage' }, assignee: null, labels: { nodes: [] }, attachments: { nodes: [] }, ...extra }; }
function comment(id: string, extra: Record<string, unknown> = {}) { return { id, body: 'Body', createdAt: '2026-01-01', parent: null, user: null, externalUser: null, botActor: null, issue: { id: 'issue' }, ...extra }; }

describe('Linear client', () => {
  it('uses bounded connection sizes in polling queries', () => {
    expect(ISSUE_FIELDS).toContain('labels(first: 20)');
    expect(ISSUE_FIELDS).toContain('attachments(first: 10)');
    expect(TRIAGE_ISSUES).toContain('issues(first: 10,');
    expect(TRIAGE_ISSUES).toContain('comments(first: 100)');
    expect(ISSUES_UPDATED_SINCE).toContain('issues(first: 50,');
  });

  it('fetches a client-credentials token with Basic auth and reuses it', async () => {
    const fetch = linearFetch(oauthToken(), data({ viewer: { id: 'viewer' } }), data({ viewer: { id: 'viewer' } })); const { client: linear } = client(fetch);
    await expect(linear.getViewerId()).resolves.toBe('viewer'); await linear.getViewerId();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]).toEqual(['https://api.linear.app/oauth/token', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Basic Y2xpZW50OnNlY3JldA==', 'Content-Type': 'application/x-www-form-urlencoded' }), body: 'grant_type=client_credentials&scope=read,write' })]);
  });

  it('renews the token with less than 24 hours left', async () => {
    const fetch = linearFetch(oauthToken('one', 86_399), data({ viewer: { id: 'viewer' } }), oauthToken('two'), data({ viewer: { id: 'viewer' } })); const { client: linear } = client(fetch);
    await linear.getViewerId(); await linear.getViewerId();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('renews the token once and retries once on an auth error', async () => {
    const fetch = linearFetch(oauthToken('one'), json({ errors: [{ extensions: { type: 'authentication_error' } }] }), oauthToken('two'), data({ viewer: { id: 'viewer' } }));
    await expect(client(fetch).client.getViewerId()).resolves.toBe('viewer');
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer one' });
    expect(fetch.mock.calls[3]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer two' });
  });

  it('throws DependencyError when the retry also fails', async () => {
    const fetch = linearFetch(oauthToken(), new Response(null, { status: 401 }), oauthToken(), new Response(null, { status: 401 }));
    await expect(client(fetch).client.getViewerId()).rejects.toMatchObject({ dependency: 'linear' } satisfies Partial<DependencyError>);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('maps triage issues with their comments across two pages', async () => {
    const fetch = linearFetch(oauthToken(), data({ issues: { nodes: [{ ...issue('i1'), comments: { nodes: [comment('c1', { user: { id: 'u', name: 'Ada' } })] } }], pageInfo: { hasNextPage: true, endCursor: 'next' } } }), data({ issues: { nodes: [{ ...issue('i2'), comments: { nodes: [] } }], pageInfo: { hasNextPage: false, endCursor: null } } }));
    await expect(client(fetch).client.listTriageIssues('PRE')).resolves.toEqual([{ issue: expect.objectContaining({ id: 'i1' }), comments: [expect.objectContaining({ id: 'c1', authorId: 'u', authorName: 'Ada' })] }, { issue: expect.objectContaining({ id: 'i2' }), comments: [] }]);
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body)).variables).toEqual({ teamKey: 'PRE', after: 'next' });
  });

  it('maps a null issue description to an empty string', async () => {
    const fetch = linearFetch(oauthToken(), data({ issue: issue('i', { description: null }) }));
    await expect(client(fetch).client.getIssue('i')).resolves.toMatchObject({ description: '' });
  });

  it('uses the epoch and includeArchived for a backfill', async () => {
    const fetch = linearFetch(oauthToken(), data({ issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }));
    await client(fetch).client.listIssuesUpdatedSince('PRE', null);
    const request = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(request.variables).toEqual({ teamKey: 'PRE', since: '1970-01-01T00:00:00.000Z', after: null });
    expect(request.query).toContain('includeArchived: true');
  });

  it('maps comment authors', async () => {
    const fetch = linearFetch(oauthToken(), data({ comments: { nodes: [comment('user', { user: { id: 'u', name: 'Ada' } }), comment('slack', { externalUser: { name: 'Hilde WALDENFELS' } }), comment('bot', { botActor: { name: 'Slack' } })], pageInfo: { hasNextPage: false, endCursor: null } } }));
    await expect(client(fetch).client.listCommentsCreatedSince('PRE', '2026-01-01')).resolves.toEqual([expect.objectContaining({ authorId: 'u', authorName: 'Ada' }), expect.objectContaining({ authorId: null, authorName: 'Hilde WALDENFELS' }), expect.objectContaining({ authorId: null, authorName: 'Slack' })]);
  });

  it('creates a threaded comment and omits a null parentId', async () => {
    const fetch = linearFetch(oauthToken(), data({ commentCreate: { success: true, comment: { id: 'c1' } } }), data({ commentCreate: { success: true, comment: { id: 'c2' } } })); const linear = client(fetch).client;
    await expect(linear.createComment({ issueId: 'i', body: 'Reply', parentId: 'parent' })).resolves.toBe('c1'); await linear.createComment({ issueId: 'i', body: 'Top', parentId: null });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).variables.input).toEqual({ issueId: 'i', body: 'Reply', parentId: 'parent' });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body)).variables.input).toEqual({ issueId: 'i', body: 'Top' });
  });

  it('adds and removes labels', async () => {
    const fetch = linearFetch(oauthToken(), data({ issueAddLabel: { success: true } }), data({ issueRemoveLabel: { success: true } })); const linear = client(fetch).client;
    await linear.addLabel('i', 'l'); await linear.removeLabel('i', 'l');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).variables).toEqual({ id: 'i', labelId: 'l' });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body)).variables).toEqual({ id: 'i', labelId: 'l' });
  });

  it('resolveWorkspace prefers team labels, reports all missing labels at once, picks Canceled and returns users', async () => {
    const workspace = { teams: { nodes: [{ id: 't', states: { nodes: [{ id: 'triage', name: 'Triage', type: 'triage' }, { id: 'other', name: 'Cancelled', type: 'canceled' }, { id: 'cancel', name: 'Canceled', type: 'canceled' }] } }] }, issueLabels: { nodes: [{ id: 'workspace', name: 'Urgent', team: null }, { id: 'team', name: 'Urgent', team: { id: 't' } }] }, owner: { nodes: [{ id: 'owner' }] }, users: { nodes: [{ id: 'u', name: 'Ada', displayName: 'Ada L', email: 'ada@example.com' }] } };
    await expect(client(linearFetch(oauthToken(), data(workspace))).client.resolveWorkspace('PRE', ['Urgent'], 'owner@example.com')).resolves.toEqual({ teamId: 't', triageStateId: 'triage', canceledStateId: 'cancel', labelIds: { urgent: 'team' }, triageOwnerId: 'owner', users: [{ id: 'u', name: 'Ada', displayName: 'Ada L', email: 'ada@example.com' }] });
    await expect(client(linearFetch(oauthToken(), data({ ...workspace, issueLabels: { nodes: [] } }))).client.resolveWorkspace('PRE', ['Urgent', 'P1'], 'owner@example.com')).rejects.toThrow('Missing Linear labels: Urgent, P1');
  });

  it('wraps GraphQL errors in DependencyError and returns null for a missing issue', async () => {
    await expect(client(linearFetch(oauthToken(), json({ errors: [{ message: 'bad request' }] }))).client.getViewerId()).rejects.toMatchObject({ dependency: 'linear' } satisfies Partial<DependencyError>);
    const missing = () => json({ data: null, errors: [{ message: 'Entity not found: Issue', extensions: { type: 'invalid input' } }] });
    await expect(client(linearFetch(oauthToken(), json({ errors: [{ message: 'Entity not found: Issue', extensions: { type: 'invalid input' } }] }, 400))).client.getIssue('missing')).resolves.toBeNull();
    await expect(client(linearFetch(oauthToken(), missing())).client.getIssueWithComments('missing')).resolves.toBeNull();
  });

  it('rejects mutations with success false', async () => {
    await expect(client(linearFetch(oauthToken(), data({ issueUpdate: { success: false } }))).client.updateIssue('i', {})).rejects.toMatchObject({ dependency: 'linear' } satisfies Partial<DependencyError>);
  });
});
