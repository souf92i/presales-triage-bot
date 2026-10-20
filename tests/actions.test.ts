import { describe, expect, it } from 'vitest';
import { applyOutcome, computeWaitExpiry, expireWait, postHandoff, preActionCheck } from '../src/actions.js';
import type { ActionDeps } from '../src/actions.js';
import type { LinearComment, LinearIssue, LinearWorkspace } from '../src/clients/types.js';
import { defaultConfig } from '../src/config.js';
import type { SlotWindow } from '../src/domain/types.js';
import type { EvaluationOutcome } from '../src/evaluate.js';
import type { Annotation } from '../src/rules/types.js';
import type { RuleVerdict } from '../src/verdict.js';
import { baseFacts, NOW } from './helpers/facts.js';
import { MemoryLinear } from './helpers/memory-linear.js';

const clock = () => new Date(NOW);
const workspace: LinearWorkspace = {
  teamId: 'team', triageStateId: 'triage', canceledStateId: 'canceled', triageOwnerId: 'ela',
  labelIds: { demo: 'demo-label', poc: 'poc-label', 'technical discovery': 'discovery-label', 'rfi rfp': 'rfx-label' },
  users: [{ id: 'ela', email: 'ela@evertrust.fr', name: 'Etienne', displayName: 'Etienne' }],
};
const issue: LinearIssue = {
  id: 'issue-1', identifier: 'PRE-900', number: 900, title: 'Demo', description: '',
  createdAt: NOW, updatedAt: NOW, completedAt: null, stateId: 'triage', stateType: 'triage',
  assignee: null, labels: [], attachmentTitles: [],
};
const root: LinearComment = {
  id: 'root', issueId: issue.id, body: 'This comment thread is synced with Slack',
  parentId: null, createdAt: NOW, authorId: 'user', authorName: 'User',
};

function setup(patch: Partial<LinearIssue> = {}, comments: readonly LinearComment[] = [root]) {
  const fresh = { ...issue, ...patch };
  const linear = new MemoryLinear({ issues: [{ issue: fresh, comments }], viewerId: 'bot', workspace }, clock);
  const deps: ActionDeps = { linear, workspace, config: defaultConfig(), clock };
  return { linear, deps, args: { issue, comments, mode: 'enforce' as const, startedFrom: 'triage' as const } };
}

function evaluated(verdict: RuleVerdict, annotations: readonly Annotation[] = []): Extract<EvaluationOutcome, { kind: 'evaluated' }> {
  return {
    kind: 'evaluated', label: 'demo', facts: baseFacts(), raw: { model: null, ticketFacts: null, qualification: null },
    result: { verdict, results: [{ ruleId: 'slot', outcome: { kind: 'pass' }, annotations: [] }],
      asks: verdict === 'waiting' ? [{ key: 'slot.incomplete', missing: ['end'] }] : [],
      denies: verdict === 'denied' ? [{ key: 'slot.no_slot' }] : [], errors: [], annotations },
  };
}

const manual: EvaluationOutcome = { kind: 'manual', reason: { key: 'unsupported_form' } };

