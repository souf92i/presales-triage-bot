import { describe, expect, it } from 'vitest';

import { discoveryFirstRule } from '../../src/rules/discovery-first.js';
import { asKind, baseFacts, ctx, ev, withDeal } from '../helpers/facts.js';

describe('discovery-first rule', () => {
  it('passes when discovery history is recent', () => {
    expect(discoveryFirstRule.evaluate(ctx(baseFacts())).outcome).toEqual({ kind: 'pass' });
  });
  it('passes by note evidence without discovery history', () => {
    const facts = withDeal(baseFacts(), { noteFacts: { ...baseFacts().deal!.noteFacts, discoveryEvidence: ev('Discovery note') } });
    expect(discoveryFirstRule.evaluate(ctx({ ...facts, history: { hasRecentCompletedDiscovery: false, owner: null } })).outcome).toEqual({ kind: 'pass' });
  });
  it('denies a demo without history or evidence', () => {
    const missing = withDeal(baseFacts(), { noteFacts: { ...baseFacts().deal!.noteFacts, discoveryEvidence: null } });
    expect(discoveryFirstRule.evaluate(ctx({ ...missing, history: { hasRecentCompletedDiscovery: false, owner: null } })).outcome).toEqual({ kind: 'deny', deny: { key: 'discovery_first.missing', kind: 'demo', maxAgeMonths: 12 } });
  });
  it('denies a PoC without history or evidence', () => {
    const missing = withDeal(baseFacts(), { noteFacts: { ...baseFacts().deal!.noteFacts, discoveryEvidence: null } });
    expect(discoveryFirstRule.evaluate(ctx({ ...asKind(missing, 'poc'), history: { hasRecentCompletedDiscovery: false, owner: null } })).outcome).toEqual({ kind: 'deny', deny: { key: 'discovery_first.missing', kind: 'poc', maxAgeMonths: 12 } });
  });
  it('errors when history backfill is incomplete', () => {
    const missing = withDeal(baseFacts(), { noteFacts: { ...baseFacts().deal!.noteFacts, discoveryEvidence: null } });
    expect(discoveryFirstRule.evaluate(ctx({ ...missing, history: null })).outcome).toEqual({ kind: 'error', reason: 'history backfill not complete' });
  });
  it('skips technical discovery requests', () => {
    expect(discoveryFirstRule.applies(ctx(asKind(baseFacts(), 'technical_discovery')))).toEqual({ applies: false, reason: 'not applicable to technical_discovery' });
  });
  it('skips RFX requests', () => {
    expect(discoveryFirstRule.applies(ctx(asKind(baseFacts(), 'rfx')))).toEqual({ applies: false, reason: 'not applicable to rfx' });
  });
  it('skips additional-year deals', () => {
    expect(discoveryFirstRule.applies(ctx(withDeal(baseFacts(), { dealType: 'ADDITIONAL_YEAR' })))).toEqual({ applies: false, reason: 'deal type is not NEWBUSINESS' });
  });
});
