import { afterEach, describe, expect, it } from 'vitest';
import { MemoryGraph, MemoryLlm, MemoryTwenty, type MemoryTwentyData } from '../src/clients/memory.js';
import type { LinearComment, LinearIssue } from '../src/clients/types.js';
import { defaultConfig } from '../src/config.js';
import type { Opportunity, QualificationExtraction, TicketFacts } from '../src/domain/types.js';
import { evaluateTicket } from '../src/evaluate.js';
import type { GatherInput } from '../src/facts/gather.js';
import { openStore, type Store } from '../src/store/store.js';
import { ticketInput } from '../src/triggers.js';
import { ATTACHMENTS, PRE_282, PRE_303, PRE_304 } from './fixtures/asks.js';
import { baseFacts, COMPANY_ID, ev, NOW, OPP_ID } from './helpers/facts.js';
import { failing } from './helpers/memory-linear.js';

const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
const note = { id: 'note-1', createdAt: '2026-09-01T10:00:00.000Z', bodyMarkdown: 'documented; 1000 certificates; Discovery call done.', opportunityId: OPP_ID, companyId: null };
const slot = { date: '2026-10-22', start: '13:00', end: '14:00', timezone: null, isComplete: true, ambiguity: null, evidence: ev('Target date: 22.10. 13:00 - 14:00') };

function setup(options: {
  issue?: Partial<LinearIssue>; opportunity?: Partial<Opportunity>; data?: Partial<MemoryTwentyData>;
  qualification?: Partial<QualificationExtraction>; ticketFacts?: Partial<TicketFacts>; backfill?: boolean;
} = {}) {
  const base = baseFacts();
  const issue: LinearIssue = {
    id: 'issue-1', identifier: 'PRE-304', number: 304, title: 'Demo for Sefe',
    description: PRE_304.replaceAll('2341bae4-2621-4cf5-b5f3-ffe7ae25362d', OPP_ID),
    createdAt: '2026-10-20T09:00:00.000Z', updatedAt: NOW, completedAt: null,
    stateId: 'triage', stateType: 'triage', assignee: null, labels: [], attachmentTitles: ATTACHMENTS['PRE-304'], ...options.issue,
  };
  const input: GatherInput = { issue, requester: { name: 'Hilde WALDENFELS', linearUserId: 'hilde' }, requesterComments: [], lastAskKeys: [] };
  const data: MemoryTwentyData = { opportunities: [{ ...base.deal!.opportunity, ...options.opportunity }], companies: [], notes: [note], quotes: [], ...options.data };
  const outputs = {
    ticketFacts: { ...base.ticketFacts, slot, ...options.ticketFacts },
    qualification: { ...base.deal!.qualification, ...base.deal!.noteFacts, discoveryEvidence: ev('Discovery call done.', note.id), ...options.qualification },
  };
  const store = openStore(':memory:'); stores.push(store);
  if (options.backfill !== false) store.cursors.set('backfill_complete', 'true');
  const deps = {
    config: defaultConfig(), twenty: new MemoryTwenty(data),
    graph: new MemoryGraph({ 'sbo@evertrust.fr': true, 'vdo@evertrust.fr': false, 'ela@evertrust.fr': true }),
    llm: new MemoryLlm(outputs, 'replay-model'), history: store.index, clock: () => new Date(NOW), random: () => 0,
  };
  return { input, deps, store, outputs };
}

async function evaluated(s: ReturnType<typeof setup>, input = s.input) {
  const outcome = await evaluateTicket(input, s.deps);
  if (outcome.kind !== 'evaluated') throw new Error(`Expected evaluated, received ${outcome.reason.key}`);
  return outcome;
}

function addHistory(store: Store, email = 'sbo@evertrust.fr', companyId = COMPANY_ID, assigneeName: string | null = 'Previous owner') {
  store.index.upsert({ issueId: 'previous', identifier: 'PRE-250', number: 250, companyId, requestKind: 'technical_discovery', stateType: 'completed', assigneeEmail: email, assigneeName, createdAt: '2026-09-01T10:00:00.000Z', completedAt: '2026-09-02T10:00:00.000Z', updatedAt: NOW });
}

