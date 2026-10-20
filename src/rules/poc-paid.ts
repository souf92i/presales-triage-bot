import { isDealContext, REASON, requireAll } from './applicability.js';
import type { Rule } from './types.js';

export const pocPaidRule: Rule = {
  id: 'poc-paid',
  applies: ({ facts }) => requireAll(
    [isDealContext(facts), REASON.noDeal],
    [facts.ticket.requestKind === 'poc', REASON.kind(facts.ticket.requestKind)],
  ),
  evaluate: ({ facts }) => {
    const deal = facts.deal!;
    if (deal.hasPocQuote || deal.noteFacts.pocQuoteExpectedEvidence !== null) return { outcome: { kind: 'pass' }, annotations: [] };
    if (deal.noteFacts.approverException !== null) {
      const { approver, evidence } = deal.noteFacts.approverException;
      return { outcome: { kind: 'pass' }, annotations: [{ key: 'poc_paid.exception', approver, quote: evidence.quote }] };
    }
    return { outcome: { kind: 'deny', deny: { key: 'poc_paid.no_quote' } }, annotations: [] };
  },
};