describe('actions', () => {
  it.each(['accepted', 'waiting', 'denied'] as const)('shadow mode labels and writes one top-level shadow comment, nothing else: %s', async (verdict) => {
    const { linear, deps, args } = setup();
    const result = await applyOutcome({ ...args, mode: 'shadow', outcome: evaluated(verdict) }, deps);
    expect(result).toEqual({ skipped: false, actions: ['label:+demo', 'comment:memory-comment-1'], waitExpiresAt: null });
    expect(linear.calls.map(({ method }) => method)).toEqual(['getIssue', 'addLabel', 'createComment']);
    const ticket = await linear.getIssueWithComments(issue.id);
    expect(ticket?.comments.at(-1)).toMatchObject({ parentId: null, body: expect.stringContaining('Shadow mode, no action taken:') });
    expect(ticket?.comments.at(-1)?.body).toContain(`Verdict: ${verdict}\nRules:\n- slot: pass`);
    if (verdict === 'accepted') expect(ticket?.comments.at(-1)?.body).toContain('This request meets the presales triage policy.');
    expect(ticket?.issue).toMatchObject({ stateId: 'triage', assignee: null });
  });

  it('replaces only managed labels using fresh labels', async () => {
    const { linear, deps, args } = setup({ labels: [{ id: 'poc-label', name: 'PoC' }, { id: 'bug-label', name: 'Bug' }] });
    const result = await applyOutcome({ ...args, outcome: evaluated('accepted') }, deps);
    expect(result.actions.slice(0, 2)).toEqual(['label:+demo', 'label:-poc']);
    expect((await linear.getIssue(issue.id))?.labels).toEqual([{ id: 'bug-label', name: 'Bug' }, { id: 'demo-label', name: 'demo' }]);
  });

  it('does not re-add a present label', async () => {
    const { linear, deps, args } = setup({ labels: [{ id: 'demo-label', name: 'Demo' }] });
    await applyOutcome({ ...args, outcome: evaluated('accepted') }, deps);
    expect(linear.calls.some(({ method }) => method === 'addLabel')).toBe(false);
  });

  it.each(['shadow', 'enforce'] as const)('manual outcome leaves labels untouched in %s', async (mode) => {
    const labels = [{ id: 'poc-label', name: 'poc' }];
    const { linear, deps, args } = setup({ labels });
    const result = await applyOutcome({ ...args, mode, outcome: manual }, deps);
    expect(result).toEqual({ skipped: false, actions: ['comment:memory-comment-1'], waitExpiresAt: null });
    expect(linear.calls.map(({ method }) => method)).toEqual(['getIssue', 'createComment']);
    const ticket = await linear.getIssueWithComments(issue.id);
    expect(ticket?.issue.labels).toEqual(labels);
    expect(ticket?.comments.at(-1)).toMatchObject({ parentId: mode === 'shadow' ? null : 'root', body: expect.stringContaining('Manual triage needed:') });
    if (mode === 'shadow') expect(ticket?.comments.at(-1)?.body).toContain('Verdict: manual\nRules:\n');
  });

  it.each([
    { stateId: 'started', stateType: 'started' },
    { labels: [{ id: 'override', name: 'TRIAGE-OVERRIDE' }] },
  ])('skips all actions when the ticket left Triage or has the override label: %j', async (patch) => {
    const { linear, deps, args } = setup(patch);
    const result = await applyOutcome({ ...args, outcome: evaluated('denied') }, deps);
    expect(result).toMatchObject({ skipped: true, actions: [expect.stringMatching(/^skipped:/)], waitExpiresAt: null });
    expect(linear.calls.map(({ method }) => method)).toEqual(['getIssue']);
  });

  it('skips a missing issue', async () => {
    const { linear, deps } = setup();
    expect(await preActionCheck('missing', 'triage', deps)).toBeNull();
    expect(linear.calls.map(({ method }) => method)).toEqual(['getIssue']);
  });

  it('a recheck requires the bot\'s Canceled state', async () => {
    const { linear, deps, args } = setup({ stateId: 'duplicate', stateType: 'canceled' });
    expect(await applyOutcome({ ...args, startedFrom: 'canceled', outcome: evaluated('accepted') }, deps)).toMatchObject({ skipped: true });
    expect(linear.calls.map(({ method }) => method)).toEqual(['getIssue']);
  });

  it('enforce denied replies in the synced thread then cancels; posts the comment before changing state', async () => {
    const { linear, deps, args } = setup();
    const result = await applyOutcome({ ...args, outcome: evaluated('denied') }, deps);
    expect(result.actions).toEqual(['label:+demo', 'comment:memory-comment-1', 'state:canceled']);
    const methods = linear.calls.map(({ method }) => method);
    expect(methods.indexOf('createComment')).toBeLessThan(methods.indexOf('updateIssue'));
    const ticket = await linear.getIssueWithComments(issue.id);
    expect(ticket?.issue.stateId).toBe('canceled');
    expect(ticket?.comments.at(-1)).toMatchObject({ parentId: 'root', body: expect.stringContaining('request not accepted') });
  });

  it('enforce denied on a ticket already canceled does not update the state', async () => {
    const { linear, deps, args } = setup({ stateId: 'canceled', stateType: 'canceled' });
    await applyOutcome({ ...args, startedFrom: 'canceled', outcome: evaluated('denied') }, deps);
    expect(linear.calls.map(({ method }) => method)).toEqual(['getIssue', 'addLabel', 'createComment']);
  });

  it('enforce waiting returns the wait expiry and moves a recheck back to Triage', async () => {
    const { linear, deps, args } = setup({ stateId: 'canceled', stateType: 'canceled' });
    const outcome = evaluated('waiting');
    const result = await applyOutcome({ ...args, startedFrom: 'canceled', outcome }, deps);
    expect(result).toEqual({ skipped: false, actions: ['label:+demo', 'comment:memory-comment-1', 'state:triage'], waitExpiresAt: '2026-10-27T12:00:00.000Z' });
    expect((await linear.getIssue(issue.id))?.stateId).toBe('triage');
  });

  it('enforce accepted assigns the triage owner and returns a recheck to Triage in one update', async () => {
    const { linear, deps, args } = setup({ stateId: 'canceled', stateType: 'canceled' });
    const result = await applyOutcome({ ...args, startedFrom: 'canceled', outcome: evaluated('accepted') }, deps);
    expect(result.actions).toEqual(['label:+demo', 'comment:memory-comment-1', 'state:triage', 'assign:ela@evertrust.fr']);
    expect(linear.calls.filter(({ method }) => method === 'updateIssue')).toEqual([{ method: 'updateIssue', args: [issue.id, { stateId: 'triage', assigneeId: 'ela' }] }]);
    expect((await linear.getIssue(issue.id))?.assignee?.email).toBe('ela@evertrust.fr');
  });

  it.each(['owner.active', 'owner.away'] as const)('leaves the assignee untouched when an %s annotation exists', async (key) => {
    const assignee = { id: 'previous', email: 'previous@example.com', name: 'Previous' };
    const { linear, deps, args } = setup({ assignee });
    await applyOutcome({ ...args, outcome: evaluated('accepted', [{ key, owner: 'Soufiane', ticket: 'PRE-1', freeOnSlot: true }]) }, deps);
    expect(linear.calls.some(({ method }) => method === 'updateIssue')).toBe(false);
    expect((await linear.getIssue(issue.id))?.assignee).toEqual(assignee);
  });

  it('enforce comment goes top-level without a synced thread', async () => {
    const { linear, deps, args } = setup({}, [{ ...root, body: 'ordinary comment' }]);
    await applyOutcome({ ...args, outcome: evaluated('denied') }, deps);
    expect((await linear.getIssueWithComments(issue.id))?.comments.at(-1)?.parentId).toBeNull();
  });

  it('pending_retry throws before any read or write', async () => {
    const { linear, deps, args } = setup();
    await expect(applyOutcome({ ...args, outcome: evaluated('pending_retry') }, deps)).rejects.toThrow('applyOutcome called with pending_retry');
    expect(linear.calls).toEqual([]);
  });

  it.each(['shadow', 'enforce'] as const)('postHandoff in %s uses the correct thread and prefix', async (mode) => {
    const { linear, deps, args } = setup();
    const result = await postHandoff({ ...args, mode }, deps);
    expect(result).toEqual({ skipped: false, actions: ['comment:memory-comment-1'], waitExpiresAt: null });
    expect(linear.calls.map(({ method }) => method)).toEqual(['getIssue', 'createComment']);
    const comment = (await linear.getIssueWithComments(issue.id))?.comments.at(-1);
    expect(comment?.parentId).toBe(mode === 'shadow' ? null : 'root');
    expect(comment?.body).toContain('Automatic triage is unavailable, manual triage needed.');
    if (mode === 'shadow') expect(comment?.body).toMatch(/^Shadow mode, no action taken:\n\nVerdict: pending_retry/);
  });

  it('expireWait comments then cancels', async () => {
    const { linear, deps, args } = setup();
    const result = await expireWait({ ...args, language: 'en' }, deps);
    expect(result).toEqual({ skipped: false, actions: ['comment:memory-comment-1', 'state:canceled'], waitExpiresAt: null });
    expect(linear.calls.map(({ method }) => method)).toEqual(['getIssue', 'createComment', 'updateIssue']);
    const ticket = await linear.getIssueWithComments(issue.id);
    expect(ticket?.comments.at(-1)).toMatchObject({ parentId: 'root', body: expect.stringContaining('No answer from the requester was received.') });
    expect(ticket?.issue.stateId).toBe('canceled');
  });

  it.each(['handoff', 'expiry'] as const)('%s honors the pre-action check', async (action) => {
    const { linear, deps, args } = setup({ stateType: 'started', stateId: 'started' });
    const result = action === 'handoff' ? await postHandoff(args, deps) : await expireWait({ ...args, language: 'fr' }, deps);
    expect(result.skipped).toBe(true);
    expect(linear.calls.map(({ method }) => method)).toEqual(['getIssue']);
  });

  it('does not change the state if posting the comment fails', async () => {
    const { linear, deps, args } = setup();
    linear.failNext('createComment', new Error('write failed'));
    await expect(applyOutcome({ ...args, outcome: evaluated('denied') }, deps)).rejects.toThrow('write failed');
    expect(linear.calls.some(({ method }) => method === 'updateIssue')).toBe(false);
  });
});

describe('computeWaitExpiry', () => {
  const slot: SlotWindow = { startUtc: '2026-10-22T11:00Z', endUtc: '2026-10-22T12:00Z', timezone: 'Europe/Paris', timezoneAssumed: false };
  it.each([
    { slot, deadline: null, expected: '2026-10-22T11:00:00.000Z' },
    { slot, deadline: '2026-10-21', expected: '2026-10-21T21:59:59.999Z' },
    { slot: null, deadline: null, expected: '2026-10-27T12:00:00.000Z' },
    { slot: { ...slot, startUtc: '2026-10-20T08:00Z' }, deadline: '2026-10-19', expected: '2026-10-27T12:00:00.000Z' },
    { slot: { ...slot, startUtc: NOW }, deadline: null, expected: '2026-10-27T12:00:00.000Z' },
  ])('picks the earliest future candidate: $expected', ({ slot, deadline, expected }) => {
    expect(computeWaitExpiry(clock(), 7, slot, deadline, 'Europe/Paris').toISOString()).toBe(expected);
  });
});
