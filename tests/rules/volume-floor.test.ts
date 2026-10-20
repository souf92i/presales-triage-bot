import { describe, expect, it } from 'vitest';

import { volumeFloorRule } from '../../src/rules/volume-floor.js';
import { baseFacts, ctx, ev, withDeal, withVolume } from '../helpers/facts.js';

describe('volume-floor rule', () => {
  it('enforces the deal volume floor', () => {
    const volume = (min: number, max: number) => ({ min, max, unitIsClmManagedCerts: true, unclear: false, evidence: ev(`${max} certificates`) });
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), volume(150, 150)))).outcome).toEqual({ kind: 'deny', deny: { key: 'volume_floor.below_min', max: 150, min: 200 } });
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), volume(199, 199)))).outcome).toEqual({ kind: 'deny', deny: { key: 'volume_floor.below_min', max: 199, min: 200 } });
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), volume(200, 200)))).outcome).toEqual({ kind: 'pass' });
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), volume(100, 300)))).outcome).toEqual({ kind: 'pass' });
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), { ...volume(0, 0), unclear: true, evidence: ev('SaaS 200 public certificate holders') }))).outcome).toEqual({ kind: 'ask', ask: { key: 'volume_floor.unclear', quote: 'SaaS 200 public certificate holders' } });
    expect(volumeFloorRule.evaluate(ctx(withVolume(baseFacts(), null))).outcome).toEqual({ kind: 'pass' });
    expect(volumeFloorRule.applies(ctx(withDeal(baseFacts(), { dealType: 'UPSALE' })))).toEqual({ applies: false, reason: 'deal type is not NEWBUSINESS' });
  });
});
