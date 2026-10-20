import { describe, expect, it } from 'vitest';
import { checkEvidence, toSourceMap, verifyQualification, verifyTicketFacts } from '../../src/facts/evidence.js';
import type { QualificationExtraction, TicketFacts } from '../../src/domain/types.js';
import type { SourceText } from '../../src/clients/types.js';

const source = (id: string, text: string, createdAt: string | null = null): SourceText => ({ id, label: id, text, createdAt });
const evidence = { sourceId: 'ticket', quote: 'Target date: 22.10. 13:00 - 14:00' };
const missingItem = { status: 'missing', value: null, evidence: null } as const;
const knownItem = (quote = 'verified'): QualificationExtraction['items']['hosting'] => ({ status: 'known', value: 'value', evidence: { sourceId: 'ticket', quote } });
const extraction = (): QualificationExtraction => ({
  items: { volume: missingItem, hosting: knownItem(), solution: missingItem, decisionMaker: missingItem, budget: missingItem, timeline: missingItem, currentPki: missingItem, useCases: missingItem, clmDriver: missingItem },
  volume: null,
  solutionIncludesClm: null,
  discoveryEvidence: null,
  pocQuoteExpectedEvidence: null,
  approverException: null,
  partnerNamed: null,
});

describe('evidence checks', () => {
  it('accepts a quote that matches after whitespace normalisation', () => {
    expect(checkEvidence(evidence, toSourceMap([source('ticket', 'Target date:\n22.10.  13:00 - 14:00')]))).toBe(true);
  });

  it('rejects an unknown source, an empty quote and a quote not in the source', () => {
    const sources = toSourceMap([source('ticket', 'hello')]);
    expect(checkEvidence({ sourceId: 'unknown', quote: 'hello' }, sources)).toBe(false);
    expect(checkEvidence({ sourceId: 'ticket', quote: '  \n ' }, sources)).toBe(false);
    expect(checkEvidence({ sourceId: 'ticket', quote: 'goodbye' }, sources)).toBe(false);
  });

  it('drops an additional request whose quote is not in the source', () => {
    const facts: TicketFacts = { additionalRequests: [{ kind: 'demo', evidence: { sourceId: 'ticket', quote: 'bad' } }], slot: null, slotsOfferedAwaitingCustomer: null, repDeclinedMove: null, onsite: null, language: 'en' };
    expect(verifyTicketFacts(facts, toSourceMap([source('ticket', 'good')])).additionalRequests).toEqual([]);
  });

  it('sets slot to null when its quote fails', () => {
    const facts: TicketFacts = { additionalRequests: [], slot: { date: '2026-01-01', start: '10:00', end: '11:00', timezone: 'Europe/Paris', isComplete: true, ambiguity: null, evidence: { sourceId: 'ticket', quote: 'bad' } }, slotsOfferedAwaitingCustomer: null, repDeclinedMove: null, onsite: null, language: 'en' };
    expect(verifyTicketFacts(facts, toSourceMap([source('ticket', 'good')])).slot).toBeNull();
  });

  it('turns a known item with a bad quote into missing', () => {
    const value = verifyQualification(extraction(), toSourceMap([source('ticket', 'other')]), { discoverySinceIso: '2025-10-20T12:00:00Z', approvers: [], noteIds: new Set() });
    expect(value.items.hosting).toEqual(missingItem);
  });

  it('keeps discovery evidence only from a recent note', () => {
    const input = { ...extraction(), discoveryEvidence: { sourceId: 'note-1', quote: 'discovery done' } };
    const options = { discoverySinceIso: '2025-10-20T12:00:00Z', approvers: [], noteIds: new Set(['note-1']) };
    expect(verifyQualification(input, toSourceMap([source('note-1', 'discovery done', '2026-01-10T00:00:00Z')]), options).discoveryEvidence).toEqual(input.discoveryEvidence);
    expect(verifyQualification(input, toSourceMap([source('note-1', 'discovery done', '2025-01-10T00:00:00Z')]), options).discoveryEvidence).toBeNull();
    for (const id of ['besoin', 'ticket', 'comment-1']) {
      expect(verifyQualification({ ...input, discoveryEvidence: { sourceId: id, quote: 'discovery done' } }, toSourceMap([source(id, 'discovery done', '2026-01-10T00:00:00Z')]), options).discoveryEvidence).toBeNull();
    }
  });

  it('keeps PoC quote evidence only from a note', () => {
    const input = { ...extraction(), pocQuoteExpectedEvidence: { sourceId: 'note-1', quote: 'PoC quote expected' } };
    expect(verifyQualification(input, toSourceMap([source('note-1', 'PoC quote expected')]), { discoverySinceIso: '', approvers: [], noteIds: new Set(['note-1']) }).pocQuoteExpectedEvidence).not.toBeNull();
    expect(verifyQualification({ ...input, pocQuoteExpectedEvidence: { sourceId: 'ticket', quote: 'PoC quote expected' } }, toSourceMap([source('ticket', 'PoC quote expected')]), { discoverySinceIso: '', approvers: [], noteIds: new Set(['note-1']) }).pocQuoteExpectedEvidence).toBeNull();
  });

  it('keeps an approver exception only for a configured approver', () => {
    const options = { discoverySinceIso: '', approvers: ['Vincent'], noteIds: new Set<string>() };
    for (const [approver, kept] of [['Vincent L.', true], ['Marc', false], ['Vincentia', false]] as const) {
      const input = { ...extraction(), approverException: { approver, evidence: { sourceId: 'ticket', quote: 'approved' } } };
      expect(verifyQualification(input, toSourceMap([source('ticket', 'approved')]), options).approverException === null).toBe(!kept);
    }
  });
});