describe('evaluateTicket', () => {
  it.each([
    ['unsupported form', 'Not an Asks form', { key: 'unsupported_form' }],
    ['unknown request type', PRE_304.replace('Product demonstration', 'Technical support'), { key: 'unknown_request_type', requestType: 'Technical support' }],
  ])('returns manual for an %s without calling any client', async (_name, description, reason) => {
    const s = setup({ issue: { description } });
    expect(await evaluateTicket(s.input, s.deps)).toEqual({ kind: 'manual', reason });
    expect(s.deps.twenty.calls).toEqual([]); expect(s.deps.graph.calls).toEqual([]);
    expect(s.deps.llm.inputs).toEqual({ ticket: [], qualification: [] });
  });

  it('dedupes notes and applies the company note age window', async () => {
    const a = { ...note, id: 'A', companyId: COMPANY_ID };
    const s = setup({ data: { notes: [a, { ...note, id: 'B', opportunityId: null, companyId: COMPANY_ID, createdAt: '2025-09-01T00:00:00.000Z' }, { ...note, id: 'C', createdAt: '2023-01-01T00:00:00.000Z' }] } });
    const { facts } = await evaluated(s);
    expect(facts.deal?.notes.map(({ id }) => id)).toEqual(['C', 'A']);
    expect(facts.deal?.notes[1]?.target).toBe('opportunity');
    expect(s.deps.llm.inputs.qualification[0]?.sources.filter(({ id }) => ['A', 'B', 'C'].includes(id)).map(({ id, label }) => [id, label])).toEqual([['C', 'Note on opportunity'], ['A', 'Note on opportunity']]);
  });

  it('treats a null dealtype as NEWBUSINESS', async () => {
    expect((await evaluated(setup({ opportunity: { dealtype: null } }))).facts.deal?.dealType).toBe('NEWBUSINESS');
  });

  it('throws DependencyError on an unknown dealtype', async () => {
    const s = setup({ opportunity: { dealtype: 'PARTNERSHIP' } });
    await expect(evaluateTicket(s.input, s.deps)).rejects.toMatchObject({ name: 'DependencyError', dependency: 'twenty' });
  });

  it('blanks placeholder fields before the LLM and uses its decisionMaker', async () => {
    const s = setup({ opportunity: { decisionnaires: 'TBD' } });
    const { facts } = await evaluated(s);
    expect(s.deps.llm.inputs.qualification[0]?.sources.some(({ id }) => id === 'decisionnaires')).toBe(false);
    expect(facts.deal?.opportunity.decisionnaires).toBe('');
    expect(facts.deal?.qualification.items.decisionMaker).toMatchObject({ status: 'known', value: 'documented', evidence: ev('documented', note.id) });
  });

  it('computes hasPocQuote from quote lines', async () => {
    const s = setup({ data: { quotes: [{ id: 'quote', opportunityId: OPP_ID, status: 'DRAFT', lines: [{ productId: null, name: 'PS-POC', description: '' }] }] } });
    expect((await evaluated(s)).facts.deal?.hasPocQuote).toBe(true);
  });

  it('denies an invalid link without calling Twenty', async () => {
    const s = setup({ issue: { description: PRE_303, identifier: 'PRE-303' } });
    const { result, raw } = await evaluated(s);
    expect(s.deps.twenty.calls).toEqual([]);
    expect(result.verdict).toBe('denied');
    expect(result.denies).toContainEqual({ key: 'crm_link.invalid', raw: '', partnerOnly: true });
    expect(raw.qualification).toBeNull();
  });

  it.each([false, true])('checks the company of a partner-only ask (present: %s)', async (present) => {
    const companyId = 'aa561e6f-d166-5576-93ef-a4cada04a352';
    const s = setup({ issue: { description: PRE_282, identifier: 'PRE-282' }, data: { companies: present ? [{ id: companyId, name: 'Thales UAE' }] : [] } });
    addHistory(s.store, 'SBO@evertrust.fr', companyId);
    const { facts, result } = await evaluated(s);
    expect(facts.linkedRecordFound).toBe(present); expect(facts.companyId).toBe(companyId);
    expect(s.deps.twenty.calls).toEqual([`getCompany:${companyId}`]);
    if (present) expect(facts.history?.owner).toMatchObject({ email: 'SBO@evertrust.fr', name: 'sbo', activeInPool: true, ticketIdentifier: 'PRE-250' });
    else expect(result.denies).toContainEqual({ key: 'crm_link.not_found', recordKind: 'company', id: companyId });
  });

  it('sends only requester comments to both LLM calls, including a Slack reply', async () => {
    const s = setup();
    const reply: LinearComment = { id: 'slack-reply', issueId: s.input.issue.id, body: 'about 800 certificates managed by the CLM', createdAt: NOW, parentId: 'synced', authorId: null, authorName: 'Hilde WALDENFELS' };
    const comments = [{ ...reply, id: 'internal', authorId: 'etienne', authorName: 'Etienne', body: 'internal reply' }, reply];
    const input = { ...s.input, ...ticketInput({ issue: s.input.issue, comments }, [], 'bot') };
    await evaluated(s, input);
    for (const sources of [s.deps.llm.inputs.ticket[0]!.sources, s.deps.llm.inputs.qualification[0]!.sources]) {
      expect(sources.map(({ id }) => id)).not.toContain('internal');
      expect(sources.at(-1)).toEqual({ id: reply.id, label: 'Reply by Hilde WALDENFELS', createdAt: NOW, text: reply.body });
    }
    expect(s.deps.llm.inputs.ticket[0]?.sources[0]).toMatchObject({ id: 'ticket', label: 'Ticket', text: `${s.input.issue.title}\n${s.input.issue.description}` });
  });

  it('a requester reply answers the volume question', async () => {
    const reply: LinearComment = { id: 'volume-reply', issueId: 'issue-1', body: 'about 800 certificates managed by the CLM', createdAt: NOW, parentId: 'synced', authorId: null, authorName: 'Hilde WALDENFELS' };
    const s = setup({ qualification: { volume: { min: 800, max: 800, unitIsClmManagedCerts: true, unclear: false, evidence: ev(reply.body, reply.id) } } });
    const { facts, result } = await evaluated(s, { ...s.input, requesterComments: [reply], lastAskKeys: ['volume_floor.unclear'] });
    expect(s.input.issue.description).toContain('200 public certificate holders');
    expect(facts.deal?.qualification.items.volume).toMatchObject({ status: 'known', value: '800', evidence: ev(reply.body, reply.id) });
    expect(facts.deal?.qualification.volume?.unclear).toBe(false);
    expect(result.results.find(({ ruleId }) => ruleId === 'volume-floor')?.outcome).toEqual({ kind: 'pass' });
    expect(facts.lastAskKeys).toEqual(['volume_floor.unclear']);
  });

  it('drops an LLM fact whose quote is not in its source', async () => {
    const s = setup({ ticketFacts: { additionalRequests: [{ kind: 'demo', evidence: ev('second demo') }] } });
    const { facts, result } = await evaluated(s);
    expect(facts.ticketFacts.additionalRequests).toEqual([]);
    expect(result.results.find(({ ruleId }) => ruleId === 'single-request')?.outcome).toEqual({ kind: 'pass' });
  });

  it('defaults a missing timezone and checks the calendar for active members only', async () => {
    const s = setup();
    const { facts, result, raw, label } = await evaluated(s);
    expect(facts.slotWindow).toEqual({ startUtc: '2026-10-22T11:00:00.000Z', endUtc: '2026-10-22T12:00:00.000Z', timezone: 'Europe/Paris', timezoneAssumed: true });
    expect(s.deps.graph.calls).toEqual([{ emails: ['sbo@evertrust.fr', 'vdo@evertrust.fr', 'ela@evertrust.fr'], start: '2026-10-22T11:00:00.000Z', end: '2026-10-22T12:00:00.000Z' }]);
    expect(facts.calendar?.members).toEqual([{ email: 'sbo@evertrust.fr', name: 'sbo', free: true }, { email: 'vdo@evertrust.fr', name: 'vdo', free: false }, { email: 'ela@evertrust.fr', name: 'ela', free: true }]);
    expect(result.verdict).toBe('accepted'); expect(label).toBe('demo');
    expect(raw).toEqual({ model: 'replay-model', ticketFacts: s.outputs.ticketFacts, qualification: s.outputs.qualification });
  });

  it.each(['past', 'poc', 'ambiguous', 'rfx', 'incomplete'] as const)('does not call Graph for a %s slot or request', async (kind) => {
    const s = setup({ ticketFacts: { slot: { ...slot, ...(kind === 'past' ? { date: '2026-10-19' } : {}), ...(kind === 'ambiguous' ? { ambiguity: 'two possible dates' } : {}), ...(kind === 'incomplete' ? { end: null } : {}) } } });
    const requestType = kind === 'poc' ? 'PoC' : kind === 'rfx' ? 'Technical questionnaire' : 'Product demonstration';
    const { facts } = await evaluated(s, { ...s.input, issue: { ...s.input.issue, description: s.input.issue.description.replace('Product demonstration', requestType) } });
    expect(s.deps.graph.calls).toEqual([]); expect(facts.calendar).toBeNull();
  });

  it('checks calendars for a technical discovery with a complete future slot', async () => {
    const s = setup({ issue: { description: PRE_304.replace('Product demonstration', 'Technical discovery') } });
    const { label, facts } = await evaluated(s);
    expect(label).toBe('technical discovery'); expect(facts.calendar?.members).toHaveLength(3);
  });

  it('returns pending_retry while the backfill is incomplete', async () => {
    const { facts, result } = await evaluated(setup({ backfill: false }));
    expect(facts.history).toBeNull(); expect(result.verdict).toBe('pending_retry');
    expect(result.errors).toContain('history: backfill not complete');
  });

  it('owner outside the pool is reported as away', async () => {
    const s = setup(); addHistory(s.store, 'former@evertrust.fr');
    const { facts, result } = await evaluated(s);
    expect(facts.history).toEqual({ hasRecentCompletedDiscovery: true, owner: { email: 'former@evertrust.fr', name: 'Previous owner', ticketIdentifier: 'PRE-250', activeInPool: false } });
    expect(result.annotations).toContainEqual({ key: 'owner.away', owner: 'Previous owner', ticket: 'PRE-250' });
  });

  it.each(['twenty', 'llm', 'graph'] as const)('propagates DependencyError from %s', async (dependency) => {
    const s = setup();
    const deps = { ...s.deps, [dependency]: failing(s.deps[dependency], dependency) };
    await expect(evaluateTicket(s.input, deps)).rejects.toMatchObject({ name: 'DependencyError', dependency });
  });
});
