import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryGraph, MemoryLlm, MemoryTwenty } from '../src/clients/memory.js';
import type { LinearComment, LinearIssue, LinearWorkspace } from '../src/clients/types.js';
import { defaultConfig } from '../src/config.js';
import type { TicketFacts } from '../src/domain/types.js';
import { DependencyError } from '../src/errors.js';
import { refreshIndex, runTick, type PollerDeps } from '../src/poller.js';
import { openStore, type Store } from '../src/store/store.js';
import { PRE_301 } from './fixtures/asks.js';
import { baseFacts, COMPANY_ID, ev, NOW, OPP_ID } from './helpers/facts.js';
import { MemoryLinear, failing } from './helpers/memory-linear.js';

const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
const workspace: LinearWorkspace = {
  teamId: 'pre', triageStateId: 'triage', canceledStateId: 'canceled', triageOwnerId: 'ela',
  labelIds: { demo: 'demo-label', 'technical discovery': 'discovery-label', poc: 'poc-label', 'rfi rfp': 'rfx-label' },
  users: [{ id: 'user-dustin', name: 'Dustin GUILHOT', displayName: 'Dustin', email: 'dustin@evertrust.fr' },
    { id: 'ela', name: 'Etienne', displayName: 'Etienne', email: 'ela@evertrust.fr' }],
};

function setup(enforce = false) {
  let now = NOW;
  const clock = () => new Date(now);
  const facts = baseFacts();
  const issue: LinearIssue = {
    id: 'issue-1', identifier: 'PRE-900', number: 900, title: 'Demo for Infomil',
    description: PRE_301.replaceAll('797db51c-36bd-5669-9966-ae08d78f1e77', OPP_ID),
    createdAt: '2026-10-20T09:00:00.000Z', updatedAt: NOW, completedAt: null,
    stateId: 'triage', stateType: 'triage', assignee: null, labels: [], attachmentTitles: ['Ask from Dustin GUILHOT'],
  };
  const ticketFacts: TicketFacts = { ...facts.ticketFacts, slot: { ...facts.ticketFacts.slot!, date: '2026-11-02', start: '15:00', end: '16:00', evidence: ev('Meeting at 15h-16h') } };
  const outputs = {
    ticketFacts,
    qualification: { ...facts.deal!.qualification, ...facts.deal!.noteFacts, discoveryEvidence: ev('Discovery call done.', 'note-1') },
  };
  const store = openStore(':memory:'); stores.push(store);
  const deps = {
    config: { ...defaultConfig(), enforce },
    linear: new MemoryLinear({ issues: [{ issue, comments: [] }], viewerId: 'bot', workspace }, clock),
    twenty: new MemoryTwenty({ opportunities: [facts.deal!.opportunity], companies: [], quotes: [], notes: [{
      id: 'note-1', opportunityId: OPP_ID, companyId: null, createdAt: '2026-09-01T10:00:00.000Z',
      bodyMarkdown: 'documented; 1000 certificates; Discovery call done.',
    }] }),
    graph: new MemoryGraph({ 'sbo@evertrust.fr': true, 'vdo@evertrust.fr': true, 'ela@evertrust.fr': true }),
    llm: new MemoryLlm(outputs, 'poller-model'), store, workspace, botUserId: 'bot', clock, random: () => 0, log: vi.fn(),
  } satisfies PollerDeps;
  return { deps, issue, outputs, time: (value: string) => { now = value; } };
}
type Setup = ReturnType<typeof setup>;

async function change(s: Setup, patch: Partial<LinearIssue> = {}, comment?: Partial<LinearComment>) {
  const ticket = (await s.deps.linear.getIssueWithComments(s.issue.id))!;
  const comments = comment === undefined ? ticket.comments : [...ticket.comments, {
    id: `reply-${ticket.comments.length}`, issueId: s.issue.id, body: 'More details', createdAt: s.deps.clock().toISOString(),
    parentId: null, authorId: 'user-dustin', authorName: 'Dustin GUILHOT', ...comment,
  }];
  s.deps.linear = new MemoryLinear({ issues: [{ issue: { ...ticket.issue, updatedAt: s.deps.clock().toISOString(), ...patch }, comments }], viewerId: 'bot', workspace }, s.deps.clock);
}
const record = (s: Setup) => s.deps.store.tickets.get(s.issue.id);
const audits = (s: Setup) => s.deps.store.audit.listForIssue(s.issue.id);
async function botComments(s: Setup) {
  return (await s.deps.linear.getIssueWithComments(s.issue.id))!.comments.filter(({ authorId }) => authorId === 'bot');
}

