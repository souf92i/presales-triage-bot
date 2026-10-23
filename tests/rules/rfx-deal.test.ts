import { describe, expect, it } from 'vitest';

import { rfxDealRule } from '../../src/rules/rfx-deal.js';
import { asKind, baseFacts, ctx, noDeal, withOpportunity } from '../helpers/facts.js';

describe('rfx-deal rule', () => {
  const rfx = (typeOfNegotiation: string | null) => withOpportunity(asKind(baseFacts(), 'rfx'), { typeOfNegotiation });

  it('passes when the opportunity is marked RFX', () => expect(rfxDealRule.evaluate(ctx(rfx('RFX'))).outcome).toEqual({ kind: 'pass' }));
  it('denies when the opportunity is an agreement', () => expect(rfxDealRule.evaluate(ctx(rfx('AGREEMENT'))).outcome).toEqual({ kind: 'deny', deny: { key: 'rfx_deal.not_rfx' } }));
  it('denies when the negotiation type is empty', () => expect(rfxDealRule.evaluate(ctx(rfx(null))).outcome).toEqual({ kind: 'deny', deny: { key: 'rfx_deal.not_rfx' } }));
  it('skips other request kinds', () => expect(rfxDealRule.applies(ctx(baseFacts()))).toEqual({ applies: false, reason: 'not applicable to demo' }));
  it('skips without a valid opportunity', () => expect(rfxDealRule.applies(ctx(noDeal(asKind(baseFacts(), 'rfx'), { kind: 'invalid', raw: 'bad' }, null)))).toEqual({ applies: false, reason: 'no valid opportunity' }));
});
