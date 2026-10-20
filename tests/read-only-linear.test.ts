import { describe, expect, it } from 'vitest';
import type { LinearClient, LinearIssue, LinearWorkspace } from '../src/clients/types.js';
import { readOnlyLinear } from '../src/clients/read-only-linear.js';
import { MemoryLinear } from './helpers/memory-linear.js';

const issue: LinearIssue = { id: 'issue', identifier: 'PRE-1', number: 1, title: 'Ask', description: '', createdAt: '2026-10-19T12:00:00.000Z', updatedAt: '2026-10-19T12:00:00.000Z', completedAt: null, stateId: 'triage', stateType: 'triage', assignee: null, labels: [], attachmentTitles: [] };
const workspace: LinearWorkspace = { teamId: 'team', triageStateId: 'triage', canceledStateId: 'canceled', labelIds: { demo: 'label' }, triageOwnerId: 'ela', users: [] };
const clock = () => new Date('2026-10-20T12:00:00.000Z');

const readMethods = [
  'getViewerId', 'resolveWorkspace', 'listTriageIssues', 'listIssuesUpdatedSince',
  'getIssue', 'getIssueWithComments', 'listCommentsCreatedSince',
] as const satisfies readonly (keyof LinearClient)[];
const mutationMethods = ['createComment', 'updateIssue', 'addLabel', 'removeLabel'] as const satisfies readonly (keyof LinearClient)[];
type ListedMethod = (typeof readMethods)[number] | (typeof mutationMethods)[number];
const everyMethodIsListed: Exclude<keyof LinearClient, ListedMethod> extends never ? true : never = true;

function client(): MemoryLinear {
  return new MemoryLinear({ issues: [{ issue, comments: [] }], viewerId: 'bot', workspace }, clock);
}

describe('readOnlyLinear', () => {
  it('delegates every read method', async () => {
    expect(everyMethodIsListed).toBe(true);
    const inner = client();
    const linear = readOnlyLinear(inner);

    await linear.getViewerId();
    await linear.resolveWorkspace('PRE', ['demo'], 'ela@evertrust.fr');
    await linear.listTriageIssues('PRE');
    await linear.listIssuesUpdatedSince('PRE', null);
    await linear.getIssue('issue');
    await linear.getIssueWithComments('issue');
    await linear.listCommentsCreatedSince('PRE', '2026-10-20T00:00:00.000Z');

    expect(inner.calls.map(({ method }) => method)).toEqual(readMethods);
  });

  it('blocks every mutation method without calling the inner client', async () => {
    const inner = client();
    const linear = readOnlyLinear(inner);
    const calls: Record<(typeof mutationMethods)[number], () => Promise<unknown>> = {
      createComment: () => linear.createComment({ issueId: 'issue', body: 'body', parentId: null }),
      updateIssue: () => linear.updateIssue('issue', {}),
      addLabel: () => linear.addLabel('issue', 'label'),
      removeLabel: () => linear.removeLabel('issue', 'label'),
    };

    for (const method of mutationMethods) {
      await expect(calls[method]()).rejects.toThrow(`dry run: ${method} blocked`);
    }

    expect(inner.calls).toEqual([]);
  });
});