describe('runTick', () => {
  it('retries instead of evaluating stale history when a later index refresh fails', async () => {
    const s = setup(true); await change(s, { stateId: 'done', stateType: 'completed' });
    await runTick(s.deps); expect(s.deps.store.index.isBackfillComplete()).toBe(true);
    s.time('2026-10-20T12:02:00.000Z'); await change(s, { stateId: 'triage', stateType: 'triage' });
    s.deps.linear.failNext('listIssuesUpdatedSince', new DependencyError('linear', 'index offline'));
    s.deps.twenty.calls.length = 0;
    await runTick(s.deps);
    expect(record(s)).toMatchObject({ status: 'pending_retry', firstFailureAt: '2026-10-20T12:02:00.000Z', lastError: 'index offline' });
    expect(await botComments(s)).toEqual([]); expect(s.deps.twenty.calls).toEqual([]);
    expect(s.deps.llm.inputs.ticket).toEqual([]);
    s.time('2026-10-20T14:02:00.000Z');
    s.deps.linear.failNext('listIssuesUpdatedSince', new DependencyError('linear', 'index offline'));
    await runTick(s.deps);
    expect(record(s)?.status).toBe('handed_off'); expect(await botComments(s)).toHaveLength(1);
  });

  it('evaluates a new triage ticket in shadow mode and records an audit row with hash and model', async () => {
    const s = setup(); await runTick(s.deps);
    expect(record(s)).toMatchObject({ status: 'accepted', mode: 'shadow', startedFrom: 'triage', firstFailureAt: null, lastError: null, lastEvaluatedAt: NOW });
    expect(audits(s)[0]).toMatchObject({ inputHash: expect.stringMatching(/^[a-f0-9]{64}$/), model: 'poller-model', verdict: 'accepted', rawLlm: { model: 'poller-model' }, facts: { ticket: { identifier: 'PRE-900' } } });
    expect(audits(s)[0]?.results.length).toBeGreaterThan(0);
    expect(s.deps.log).toHaveBeenCalledWith('info', 'audit', audits(s)[0]);
    expect(await botComments(s)).toHaveLength(1);
    expect((await s.deps.linear.getIssue(s.issue.id))?.assignee).toBeNull();
    expect(s.deps.store.index.isBackfillComplete()).toBe(true);
    expect(s.deps.store.cursors.get('index_updated_at')).toBe(NOW);
  });

  it('does not re-evaluate when the input hash is unchanged', async () => {
    const s = setup(); await runTick(s.deps); await runTick(s.deps);
    expect(await botComments(s)).toHaveLength(1); expect(s.deps.llm.inputs.ticket).toHaveLength(1);
  });

  it('uses the same free-member order for repeated evaluations of a ticket', async () => {
    const s = setup();
    const values = [0, 0, 0.99, 0.99];
    s.deps.random = () => values.shift() ?? 0;
    await runTick(s.deps);
    await change(s, {}, { body: 'Updated requirements' });
    await runTick(s.deps);
    expect(audits(s)[1]?.annotations).toEqual(audits(s)[0]?.annotations);
  });

  it('re-evaluates after a requester reply but not after someone else\'s comment', async () => {
    const s = setup(); await runTick(s.deps);
    await change(s, {}, { authorId: 'someone', authorName: 'Someone' }); await runTick(s.deps);
    expect(audits(s)).toHaveLength(1);
    await change(s, {}, { body: 'Updated requirements' }); await runTick(s.deps);
    expect(audits(s)).toHaveLength(2); expect(record(s)?.commentIds).toHaveLength(1);
  });

  it('treats a Slack-synced requester reply with null author as a trigger', async () => {
    const s = setup(); await runTick(s.deps);
    await change(s, {}, { authorId: null, parentId: 'slack-thread' }); await runTick(s.deps);
    expect(audits(s)).toHaveLength(2); expect(s.deps.llm.inputs.ticket[1]?.sources.at(-1)?.text).toBe('More details');
  });

  it('never touches a ticket with the override label', async () => {
    const s = setup(true); await change(s, { labels: [{ id: 'override', name: 'triage-override' }] });
    await runTick(s.deps);
    expect(record(s)).toBeNull(); expect(await botComments(s)).toEqual([]); expect(s.deps.llm.inputs.ticket).toEqual([]);
  });

  it('re-evaluates when the mode changes', async () => {
    const s = setup(); await runTick(s.deps); s.deps.config.enforce = true; await runTick(s.deps);
    expect(audits(s)).toHaveLength(2); expect(record(s)?.mode).toBe('enforce');
    expect((await s.deps.linear.getIssue(s.issue.id))?.assignee?.id).toBe('ela');
  });

  it('accepted in enforce re-evaluates on a requester reply, not on a body edit', async () => {
    const s = setup(true); await runTick(s.deps);
    await change(s, { description: `${s.issue.description}\nExtra text` }); await runTick(s.deps);
    expect(audits(s)).toHaveLength(1);
    await change(s, {}, { body: 'New detail' }); await runTick(s.deps); expect(audits(s)).toHaveLength(2);
  });

  it.each([true, false])('rechecks a bot-canceled ticket only for the requester (requester: %s)', async (requester) => {
    const s = setup(true); await change(s, { description: s.issue.description.replaceAll(OPP_ID, 'invalid') });
    await runTick(s.deps); expect(record(s)?.status).toBe('denied');
    s.time('2026-10-20T12:04:00.000Z');
    await change(s, { description: s.issue.description }, { body: 'recheck please', ...(requester ? {} : { authorId: 'other', authorName: 'Other' }) });
    await runTick(s.deps);
    expect(record(s)?.status).toBe(requester ? 'accepted' : 'denied');
    expect((await s.deps.linear.getIssue(s.issue.id))?.stateId).toBe(requester ? 'triage' : 'canceled');
    expect(audits(s)).toHaveLength(requester ? 2 : 1);
  });

  it('does not reopen a shadow-mode denial after a recheck reply', async () => {
    const s = setup(true); await change(s, { description: s.issue.description.replaceAll(OPP_ID, 'invalid') });
    await runTick(s.deps);
    s.deps.store.tickets.upsert({ ...record(s)!, mode: 'shadow' });
    s.time('2026-10-20T12:04:00.000Z'); await change(s, { description: s.issue.description }, { body: 'recheck' });
    await runTick(s.deps);
    expect(record(s)).toMatchObject({ status: 'denied', mode: 'shadow' });
    expect((await s.deps.linear.getIssue(s.issue.id))?.stateId).toBe('canceled');
    expect(audits(s)).toHaveLength(1);
  });

  it('first run starts the comment cursor at now', async () => {
    const s = setup(true); await runTick(s.deps);
    expect(s.deps.store.cursors.get('comments_created_at')).toBe(NOW);
    expect(s.deps.linear.calls.some(({ method }) => method === 'listCommentsCreatedSince')).toBe(false);
  });

  it('keeps the recheck cursor when fetching an issue fails and picks it up next tick', async () => {
    const s = setup(true); await change(s, { description: s.issue.description.replaceAll(OPP_ID, 'invalid') });
    await runTick(s.deps); expect(record(s)?.status).toBe('denied');
    const cursor = s.deps.store.cursors.get('comments_created_at');
    s.time('2026-10-20T12:04:00.000Z');
    await change(s, { description: s.issue.description }, { body: 'recheck please' });
    s.deps.linear.failNext('getIssueWithComments', new DependencyError('linear', 'fetch offline'));
    await runTick(s.deps);
    expect(s.deps.store.cursors.get('comments_created_at')).toBe(cursor);
    expect(record(s)?.status).toBe('denied'); expect(audits(s)).toHaveLength(1);
    await runTick(s.deps);
    expect(record(s)?.status).toBe('accepted');
    expect(s.deps.store.cursors.get('comments_created_at')).toBe('2026-10-20T12:04:00.000Z');
    expect((await s.deps.linear.getIssue(s.issue.id))?.stateId).toBe('triage');
  });

  it('keeps the first wait expiry across later questions', async () => {
    const s = setup(true); s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...s.outputs.ticketFacts.slot!, date: null, isComplete: false } }; await runTick(s.deps);
    expect(record(s)?.status).toBe('waiting'); const wait = s.deps.store.waits.get(s.issue.id);
    expect(wait).not.toBeNull(); s.time('2026-10-21T12:00:00.000Z');
    await change(s, {}, { body: 'Still no slot' }); await runTick(s.deps);
    expect(record(s)?.status).toBe('waiting'); expect(audits(s)).toHaveLength(2);
    expect(s.deps.store.waits.get(s.issue.id)).toEqual(wait);
  });

  it('expires a wait in enforce mode with a denial', async () => {
    const s = setup(true); s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...s.outputs.ticketFacts.slot!, date: null, isComplete: false } }; await runTick(s.deps);
    s.time('2026-10-28T12:00:00.000Z'); await runTick(s.deps);
    expect((await botComments(s)).at(-1)?.body).toContain('No answer from the requester was received.');
    expect((await s.deps.linear.getIssue(s.issue.id))?.stateId).toBe('canceled');
    expect(record(s)).toMatchObject({ status: 'denied', lastAskKeys: [], commentIds: [] });
    expect(s.deps.store.waits.get(s.issue.id)).toBeNull(); expect(audits(s).at(-1)?.verdict).toBe('denied');
  });

  it('deletes an expired wait when a requester replies after a human moves the ticket out of Triage', async () => {
    const s = setup(true); s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...s.outputs.ticketFacts.slot!, date: null, isComplete: false } };
    await runTick(s.deps);
    s.time('2026-10-28T12:00:00.000Z');
    await change(s, { stateId: 'done', stateType: 'completed' }, { body: 'Please check' });
    await runTick(s.deps);
    expect(s.deps.store.waits.get(s.issue.id)).toBeNull();
    expect((await s.deps.linear.getIssue(s.issue.id))?.stateId).toBe('done');
    expect(await botComments(s)).toHaveLength(1);
  });

  it.each(['getIssueWithComments', 'createComment', 'updateIssue'] as const)('continues expiring waits after the first wait fails at %s', async (method) => {
    const s = setup(true); s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...s.outputs.ticketFacts.slot!, date: null, isComplete: false } };
    await runTick(s.deps);
    const first = (await s.deps.linear.getIssueWithComments(s.issue.id))!;
    const second = { ...first.issue, id: 'issue-2', identifier: 'PRE-901', number: 901 };
    s.deps.linear = new MemoryLinear({ issues: [first, { issue: second, comments: [] }], viewerId: 'bot', workspace }, s.deps.clock);
    s.deps.store.tickets.upsert({ ...record(s)!, issueId: second.id, identifier: second.identifier });
    s.deps.store.waits.createIfAbsent(second.id, s.deps.store.waits.get(s.issue.id)!.expiresAt, NOW);
    const previous = record(s); const wait = s.deps.store.waits.get(s.issue.id);
    s.time('2026-10-28T12:00:00.000Z');
    s.deps.linear.failNext(method, new DependencyError('linear', 'expiry offline'));
    await runTick(s.deps);
    expect(s.deps.store.tickets.get(second.id)?.status).toBe('denied');
    expect((await s.deps.linear.getIssue(second.id))?.stateId).toBe('canceled');
    expect(s.deps.store.waits.get(second.id)).toBeNull();
    expect(record(s)).toEqual(previous); expect(s.deps.store.waits.get(s.issue.id)).toEqual(wait);
    expect(audits(s)).toHaveLength(1);
    expect(s.deps.log).toHaveBeenCalledWith('warn', 'wait_expiry', { dependency: 'linear', error: 'expiry offline' });
    await runTick(s.deps);
    expect(record(s)?.status).toBe('denied'); expect(s.deps.store.waits.get(s.issue.id)).toBeNull();
  });

  it('does not expire a wait while the ticket is pending_retry', async () => {
    const s = setup(true); s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...s.outputs.ticketFacts.slot!, date: null, isComplete: false } }; await runTick(s.deps);
    s.time('2026-10-28T12:00:00.000Z'); await change(s, {}, { body: 'Please check' });
    await runTick({ ...s.deps, twenty: failing(s.deps.twenty, 'twenty') });
    expect(record(s)?.status).toBe('pending_retry'); expect(s.deps.store.waits.get(s.issue.id)).not.toBeNull();
    expect(await botComments(s)).toHaveLength(1);
  });

  it('pending_retry on a dependency error, then hands off after 2 hours, then stops retrying', async () => {
    const s = setup(true); const getOpportunity = vi.spyOn(s.deps.twenty, 'getOpportunity').mockRejectedValue(new DependencyError('twenty', 'offline'));
    await runTick(s.deps); expect(record(s)).toMatchObject({ status: 'pending_retry', inputHash: null, firstFailureAt: NOW });
    expect(await botComments(s)).toEqual([]);
    s.time('2026-10-20T13:00:00.000Z'); await runTick(s.deps); expect(record(s)?.status).toBe('pending_retry');
    s.time('2026-10-20T14:00:00.000Z'); await runTick(s.deps);
    expect(record(s)).toMatchObject({ status: 'handed_off', firstFailureAt: null });
    expect((await botComments(s))[0]?.body).toContain('Automatic triage is unavailable, manual triage needed.');
    s.time('2026-10-20T14:02:00.000Z'); getOpportunity.mockClear(); await runTick(s.deps);
    // Index refresh still reads Twenty; no second call for evaluation.
    expect(getOpportunity).toHaveBeenCalledTimes(1); expect(audits(s)).toHaveLength(3);
    s.time('2026-10-20T14:04:00.000Z'); await change(s, {}, { body: 'Please try again' }); await runTick(s.deps);
    expect(record(s)).toMatchObject({ status: 'pending_retry', firstFailureAt: '2026-10-20T14:04:00.000Z' });
    expect(await botComments(s)).toHaveLength(1);
  });

  it('retries a failed recheck on the next tick and hands it off after 2 hours', async () => {
    const s = setup(true); await change(s, { description: s.issue.description.replaceAll(OPP_ID, 'invalid') });
    await runTick(s.deps); expect(record(s)?.status).toBe('denied');
    s.time('2026-10-20T12:04:00.000Z'); await change(s, { description: s.issue.description }, { body: 'recheck' });
    const deps = { ...s.deps, twenty: failing(s.deps.twenty, 'twenty') };
    await runTick(deps); expect(record(s)).toMatchObject({ status: 'pending_retry', startedFrom: 'canceled' });
    s.time('2026-10-20T13:04:00.000Z'); await runTick(deps); expect(audits(s)).toHaveLength(3);
    s.time('2026-10-20T14:04:00.000Z'); await runTick(deps);
    expect(record(s)).toMatchObject({ status: 'handed_off', startedFrom: 'canceled', firstFailureAt: null });
    expect(await botComments(s)).toHaveLength(2);
    await runTick(deps); expect(audits(s)).toHaveLength(4);
  });

  it('returns pending_retry before the backfill completes', async () => {
    const s = setup(); s.deps.linear.failNext('listIssuesUpdatedSince', new DependencyError('linear', 'offline'));
    await runTick(s.deps);
    expect(record(s)?.status).toBe('pending_retry'); expect(await botComments(s)).toEqual([]);
    expect(s.deps.store.cursors.get('index_updated_at')).toBeNull(); expect(s.deps.store.index.isBackfillComplete()).toBe(false);
    expect(audits(s)[0]).toMatchObject({ results: [], error: 'offline' });
    await runTick(s.deps); expect(record(s)?.status).toBe('accepted');
  });

  it('indexes partner-only company asks and skips tickets without a link', async () => {
    const s = setup(); const assignee = { id: 'ela', name: 'Etienne', email: 'ela@evertrust.fr' };
    await change(s, { description: s.issue.description.replace('End customer', 'Partner').replaceAll(`opportunity/${OPP_ID}`, `company/${COMPANY_ID}`), stateId: 'done', stateType: 'completed', completedAt: NOW, assignee });
    await runTick(s.deps);
    expect(s.deps.store.index.latestWorkedTicket(COMPANY_ID, 'other')).toMatchObject({ issueId: s.issue.id, number: 900, completedAt: NOW });
    expect(s.deps.store.index.hasCompletedTicket(COMPANY_ID, 'demo', NOW, 'other')).toBe(true);
    expect(s.deps.twenty.calls).toEqual([]);
    await change(s, { description: 'Not a form' }); await runTick(s.deps);
    expect(s.deps.store.index.latestWorkedTicket(COMPANY_ID, 'other')).toBeNull();
  });

  it('does not expire a wait if collecting candidates fails', async () => {
    const s = setup(true); s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...s.outputs.ticketFacts.slot!, date: null, isComplete: false } }; await runTick(s.deps);
    s.time('2026-10-28T12:00:00.000Z'); s.deps.linear.failNext('listCommentsCreatedSince', new DependencyError('linear', 'offline'));
    await runTick(s.deps); expect(record(s)?.status).toBe('waiting'); expect(await botComments(s)).toHaveLength(1);
    expect(s.deps.store.waits.get(s.issue.id)).not.toBeNull();
  });

  it('processes an unread requester answer before expiring a wait', async () => {
    const s = setup(true); s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...s.outputs.ticketFacts.slot!, date: null, isComplete: false } }; await runTick(s.deps);
    s.time('2026-10-28T12:00:00.000Z'); s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...baseFacts().ticketFacts.slot!, date: '2026-11-02', evidence: ev('Meeting at 15h-16h') } };
    await change(s, {}, { body: 'Confirmed' }); await runTick(s.deps);
    expect(record(s)?.status).toBe('accepted'); expect(s.deps.store.waits.get(s.issue.id)).toBeNull();
    expect(audits(s).map(({ verdict }) => verdict)).toEqual(['waiting', 'accepted']);
  });

  it('keeps an expired wait when a requester reply arrives after candidate collection', async () => {
    const s = setup(true); s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...s.outputs.ticketFacts.slot!, date: null, isComplete: false } };
    await runTick(s.deps); const wait = s.deps.store.waits.get(s.issue.id);
    s.time('2026-10-28T12:00:00.000Z');
    const listTriage = s.deps.linear.listTriageIssues.bind(s.deps.linear);
    vi.spyOn(s.deps.linear, 'listTriageIssues').mockImplementationOnce(async (team) => {
      const collected = await listTriage(team);
      await change(s, {}, { body: 'Confirmed' });
      return collected;
    });
    await runTick(s.deps);
    expect(record(s)?.status).toBe('waiting'); expect(s.deps.store.waits.get(s.issue.id)).toEqual(wait);
    expect((await s.deps.linear.getIssue(s.issue.id))?.stateId).toBe('triage');
    expect(await botComments(s)).toHaveLength(1); expect(audits(s)).toHaveLength(1);
    s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...baseFacts().ticketFacts.slot!, date: '2026-11-02', evidence: ev('Meeting at 15h-16h') } };
    await runTick(s.deps);
    expect(record(s)?.status).toBe('accepted'); expect(s.deps.store.waits.get(s.issue.id)).toBeNull();
  });

  it('audits a skipped action and leaves the previous ticket record unchanged', async () => {
    const s = setup(); await runTick(s.deps); const previous = record(s);
    await change(s, {}, { body: 'New details' });
    vi.spyOn(s.deps.linear, 'getIssue').mockResolvedValueOnce(null);
    await runTick(s.deps);
    expect(record(s)).toEqual(previous); expect(await botComments(s)).toHaveLength(1);
    expect(audits(s).at(-1)?.actions).toEqual(['skipped:pre-action-check']);
  });

  it('records manual triage with no asks or LLM output', async () => {
    const s = setup(); await change(s, { description: 'A request outside the Asks form' }); await runTick(s.deps);
    expect(record(s)).toMatchObject({ status: 'manual', lastAskKeys: [], language: 'en', firstFailureAt: null });
    expect(audits(s)[0]).toMatchObject({ verdict: 'manual', model: null, rawLlm: null, facts: null, results: [] });
    expect(await botComments(s)).toHaveLength(1);
  });

  it('keeps pending_retry and the failure clock when posting handoff fails', async () => {
    const s = setup(true); vi.spyOn(s.deps.twenty, 'listNotes').mockRejectedValue(new DependencyError('twenty', 'offline'));
    await runTick(s.deps); s.time('2026-10-20T14:00:00.000Z');
    s.deps.linear.failNext('createComment', new DependencyError('linear', 'offline'));
    await runTick(s.deps);
    expect(record(s)).toMatchObject({ status: 'pending_retry', firstFailureAt: NOW, inputHash: null });
    expect(await botComments(s)).toEqual([]);
    s.time('2026-10-20T14:02:00.000Z'); await runTick(s.deps);
    expect(record(s)).toMatchObject({ status: 'handed_off', firstFailureAt: null });
    expect(await botComments(s)).toHaveLength(1);
  });

  it('logs unexpected evaluation errors with a stack and retries without commenting', async () => {
    const s = setup(); vi.spyOn(s.deps.llm, 'extractTicketFacts').mockRejectedValue(new Error('unexpected failure'));
    await runTick(s.deps);
    expect(record(s)).toMatchObject({ status: 'pending_retry', lastError: 'unexpected failure' });
    expect(s.deps.log).toHaveBeenCalledWith('error', 'evaluate', expect.objectContaining({ stack: expect.stringContaining('unexpected failure') }));
    expect(await botComments(s)).toEqual([]);
  });

  it('logs a rule-level pending_retry at warn without a stack', async () => {
    const s = setup(); s.deps.store.cursors.set('index_updated_at', NOW);
    await runTick(s.deps);
    expect(record(s)?.status).toBe('pending_retry'); expect(await botComments(s)).toEqual([]);
    expect(audits(s)[0]?.results.some(({ outcome }) => outcome.kind === 'error')).toBe(true);
    expect(s.deps.log).toHaveBeenCalledWith('warn', 'evaluate', { error: record(s)?.lastError });
    expect(s.deps.log.mock.calls.some(([level]) => level === 'error')).toBe(false);
  });

  it('does not advance the index cursor when resolving a changed issue fails', async () => {
    const s = setup(); await runTick(s.deps); s.time('2026-10-20T12:02:00.000Z');
    await change(s, { description: s.issue.description.replaceAll(OPP_ID, '22222222-2222-4222-8222-222222222222') });
    vi.spyOn(s.deps.twenty, 'getOpportunity').mockRejectedValueOnce(new DependencyError('twenty', 'offline'));
    await runTick(s.deps); expect(s.deps.store.cursors.get('index_updated_at')).toBe(NOW);
    expect(audits(s)).toHaveLength(2);
  });

  it('does not re-request resolved opportunities after a partial index refresh fails', async () => {
    const s = setup();
    const secondOpportunityId = '22222222-2222-4222-8222-222222222222';
    const second = { ...s.issue, id: 'issue-2', identifier: 'PRE-901', number: 901,
      description: s.issue.description.replaceAll(OPP_ID, secondOpportunityId), updatedAt: '2026-10-20T10:01:00.000Z' };
    s.deps.linear = new MemoryLinear({ issues: [{ issue: s.issue, comments: [] }, { issue: second, comments: [] }], viewerId: 'bot', workspace }, s.deps.clock);
    const actual = s.deps.twenty.getOpportunity.bind(s.deps.twenty);
    const getOpportunity = vi.spyOn(s.deps.twenty, 'getOpportunity')
      .mockImplementationOnce(actual)
      .mockRejectedValueOnce(new DependencyError('twenty', 'offline'));
    await expect(refreshIndex(s.deps)).rejects.toMatchObject({ dependency: 'twenty' });
    await refreshIndex(s.deps);
    expect(getOpportunity.mock.calls.map(([id]) => id)).toEqual([OPP_ID, secondOpportunityId, secondOpportunityId]);
  });

  it('deletes an expired wait when its issue no longer exists', async () => {
    const s = setup(true); s.outputs.ticketFacts = { ...s.outputs.ticketFacts, slot: { ...s.outputs.ticketFacts.slot!, date: null, isComplete: false } };
    await runTick(s.deps); s.time('2026-10-28T12:00:00.000Z');
    vi.spyOn(s.deps.linear, 'getIssueWithComments').mockResolvedValueOnce(null);
    await runTick(s.deps);
    expect(s.deps.store.waits.get(s.issue.id)).toBeNull(); expect(audits(s)).toHaveLength(1);
  });
});
