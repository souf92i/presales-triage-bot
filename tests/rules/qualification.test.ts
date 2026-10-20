import { describe, expect, it } from 'vitest';

import { qualificationRule } from '../../src/rules/qualification.js';
import { baseFacts, ctx, noDeal, withDeal, withItem, withOpportunity, withVolume } from '../helpers/facts.js';

describe('qualification rule', () => {
  it('passes when all qualification items are known', () => {
    expect(qualificationRule.evaluate(ctx(baseFacts())).outcome).toEqual({ kind: 'pass' });
  });

  it('passes with exactly two other items unknown', () => {
    expect(qualificationRule.evaluate(ctx(withItem(withItem(baseFacts(), 'budget', 'missing'), 'timeline', 'missing'))).outcome).toEqual({ kind: 'pass' });
  });

  it('denies with exactly the three unknown other items in order', () => {
    expect(qualificationRule.evaluate(ctx(withItem(withItem(withItem(baseFacts(), 'budget', 'missing'), 'timeline', 'missing'), 'currentPki', 'missing'))).outcome).toEqual({ kind: 'deny', deny: { key: 'qualification.missing', items: [{ id: 'budget', status: 'missing' }, { id: 'timeline', status: 'missing' }, { id: 'currentPki', status: 'missing' }], maxUnknown: 2, dataQualityMissing: '' } });
  });

  it('denies when only the decision-maker is missing', () => {
    expect(qualificationRule.evaluate(ctx(withOpportunity(withItem(baseFacts(), 'decisionMaker', 'missing'), { dataQualityMissing: 'Decision-maker' }))).outcome).toEqual({ kind: 'deny', deny: { key: 'qualification.missing', items: [{ id: 'decisionMaker', status: 'missing' }], maxUnknown: 2, dataQualityMissing: 'Decision-maker' } });
  });

  it('denies when volume is missing', () => {
    expect(qualificationRule.evaluate(ctx(withItem(baseFacts(), 'volume', 'missing'))).outcome).toEqual({ kind: 'deny', deny: { key: 'qualification.missing', items: [{ id: 'volume', status: 'missing' }], maxUnknown: 2, dataQualityMissing: '' } });
  });

  it('keeps declared unobtainable status in the deny items', () => {
    expect(qualificationRule.evaluate(ctx(withItem(withItem(withItem(baseFacts(), 'budget', 'declared_unobtainable'), 'timeline', 'missing'), 'currentPki', 'missing'))).outcome).toEqual({ kind: 'deny', deny: { key: 'qualification.missing', items: [{ id: 'budget', status: 'declared_unobtainable' }, { id: 'timeline', status: 'missing' }, { id: 'currentPki', status: 'missing' }], maxUnknown: 2, dataQualityMissing: '' } });
  });

  it('ignores clmDriver when the solution excludes CLM', () => {
    expect(qualificationRule.evaluate(ctx(withItem(withItem(withItem(withDeal(baseFacts(), { qualification: { ...baseFacts().deal!.qualification, solutionIncludesClm: false } }), 'budget', 'missing'), 'timeline', 'missing'), 'clmDriver', 'missing'))).outcome).toEqual({ kind: 'pass' });
  });

  it('counts clmDriver when the solution is unknown', () => {
    expect(qualificationRule.evaluate(ctx(withItem(withItem(withItem(withDeal(baseFacts(), { qualification: { ...baseFacts().deal!.qualification, solutionIncludesClm: null } }), 'budget', 'missing'), 'timeline', 'missing'), 'clmDriver', 'missing'))).outcome).toEqual({ kind: 'deny', deny: { key: 'qualification.missing', items: [{ id: 'budget', status: 'missing' }, { id: 'timeline', status: 'missing' }, { id: 'clmDriver', status: 'missing' }], maxUnknown: 2, dataQualityMissing: '' } });
  });

  it('counts unclear volume as known', () => {
    expect(qualificationRule.evaluate(ctx(withVolume(baseFacts(), { ...baseFacts().deal!.qualification.volume!, unclear: true }))).outcome).toEqual({ kind: 'pass' });
  });

  it('skips existing-business deals', () => {
    expect(qualificationRule.applies(ctx(withDeal(baseFacts(), { dealType: 'EXISTINGBUSINESS' })))).toEqual({ applies: false, reason: 'deal type is not NEWBUSINESS' });
  });

  it('skips when there is no valid opportunity', () => {
    expect(qualificationRule.applies(ctx(noDeal(baseFacts(), { kind: 'company', id: 'company-1' }, true)))).toEqual({ applies: false, reason: 'no valid opportunity' });
  });
});
