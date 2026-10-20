import { describe, expect, it } from 'vitest';

import { crmLinkRule } from '../../src/rules/crm-link.js';
import { COMPANY_ID, OPP_ID, baseFacts, ctx, noDeal } from '../helpers/facts.js';

describe('crm-link rule', () => {
  it('passes for a found opportunity', () => expect(crmLinkRule.evaluate(ctx(baseFacts())).outcome).toEqual({ kind: 'pass' }));
  it('passes for a found partner-only company', () => {
    const facts = noDeal({ ...baseFacts(), ticket: { ...baseFacts().ticket, form: { ...baseFacts().ticket.form, target: ['Partner'] } } }, { kind: 'company', id: COMPANY_ID }, true);
    expect(crmLinkRule.evaluate(ctx(facts)).outcome).toEqual({ kind: 'pass' });
  });
  it('denies an invalid link with partnerOnly false', () => {
    const facts = noDeal(baseFacts(), { kind: 'invalid', raw: 'bad link' }, null);
    expect(crmLinkRule.evaluate(ctx(facts)).outcome).toEqual({ kind: 'deny', deny: { key: 'crm_link.invalid', raw: 'bad link', partnerOnly: false } });
  });
  it('denies an invalid link on a partner-only ask with partnerOnly true', () => {
    const base = baseFacts();
    const facts = noDeal({ ...base, ticket: { ...base.ticket, form: { ...base.ticket.form, target: ['Partner'] } } }, { kind: 'invalid', raw: 'bad link' }, null);
    expect(crmLinkRule.evaluate(ctx(facts)).outcome).toEqual({ kind: 'deny', deny: { key: 'crm_link.invalid', raw: 'bad link', partnerOnly: true } });
  });
  it('denies an opportunity not found', () => {
    expect(crmLinkRule.evaluate(ctx(noDeal(baseFacts(), { kind: 'opportunity', id: OPP_ID }, false))).outcome).toEqual({ kind: 'deny', deny: { key: 'crm_link.not_found', recordKind: 'opportunity', id: OPP_ID } });
  });
  it('denies a company not found', () => {
    expect(crmLinkRule.evaluate(ctx(noDeal(baseFacts(), { kind: 'company', id: COMPANY_ID }, false))).outcome).toEqual({ kind: 'deny', deny: { key: 'crm_link.not_found', recordKind: 'company', id: COMPANY_ID } });
  });
});
