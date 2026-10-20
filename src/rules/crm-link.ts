import { isPartnerOnly } from '../crm-link.js';
import type { Rule } from './types.js';

export const crmLinkRule: Rule = {
  id: 'crm-link',
  applies: () => ({ applies: true }),
  evaluate: ({ facts }) => {
    const { link } = facts;
    if (link.kind === 'invalid') {
      return { outcome: { kind: 'deny', deny: { key: 'crm_link.invalid', raw: link.raw, partnerOnly: isPartnerOnly(facts.ticket.form.target) } }, annotations: [] };
    }
    if (facts.linkedRecordFound === false) {
      return { outcome: { kind: 'deny', deny: { key: 'crm_link.not_found', recordKind: link.kind, id: link.id } }, annotations: [] };
    }
    return { outcome: { kind: 'pass' }, annotations: [] };
  },
};
