import { describe, expect, it } from 'vitest';

import { pocPaidRule } from '../../src/rules/poc-paid.js';
import { asKind, baseFacts, ctx, ev, noDeal, withDeal } from '../helpers/facts.js';

describe('poc-paid rule', () => {
  it('passes when a PoC quote exists', () => {
    const poc = asKind(baseFacts(), 'poc');
    expect(pocPaidRule.evaluate(ctx(withDeal(poc, { hasPocQuote: true }))).outcome).toEqual({ kind: 'pass' });
  });
  it('passes with expected quote evidence', () => {
    const poc = asKind(baseFacts(), 'poc');
    expect(pocPaidRule.evaluate(ctx(withDeal(poc, { noteFacts: { ...poc.deal!.noteFacts, pocQuoteExpectedEvidence: ev('Quote expected') } }))).outcome).toEqual({ kind: 'pass' });
  });
  it('passes with an approver exception and annotates it', () => {
    const poc = asKind(baseFacts(), 'poc');
    const exception = withDeal(poc, { noteFacts: { ...poc.deal!.noteFacts, approverException: { approver: 'Vincent', evidence: ev('Vincent agreed to a free PoC') } } });
    expect(pocPaidRule.evaluate(ctx(exception))).toEqual({ outcome: { kind: 'pass' }, annotations: [{ key: 'poc_paid.exception', approver: 'Vincent', quote: 'Vincent agreed to a free PoC' }] });
  });
  it('denies a PoC with no quote or exception', () => {
    const poc = asKind(baseFacts(), 'poc');
    expect(pocPaidRule.evaluate(ctx(poc)).outcome).toEqual({ kind: 'deny', deny: { key: 'poc_paid.no_quote' } });
  });
  it('denies an existing-business PoC without a quote', () => {
    const existingBusinessPoc = withDeal(asKind(baseFacts(), 'poc'), { dealType: 'EXISTINGBUSINESS' });
    expect(pocPaidRule.applies(ctx(existingBusinessPoc))).toEqual({ applies: true });
    expect(pocPaidRule.evaluate(ctx(existingBusinessPoc)).outcome).toEqual({ kind: 'deny', deny: { key: 'poc_paid.no_quote' } });
  });
  it('skips demos', () => {
    expect(pocPaidRule.applies(ctx(baseFacts()))).toEqual({ applies: false, reason: 'not applicable to demo' });
  });
  it('skips when there is no valid opportunity', () => {
    const poc = asKind(baseFacts(), 'poc');
    expect(pocPaidRule.applies(ctx(noDeal(poc, { kind: 'company', id: 'company-1' }, true)))).toEqual({ applies: false, reason: 'no valid opportunity' });
  });
});
