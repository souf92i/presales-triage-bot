import { describe, expect, it } from 'vitest';

import { pocVolumeRule } from '../../src/rules/poc-volume.js';
import { asKind, baseFacts, ctx, ev, withVolume } from '../helpers/facts.js';

describe('poc-volume rule', () => {
  it('enforces the PoC volume floor only for PoCs', () => {
    const volume = (min: number, max: number) => ({ min, max, unitIsClmManagedCerts: true, unclear: false, evidence: ev(`${max} certificates`) });
    expect(pocVolumeRule.evaluate(ctx(asKind(withVolume(baseFacts(), volume(499, 499)), 'poc'))).outcome).toEqual({ kind: 'deny', deny: { key: 'poc_volume.below_min', max: 499, min: 500 } });
    expect(pocVolumeRule.evaluate(ctx(asKind(withVolume(baseFacts(), volume(500, 500)), 'poc'))).outcome).toEqual({ kind: 'pass' });
    expect(pocVolumeRule.evaluate(ctx(asKind(withVolume(baseFacts(), volume(300, 600)), 'poc'))).outcome).toEqual({ kind: 'pass' });
    expect(pocVolumeRule.evaluate(ctx(asKind(withVolume(baseFacts(), { ...volume(0, 0), unclear: true }), 'poc'))).outcome).toEqual({ kind: 'pass' });
    expect(pocVolumeRule.evaluate(ctx(asKind(withVolume(baseFacts(), null), 'poc'))).outcome).toEqual({ kind: 'pass' });
    expect(pocVolumeRule.applies(ctx(baseFacts()))).toEqual({ applies: false, reason: 'not applicable to demo' });
  });
});
