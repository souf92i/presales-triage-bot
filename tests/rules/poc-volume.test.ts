import { describe, expect, it } from 'vitest';

import { pocVolumeRule } from '../../src/rules/poc-volume.js';
import { asKind, baseFacts, ctx, ev, withVolume } from '../helpers/facts.js';

describe('poc-volume rule', () => {
  const volume = (min: number, max: number) => ({ min, max, unitIsClmManagedCerts: true, unclear: false, evidence: ev(`${max} certificates`) });
  it('denies a PoC at 499 certificates', () => {
    expect(pocVolumeRule.evaluate(ctx(asKind(withVolume(baseFacts(), volume(499, 499)), 'poc'))).outcome).toEqual({ kind: 'deny', deny: { key: 'poc_volume.below_min', max: 499, min: 500 } });
  });
  it('passes a PoC at exactly 500 certificates', () => {
    expect(pocVolumeRule.evaluate(ctx(asKind(withVolume(baseFacts(), volume(500, 500)), 'poc'))).outcome).toEqual({ kind: 'pass' });
  });
  it('passes a PoC range that reaches 500 certificates', () => {
    expect(pocVolumeRule.evaluate(ctx(asKind(withVolume(baseFacts(), volume(300, 600)), 'poc'))).outcome).toEqual({ kind: 'pass' });
  });
  it('passes when volume is unclear', () => {
    expect(pocVolumeRule.evaluate(ctx(asKind(withVolume(baseFacts(), { ...volume(0, 0), unclear: true }), 'poc'))).outcome).toEqual({ kind: 'pass' });
  });
  it('passes when volume is null', () => {
    expect(pocVolumeRule.evaluate(ctx(asKind(withVolume(baseFacts(), null), 'poc'))).outcome).toEqual({ kind: 'pass' });
  });
  it('skips demos', () => {
    expect(pocVolumeRule.applies(ctx(baseFacts()))).toEqual({ applies: false, reason: 'not applicable to demo' });
  });
});
