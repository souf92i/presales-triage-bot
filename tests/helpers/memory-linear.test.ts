import { describe, expect, it } from 'vitest';
import type { LinearIssue, LinearWorkspace } from '../../src/clients/types.js';
import { NOW } from './facts.js';
import { failing, MemoryLinear } from './memory-linear.js';

const issue: LinearIssue = { id: 'issue', identifier: 'PRE-1', number: 1, title: 'Ask', description: '', createdAt: '2026-10-19T12:00:00.000Z', updatedAt: '2026-10-19T12:00:00.000Z', completedAt: null, stateId: 'triage', stateType: 'triage', assignee: null, labels: [], attachmentTitles: [] };
const workspace: LinearWorkspace = { teamId: 'team', triageStateId: 'triage', canceledStateId: 'canceled', labelIds: { demo: 'label' }, triageOwnerId: 'ela', users: [{ id: 'ela', name: 'Etienne', displayName: 'Etienne', email: 'ela@evertrust.fr' }] };
const seed = { issues: [{ issue, comments: [] }], viewerId: 'bot', workspace };
const clock = () => new Date(NOW);

describe('MemoryLinear', () => {
  it('mutates stored issues, labels and comments without changing the seed', async () => {
    const client = new MemoryLinear(seed, clock);
    expect(await client.getViewerId()).toBe('bot');
    expect(await client.resolveWorkspace('PRE', ['demo'], 'ela@evertrust.fr')).toEqual(workspace);
    const commentId = await client.createComment({ issueId: 'issue', body: 'reply', parentId: 'root' });
    await client.addLabel('issue', 'label'); await client.addLabel('issue', 'label');
    expect((await client.getIssue('issue'))?.labels).toEqual([{ id: 'label', name: 'demo' }]);
    await client.updateIssue('issue', { stateId: 'canceled', assigneeId: 'ela' });
    expect(await client.getIssue('issue')).toMatchObject({ stateId: 'canceled', stateType: 'canceled', assignee: { id: 'ela', email: 'ela@evertrust.fr' }, updatedAt: NOW });
    expect((await client.getIssueWithComments('issue'))?.comments).toEqual([{ id: commentId, issueId: 'issue', body: 'reply', parentId: 'root', authorId: 'bot', authorName: 'bot', createdAt: NOW }]);
    await client.removeLabel('issue', 'label'); expect((await client.getIssue('issue'))?.labels).toEqual([]);
    expect(seed.issues[0]).toEqual({ issue, comments: [] }); expect(issue.stateType).toBe('triage');
    expect(client.calls).toContainEqual({ method: 'createComment', args: [{ issueId: 'issue', body: 'reply', parentId: 'root' }] });
  });

  it('filters lists, returns null for missing issues and consumes a one-shot failure', async () => {
    const other = { ...issue, id: 'other', identifier: 'OTHER-1' };
    const client = new MemoryLinear({ ...seed, issues: [...seed.issues, { issue: other, comments: [] }] }, clock);
    expect((await client.listTriageIssues('PRE')).map(({ issue }) => issue.id)).toEqual(['issue']);
    expect((await client.listIssuesUpdatedSince('PRE', null)).map(({ id }) => id)).toEqual(['issue']);
    expect(await client.listIssuesUpdatedSince('PRE', NOW)).toEqual([]);
    await client.createComment({ issueId: 'issue', body: 'new', parentId: null });
    expect(await client.listCommentsCreatedSince('PRE', NOW)).toHaveLength(1);
    expect(await client.listCommentsCreatedSince('OTHER', NOW)).toEqual([]);
    expect(await client.getIssue('missing')).toBeNull(); expect(await client.getIssueWithComments('missing')).toBeNull();
    const error = new Error('one-shot'); client.failNext('getIssue', error);
    await expect(client.getIssue('issue')).rejects.toBe(error);
    expect((await client.getIssue('issue'))?.id).toBe('issue');
    await expect(client.addLabel('missing', 'label')).rejects.toMatchObject({ dependency: 'linear' });
  });

  it('makes prototype methods fail with the selected dependency', async () => {
    const client = failing(new MemoryLinear(seed, clock), 'linear');
    await expect(client.getViewerId()).rejects.toMatchObject({ name: 'DependencyError', dependency: 'linear' });
    await expect(client.getIssue('issue')).rejects.toMatchObject({ dependency: 'linear' });
    await expect(client.updateIssue('issue', {})).rejects.toMatchObject({ dependency: 'linear' });
  });
});
