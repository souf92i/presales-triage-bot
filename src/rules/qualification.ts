import { QUALIFICATION_ITEMS } from '../domain/types.js';
import { isDealContext, isNewBusiness, isNotRfx, REASON, requireAll } from './applicability.js';
import type { Rule } from './types.js';

export const qualificationRule: Rule = {
  id: 'qualification',
  applies: ({ facts }) => requireAll(
    [isDealContext(facts), REASON.noDeal],
    [isNewBusiness(facts), REASON.notNewBusiness],
    [isNotRfx(facts), REASON.kind(facts.ticket.requestKind)],
  ),
  evaluate: ({ facts, config }) => {
    const deal = facts.deal!;
    const applicable = QUALIFICATION_ITEMS.filter((id) => id !== 'clmDriver' || deal.qualification.solutionIncludesClm !== false);
    const items = applicable.flatMap((id) => {
      const status = deal.qualification.items[id].status;
      return status === 'known' ? [] : [{ id, status }];
    });
    const requiredMissing = items.some(({ id }) => id === 'volume' || id === 'decisionMaker');
    const otherMissing = items.filter(({ id }) => id !== 'volume' && id !== 'decisionMaker');
    return {
      outcome: requiredMissing || otherMissing.length > config.maxUnknownItems
        ? { kind: 'deny', deny: { key: 'qualification.missing', items, maxUnknown: config.maxUnknownItems, dataQualityMissing: deal.opportunity.dataQualityMissing } }
        : { kind: 'pass' },
      annotations: [],
    };
  },
};
