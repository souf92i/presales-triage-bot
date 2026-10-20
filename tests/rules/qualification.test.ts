import { describe, expect, it } from 'vitest';

import { qualificationRule } from '../../src/rules/qualification.js';
import { baseFacts, ctx, noDeal, withDeal, withItem, withOpportunity, withVolume } from '../helpers/facts.js';

describe('qualification rule', () => {
  it('evaluates qualification completeness for new business deals', () => {
    expect(qualificationRule.evaluate(ctx(baseFacts())).outcome).toEqual({ kind: 'pass' });
    expect(qualificationRule.evaluate(ctx(withItem(withItem(baseFacts(), 'budget', 'missing'), 'timeline', 'missing'))).outcome).toEqual({ kind: 'pass' });
    expect(qualificationRule.evaluate(ctx(withItem(withItem(withItem(baseFacts(), 'budget', 'missing'), 'timeline', 'missing'), 'currentPki', 'missing'))).outcome).toEqual({ kind: 'deny', deny: { key: 'qualification.missing', items: [{ id: 'budget', status: 'missing' }, { id: 'timeline', status: 'missing' }, { id: 'currentPki', status: 'missing' }], maxUnknown: 2, dataQualityMissing: '' } });
    expect(qualificationRule.evaluate(ctx(withOpportunity(withItem(baseFacts(), 'decisionMaker', 'missing'), { dataQualityMissing: 'Decision-maker' }))).outcome).toEqual({ kind: 'deny', deny: { key: 'qualification.missing', items: [{ id: 'decisionMaker', status: 'missing' }], maxUnknown: 2, dataQualityMissing: 'Decision-maker' } });
    expect(qualificationRule.evaluate(ctx(withItem(baseFacts(), 'volume', 'missing'))).outcome).toMatchObject({ kind: 'deny' });
    expect(qualificationRule.evaluate(ctx(withItem(withItem(withItem(baseFacts(), 'budget', 'declared_unobtainable'), 'timeline', 'missing'), 'currentPki', 'missing'))).outcome).toEqual({ kind: 'deny', deny: { key: 'qualification.missing', items: [{ id: 'budget', status: 'declared_unobtainable' }, { id: 'timeline', status: 'missing' }, { id: 'currentPki', status: 'missing' }], maxUnknown: 2, dataQualityMissing: '' } });
    expect(qualificationRule.evaluate(ctx(withItem(withItem(withItem(withDeal(baseFacts(), { qualification: { ...baseFacts().deal!.qualification, solutionIncludesClm: false } }), 'budget', 'missing'), 'timeline', 'missing'), 'clmDriver', 'missing'))).outcome).toEqual({ kind: 'pass' });
    expect(qualificationRule.evaluate(ctx(withItem(withItem(withItem(withDeal(baseFacts(), { qualification: { ...baseFacts().deal!.qualification, solutionIncludesClm: null } }), 'budget', 'missing'), 'timeline', 'missing'), 'clmDriver', 'missing'))).outcome).toMatchObject({ kind: 'deny' });
    expect(qualificationRule.evaluate(ctx(withVolume(baseFacts(), { ...baseFacts().deal!.qualification.volume!, unclear: true }))).outcome).toEqual({ kind: 'pass' });
    expect(qualificationRule.applies(ctx(withDeal(baseFacts(), { dealType: 'EXISTINGBUSINESS' })))).toEqual({ applies: false, reason: 'deal type is not NEWBUSINESS' });
    expect(qualificationRule.applies(ctx(noDeal(baseFacts(), { kind: 'company', id: 'company-1' }, true)))).toEqual({ applies: false, reason: 'no valid opportunity' });
  });
});
