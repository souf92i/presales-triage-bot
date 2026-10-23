import { isDealContext, REASON, requireAll } from './applicability.js';
import type { Rule } from './types.js';

export const rfxDealRule: Rule = {
  id: 'rfx-deal',
  applies: ({ facts }) => requireAll(
    [isDealContext(facts), REASON.noDeal],
    [facts.ticket.requestKind === 'rfx', REASON.kind(facts.ticket.requestKind)],
  ),
  evaluate: ({ facts }) => ({
    outcome: facts.deal!.opportunity.typeOfNegotiation === 'RFX' ? { kind: 'pass' } : { kind: 'deny', deny: { key: 'rfx_deal.not_rfx' } },
    annotations: [],
  }),
};
