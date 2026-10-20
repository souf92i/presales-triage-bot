import { describe, expect, it } from 'vitest';

import { pocPaidRule } from '../../src/rules/poc-paid.js';
import { asKind, baseFacts, ctx, ev, noDeal, withDeal } from '../helpers/facts.js';

describe('poc-paid rule', () => {
  it('requires a quote, expected quote evidence, or an approver exception for PoCs', () => {
    const poc = asKind(baseFacts(), 'poc');
    expect(pocPaidRule.evaluate(ctx(withDeal(poc, { hasPocQuote: true }))).outcome).toEqual({ kind: 'pass' });
    expect(pocPaidRule.evaluate(ctx(withDeal(poc, { noteFacts: { ...poc.deal!.noteFacts, pocQuoteExpectedEvidence: ev('Quote expected') } }))).outcome).toEqual({ kind: 'pass' });
    const exception = withDeal(poc, { noteFacts: { ...poc.deal!.noteFacts, approverException: { approver: 'Vincent', evidence: ev('Vincent agreed to a free PoC') } } });
    expect(pocPaidRule.evaluate(ctx(exception))).toEqual({ outcome: { kind: 'pass' }, annotations: [{ key: 'poc_paid.exception', approver: 'Vincent', quote: 'Vincent agreed to a free PoC' }] });
    expect(pocPaidRule.evaluate(ctx(poc)).outcome).toEqual({ kind: 'deny', deny: { key: 'poc_paid.no_quote' } });
    expect(pocPaidRule.evaluate(ctx(withDeal(poc, { dealType: 'EXISTINGBUSINESS' }))).outcome).toEqual({ kind: 'deny', deny: { key: 'poc_paid.no_quote' } });
    expect(pocPaidRule.applies(ctx(baseFacts()))).toEqual({ applies: false, reason: 'not applicable to demo' });
    expect(pocPaidRule.applies(ctx(noDeal(poc, { kind: 'company', id: 'company-1' }, true)))).toEqual({ applies: false, reason: 'no valid opportunity' });
  });
});
