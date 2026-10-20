import { describe, expect, it } from 'vitest';
import type { IssueWithComments, LinearComment, LinearUser } from '../src/clients/types.js';
import type { Requester } from '../src/domain/types.js';
import {
  computeInputHash,
  findSyncedThreadRoot,
  isRecheck,
  isRequesterComment,
  requesterComments,
  resolveRequester,
  shouldEvaluate,
  ticketInput,
} from '../src/triggers.js';

const requester: Requester = { name: 'Hilde WALDENFELS', linearUserId: null };
const users: readonly LinearUser[] = [
  { id: 'hilde-id', name: 'Hilde Waldenfels', displayName: 'H. Waldenfels', email: 'hilde@example.com' },
];

function comment(overrides: Partial<LinearComment> = {}): LinearComment {
  return {
    id: 'comment-1', issueId: 'issue-1', body: 'A reply', createdAt: '2026-10-20T10:00:00.000Z',
    parentId: 'thread-1', authorId: null, authorName: 'Hilde Waldenfels', ...overrides,
  };
}

function ticket(overrides: Partial<IssueWithComments> = {}): IssueWithComments {
  return {
    issue: {
      id: 'issue-1', identifier: 'PRE-1', number: 1, title: 'Ask', description: 'Description',
      createdAt: '2026-10-20T09:00:00.000Z', updatedAt: '2026-10-20T09:00:00.000Z', completedAt: null,
      stateId: 'state-1', stateType: 'started', assignee: null, labels: [], attachmentTitles: ['Ask from Hilde WALDENFELS'],
    },
    comments: [comment()],
    ...overrides,
  };
}

