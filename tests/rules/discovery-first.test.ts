import { describe, expect, it } from 'vitest';

import { discoveryFirstRule } from '../../src/rules/discovery-first.js';
import { asKind, baseFacts, ctx, ev, withDeal } from '../helpers/facts.js';

describe('discovery-first rule', () => {
  it('requires discovery evidence for demos and PoCs', () => {
    expect(discoveryFirstRule.evaluate(ctx(baseFacts())).outcome).toEqual({ kind: 'pass' });
    expect(discoveryFirstRule.evaluate(ctx(withDeal(baseFacts(), { noteFacts: { ...baseFacts().deal!.noteFacts, discoveryEvidence: ev('Discovery note') } }))).outcome).toEqual({ kind: 'pass' });
    const missing = withDeal(baseFacts(), { noteFacts: { ...baseFacts().deal!.noteFacts, discoveryEvidence: null } });
    expect(discoveryFirstRule.evaluate(ctx({ ...missing, history: { hasRecentCompletedDiscovery: false, owner: null } })).outcome).toEqual({ kind: 'deny', deny: { key: 'discovery_first.missing', kind: 'demo', maxAgeMonths: 12 } });
    expect(discoveryFirstRule.evaluate(ctx({ ...asKind(missing, 'poc'), history: { hasRecentCompletedDiscovery: false, owner: null } })).outcome).toEqual({ kind: 'deny', deny: { key: 'discovery_first.missing', kind: 'poc', maxAgeMonths: 12 } });
    expect(discoveryFirstRule.evaluate(ctx({ ...missing, history: null })).outcome).toEqual({ kind: 'error', reason: 'history backfill not complete' });
    expect(discoveryFirstRule.applies(ctx(asKind(baseFacts(), 'technical_discovery')))).toEqual({ applies: false, reason: 'not applicable to technical_discovery' });
    expect(discoveryFirstRule.applies(ctx(asKind(baseFacts(), 'rfx')))).toEqual({ applies: false, reason: 'not applicable to rfx' });
    expect(discoveryFirstRule.applies(ctx(withDeal(baseFacts(), { dealType: 'ADDITIONAL_YEAR' })))).toEqual({ applies: false, reason: 'deal type is not NEWBUSINESS' });
  });
});
