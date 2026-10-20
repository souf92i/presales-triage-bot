import type { Rule } from './types.js';

export const singleRequestRule: Rule = {
  id: 'single-request',
  applies: () => ({ applies: true }),
  evaluate: ({ facts }) => {
    const items = facts.ticketFacts.additionalRequests.map(({ kind, evidence }) => ({ kind, quote: evidence.quote }));
    return {
      outcome: items.length === 0 ? { kind: 'pass' } : { kind: 'deny', deny: { key: 'single_request.multiple', items } },
      annotations: [],
    };
  },
};
