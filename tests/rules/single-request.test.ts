import { describe, expect, it } from 'vitest';

import { singleRequestRule } from '../../src/rules/single-request.js';
import { baseFacts, ctx, ev, withTicketFacts } from '../helpers/facts.js';

describe('single-request rule', () => {
  it('passes with no extra request', () => {
    expect(singleRequestRule.evaluate(ctx(baseFacts())).outcome).toEqual({ kind: 'pass' });
  });

  it('denies and lists each extra request with its quote', () => {
    const facts = withTicketFacts(baseFacts(), { additionalRequests: [{ kind: 'poc', evidence: ev('also need a PoC') }, { kind: 'rfx', evidence: ev('and an RFP') }] });
    expect(singleRequestRule.evaluate(ctx(facts)).outcome).toEqual({ kind: 'deny', deny: { key: 'single_request.multiple', items: [{ kind: 'poc', quote: 'also need a PoC' }, { kind: 'rfx', quote: 'and an RFP' }] } });
  });

  it('counts a second request of the same kind', () => {
    const facts = withTicketFacts(baseFacts(), { additionalRequests: [{ kind: 'demo', evidence: ev('and a second demo for their partner') }] });
    expect(singleRequestRule.evaluate(ctx(facts)).outcome).toMatchObject({ kind: 'deny', deny: { key: 'single_request.multiple', items: [{ kind: 'demo', quote: 'and a second demo for their partner' }] } });
  });
});