describe('triggers', () => {
  it('finds the synced thread root', () => {
    const root = comment({
      id: 'root', parentId: null,
      body: 'This comment thread is synced to a corresponding [thread in Slack](https://evertrust-fr.slack.com/archives/C0AKST92HMF/p1792495190129789). All replies are displayed in both locations.',
    });
    const reply = comment({ id: 'reply', body: root.body, parentId: 'parent' });

    expect(findSyncedThreadRoot([reply, root])).toBe(root);
  });

  it('recognizes rechecks at the start of a comment', () => {
    expect(isRecheck('  Recheck please')).toBe(true);
    expect(isRecheck('please recheck')).toBe(false);
  });

  it('resolves the requester to a unique Linear user by name or display name', () => {
    expect(resolveRequester('Hilde Waldenfels', users)).toEqual({ name: 'Hilde Waldenfels', linearUserId: 'hilde-id' });
    expect(resolveRequester('H. Waldenfels', users)).toEqual({ name: 'H. Waldenfels', linearUserId: 'hilde-id' });
  });

  it('keeps a Slack display name when no or several users match', () => {
    expect(resolveRequester('Unknown Person', users)).toEqual({ name: 'Unknown Person', linearUserId: null });
    expect(resolveRequester('Hilde', [
      { ...users[0]!, name: 'Hilde', id: 'one' },
      { ...users[0]!, displayName: 'Hilde', id: 'two' },
    ])).toEqual({ name: 'Hilde', linearUserId: null });
  });

  it('matches a Slack-synced reply by normalised name', () => {
    expect(isRequesterComment(comment({ authorName: 'Hilde  Waldenfels' }), requester, 'bot-id')).toBe(true);
  });

  it('ignores comments by others, by the bot and the Slack root', () => {
    expect(isRequesterComment(comment({ authorId: 'f0142443-6257-4877-a069-fbd5e8c2182e', authorName: 'Etienne Laviolette' }), requester, 'bot-id')).toBe(false);
    expect(isRequesterComment(comment({ authorId: 'bot-id' }), requester, 'bot-id')).toBe(false);
    expect(isRequesterComment(comment({ authorName: 'Slack', parentId: null }), requester, 'bot-id')).toBe(false);
  });

  it('a ticket without requester hashes only the body', () => {
    const noRequester = ticket({ issue: { ...ticket().issue, attachmentTitles: [] }, comments: [comment()] });
    const input = ticketInput(noRequester, users, 'bot-id');

    expect(input.requester).toBeNull();
    expect(input.requesterComments).toEqual([]);
    expect(input.inputHash).toBe(computeInputHash('Description', []));
    const changedDescription = ticketInput({
      ...noRequester,
      issue: { ...noRequester.issue, description: 'Changed description' },
    }, users, 'bot-id');
    expect(changedDescription.inputHash).not.toBe(input.inputHash);
  });

  it('hash is stable and changes with a comment edit', () => {
    const comments = [comment()];
    expect(computeInputHash('Description', comments)).toBe(computeInputHash('Description', comments));
    expect(computeInputHash('Description', comments)).not.toBe(computeInputHash('Description', [comment({ body: 'Edited reply' })]));
  });

  it('ticketInput combines requester, comments and hash', () => {
    const input = ticketInput(ticket(), users, 'bot-id');

    expect(input.requester).toEqual({ name: 'Hilde WALDENFELS', linearUserId: 'hilde-id' });
    expect(input.requesterComments).toEqual([comment()]);
    expect(input.inputHash).toBe(computeInputHash('Description', [comment()]));
  });

  it('shouldEvaluate rejects non-triage tickets that are not bot-canceled', () => {
    expect(shouldEvaluate({ state: { status: 'pending_retry', mode: 'shadow', inputHash: null, commentIds: [] }, mode: 'shadow', inTriage: false, botCanceled: false, inputHash: 'hash', requesterComments: [] })).toBe(false);
  });

  it('shouldEvaluate evaluates a new triage ticket', () => {
    expect(shouldEvaluate({ state: null, mode: 'shadow', inTriage: true, botCanceled: false, inputHash: 'hash', requesterComments: [] })).toBe(true);
  });

  it('shouldEvaluate retries pending work', () => {
    expect(shouldEvaluate({ state: { status: 'pending_retry', mode: 'shadow', inputHash: 'hash', commentIds: [] }, mode: 'shadow', inTriage: true, botCanceled: false, inputHash: 'hash', requesterComments: [] })).toBe(true);
  });

  it('shouldEvaluate evaluates when triage mode changes', () => {
    expect(shouldEvaluate({ state: { status: 'accepted', mode: 'shadow', inputHash: 'hash', commentIds: [] }, mode: 'enforce', inTriage: true, botCanceled: false, inputHash: 'hash', requesterComments: [] })).toBe(true);
  });

  it('shouldEvaluate ignores unchanged input', () => {
    expect(shouldEvaluate({ state: { status: 'waiting', mode: 'shadow', inputHash: 'hash', commentIds: [] }, mode: 'shadow', inTriage: true, botCanceled: false, inputHash: 'hash', requesterComments: [] })).toBe(false);
  });

  it('bot-canceled re-evaluates only on a new recheck', () => {
    const state = { status: 'denied' as const, mode: 'shadow' as const, inputHash: 'old', commentIds: ['known'] };
    expect(shouldEvaluate({ state, mode: 'shadow', inTriage: false, botCanceled: true, inputHash: 'new', requesterComments: [comment({ id: 'known', body: 'Recheck' })] })).toBe(false);
    expect(shouldEvaluate({ state, mode: 'shadow', inTriage: false, botCanceled: true, inputHash: 'new', requesterComments: [comment({ id: 'new', body: 'Thanks' })] })).toBe(false);
    expect(shouldEvaluate({ state, mode: 'shadow', inTriage: false, botCanceled: true, inputHash: 'new', requesterComments: [comment({ id: 'new', body: ' Recheck please' })] })).toBe(true);
  });

  it('accepted in enforce ignores a body-only change', () => {
    expect(shouldEvaluate({
      state: { status: 'accepted', mode: 'enforce', inputHash: 'old', commentIds: ['comment-1'] },
      mode: 'enforce', inTriage: true, botCanceled: false, inputHash: 'changed-body', requesterComments: [comment()],
    })).toBe(false);
  });

  it('accepted in enforce evaluates a new comment with the same state', () => {
    expect(shouldEvaluate({
      state: { status: 'accepted', mode: 'enforce', inputHash: 'old', commentIds: ['known'] },
      mode: 'enforce', inTriage: true, botCanceled: false, inputHash: 'new', requesterComments: [comment({ id: 'new', body: 'Thanks' })],
    })).toBe(true);
  });

  it('shouldEvaluate evaluates other changed triage inputs', () => {
    expect(shouldEvaluate({ state: { status: 'manual', mode: 'shadow', inputHash: 'old', commentIds: [] }, mode: 'shadow', inTriage: true, botCanceled: false, inputHash: 'new', requesterComments: [] })).toBe(true);
  });

  it('filters requester comments after issue creation and sorts them', () => {
    expect(requesterComments([
      comment({ id: 'later', createdAt: '2026-10-20T11:00:00.000Z' }),
      comment({ id: 'before', createdAt: '2026-10-20T08:00:00.000Z' }),
      comment({ id: 'first', createdAt: '2026-10-20T10:00:00.000Z' }),
    ], requester, 'bot-id', '2026-10-20T09:00:00.000Z').map((entry) => entry.id)).toEqual(['first', 'later']);
  });
});
