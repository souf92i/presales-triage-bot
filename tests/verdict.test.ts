import { describe, expect, it } from 'vitest';

import { hasOwnerAnnotation } from '../src/annotations.js';
import { evaluateRules } from '../src/verdict.js';
import { asKind, baseFacts, ctx, noDeal, withDeal, withOpportunity, withVolume } from './helpers/facts.js';

describe('verdict assembly', () => {
  it('accepts the base facts', () => {
    const result = evaluateRules(ctx(baseFacts()));

    expect(result.verdict).toBe('accepted');
    expect(result.results).toHaveLength(9);
    expect(result.results.slice(-2).map((result) => result.outcome)).toEqual([
      { kind: 'skip', reason: 'not applicable to demo' },
      { kind: 'skip', reason: 'not applicable to demo' },
    ]);
  });

  it('denies and still records the asks', () => {
    const facts = withVolume(withDeal(baseFacts(), { notes: [] }), {
      min: 0, max: 0, unitIsClmManagedCerts: true, unclear: true, evidence: { sourceId: 'note-1', quote: 'unknown volume' },
    });
    const result = evaluateRules(ctx(facts));

    expect(result.verdict).toBe('denied');
    expect(result.denies.map((deny) => deny.key)).toEqual(['notes_exist.none']);
    expect(result.asks.map((ask) => ask.key)).toEqual(['volume_floor.unclear']);
  });

  it('waits when only asks exist', () => {
    const facts = withVolume(baseFacts(), {
      min: 0, max: 0, unitIsClmManagedCerts: true, unclear: true, evidence: { sourceId: 'note-1', quote: 'unknown volume' },
    });

    expect(evaluateRules(ctx(facts)).verdict).toBe('waiting');
  });

  it('reports every failing rule at once', () => {
    const facts = noDeal(
      { ...baseFacts(), ticketFacts: { ...baseFacts().ticketFacts, additionalRequests: [{ kind: 'poc', evidence: { sourceId: 'ticket', quote: 'also a PoC' } }] } },
      { kind: 'invalid', raw: 'not a CRM link' },
      null,
    );
    const result = evaluateRules(ctx(facts));

    expect(result.denies.map((deny) => deny.key)).toEqual(['single_request.multiple', 'crm_link.invalid']);
    expect(result.results.slice(2, 6).map((result) => result.outcome)).toEqual([
      { kind: 'skip', reason: 'no valid opportunity' },
      { kind: 'skip', reason: 'no valid opportunity' },
      { kind: 'skip', reason: 'no valid opportunity' },
      { kind: 'skip', reason: 'no valid opportunity' },
    ]);
  });

  it('returns pending_retry when history is not ready, even with denies', () => {
    const facts = { ...withDeal(baseFacts(), { notes: [] }), history: null };
    const result = evaluateRules(ctx(facts));

    expect(result.verdict).toBe('pending_retry');
    expect(result.annotations).toEqual([]);
    expect(result.errors).toEqual(['discovery-first: history backfill not complete', 'history: backfill not complete']);
  });

  it('adds partner caution with the indirect flag on an accepted verdict', () => {
    const result = evaluateRules(ctx(withOpportunity(baseFacts(), { hasActualPartner: false, salesChannel: 'INDIRECT' })));

    expect(result.annotations).toContainEqual({ key: 'partner.caution', indirect: true });
  });

  it('has no partner caution on a denied verdict', () => {
    const facts = withOpportunity(withDeal(baseFacts(), { notes: [] }), { hasActualPartner: false, salesChannel: 'INDIRECT' });

    expect(evaluateRules(ctx(facts)).annotations).not.toContainEqual({ key: 'partner.caution', indirect: true });
  });

  it('has no partner caution when target includes Partner', () => {
    const facts = withOpportunity({ ...baseFacts(), ticket: { ...baseFacts().ticket, form: { ...baseFacts().ticket.form, target: ['End customer', 'Partner'] } } }, { hasActualPartner: false });

    expect(evaluateRules(ctx(facts)).annotations).not.toContainEqual(expect.objectContaining({ key: 'partner.caution' }));
  });

  it('has no partner caution when partnerNamed is set', () => {
    const facts = withOpportunity(withDeal(baseFacts(), { noteFacts: { ...baseFacts().deal!.noteFacts, partnerNamed: { name: 'Partner', evidence: { sourceId: 'note-1', quote: 'Partner involved' } } } }), { hasActualPartner: false });

    expect(evaluateRules(ctx(facts)).annotations).not.toContainEqual(expect.objectContaining({ key: 'partner.caution' }));
  });

  it('adds owner.active with free-on-slot on acceptance', () => {
    const facts = { ...baseFacts(), history: { ...baseFacts().history!, owner: { email: 'sbo@evertrust.fr', name: 'sbo', ticketIdentifier: 'PRE-120', activeInPool: true } } };

    expect(evaluateRules(ctx(facts)).annotations).toContainEqual({ key: 'owner.active', owner: 'sbo', ticket: 'PRE-120', freeOnSlot: true });
  });

  it('adds owner.away for an inactive owner', () => {
    const facts = { ...baseFacts(), history: { ...baseFacts().history!, owner: { email: 'mob@evertrust.fr', name: 'mob', ticketIdentifier: 'PRE-120', activeInPool: false } } };

    expect(evaluateRules(ctx(facts)).annotations).toContainEqual({ key: 'owner.away', owner: 'mob', ticket: 'PRE-120' });
  });

  it('has no owner annotation when denied', () => {
    const facts = { ...withDeal(baseFacts(), { notes: [] }), history: { ...baseFacts().history!, owner: { email: 'sbo@evertrust.fr', name: 'sbo', ticketIdentifier: 'PRE-120', activeInPool: true } } };

    expect(hasOwnerAnnotation(evaluateRules(ctx(facts)).annotations)).toBe(false);
  });

  it('adds PoC Go/NoGo on an accepted PoC only', () => {
    const result = evaluateRules(ctx(withDeal(asKind(baseFacts(), 'poc'), { hasPocQuote: true })));

    expect(result.verdict).toBe('accepted');
    expect(result.annotations).toContainEqual({ key: 'poc.go_nogo' });
  });

  it('does not run disabled rules', () => {
    const result = evaluateRules(ctx(withDeal(baseFacts(), { notes: [] }), { rules: ['single-request'] }));

    expect(result.results.map((result) => result.ruleId)).toEqual(['single-request']);
    expect(result.verdict).toBe('accepted');
  });
});
