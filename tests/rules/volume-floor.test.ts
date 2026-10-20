import { describe, expect, it } from 'vitest';

import { volumeFloorRule } from '../../src/rules/volume-floor.js';
import { baseFacts, ctx, ev, withDeal, withVolume } from '../helpers/facts.js';

describe('volume-floor rule', () => {
  const volume = (min: number, max: number) => ({ min, max, unitIsClmManagedCerts: true, unclear: false, evidence: ev(`${max} certificates`) });

  it('denies when max volume is 150', () => {
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), volume(150, 150)))).outcome).toEqual({ kind: 'deny', deny: { key: 'volume_floor.below_min', max: 150, min: 200 } });
  });
  it('denies when max volume is 199', () => {
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), volume(199, 199)))).outcome).toEqual({ kind: 'deny', deny: { key: 'volume_floor.below_min', max: 199, min: 200 } });
  });
  it('passes at exactly the minimum volume', () => {
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), volume(200, 200)))).outcome).toEqual({ kind: 'pass' });
  });
  it('passes when the volume range reaches the minimum', () => {
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), volume(100, 300)))).outcome).toEqual({ kind: 'pass' });
  });
  it('asks when volume is unclear', () => {
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), { ...volume(0, 0), unclear: true, evidence: ev('SaaS 200 public certificate holders') }))).outcome).toEqual({ kind: 'ask', ask: { key: 'volume_floor.unclear', quote: 'SaaS 200 public certificate holders' } });
  });
  it('passes when volume is null', () => {
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), null))).outcome).toEqual({ kind: 'pass' });
  });
  it('skips upsells', () => {
    expect(volumeFloorRule.applies(ctx(withDeal(baseFacts(), { dealType: 'UPSALE' })))).toEqual({ applies: false, reason: 'deal type is not NEWBUSINESS' });
  });
});
