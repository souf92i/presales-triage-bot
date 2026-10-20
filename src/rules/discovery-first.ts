import { isDealContext, isNewBusiness, REASON, requireAll } from './applicability.js';
import type { Rule } from './types.js';

export const discoveryFirstRule: Rule = {
  id: 'discovery-first',
  applies: ({ facts }) => requireAll(
    [isDealContext(facts), REASON.noDeal],
    [isNewBusiness(facts), REASON.notNewBusiness],
    [['demo', 'poc'].includes(facts.ticket.requestKind), REASON.kind(facts.ticket.requestKind)],
  ),
  evaluate: ({ facts, config }) => {
    if (facts.history === null) return { outcome: { kind: 'error', reason: 'history backfill not complete' }, annotations: [] };
    if (facts.history.hasRecentCompletedDiscovery || facts.deal!.noteFacts.discoveryEvidence !== null) {
      return { outcome: { kind: 'pass' }, annotations: [] };
    }
    const kind = facts.ticket.requestKind === 'poc' ? 'poc' : 'demo';
    return {
      outcome: { kind: 'deny', deny: { key: 'discovery_first.missing', kind, maxAgeMonths: config.discoveryMaxAgeMonths } },
      annotations: [],
    };
  },
};
