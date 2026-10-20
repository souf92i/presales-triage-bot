import { defaultConfig, type Config } from '../../src/config.js';
import type { CrmLink, DealFacts, Evidence, Facts, ItemStatus, Opportunity, QualificationItemId, Random, RequestKind, TicketFacts, VolumeFact } from '../../src/domain/types.js';
import type { RuleContext } from '../../src/rules/types.js';

export const NOW = '2026-10-20T12:00:00.000Z';
export const OPP_ID = '11111111-1111-4111-8111-111111111111';
export const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

export function ev(quote: string, sourceId = 'ticket'): Evidence {
  return { sourceId, quote };
}

export function baseFacts(): Facts {
  const documented = { status: 'known', value: 'documented', evidence: ev('documented', 'note-1') } as const;
  return {
    ticket: {
      id: 'issue-1', identifier: 'PRE-900', title: 'Product demonstration for Acme', createdAt: '2026-10-20T09:00:00.000Z', requestKind: 'demo',
      form: { target: ['End customer'], customerName: 'Acme', crmLinkRaw: `https://crm.evertrust.internal/object/opportunity/${OPP_ID}`, requestType: 'Product demonstration', deadline: '2026-11-10', meetingText: 'Demo on 2026-11-05 from 10:00 to 11:00', priority: 'Medium', sharepointLink: '', requesterName: 'Alex Martin' },
    },
    requester: { name: 'Alex Martin', linearUserId: 'user-alex' },
    link: { kind: 'opportunity', id: OPP_ID }, linkedRecordFound: true, companyId: COMPANY_ID,
    deal: {
      opportunity: { id: OPP_ID, companyId: COMPANY_ID, dealtype: 'NEWBUSINESS', hosting: ['SAAS'], decisionnaires: 'CISO', besoin: 'CLM for internal PKI', technicalInformation: 'ADCS today', blocker: '', description: '', salesChannel: 'DIRECT', hasActualPartner: true, dataQualityMissing: '' },
      dealType: 'NEWBUSINESS', notes: [{ id: 'note-1', createdAt: '2026-09-01T10:00:00.000Z', bodyMarkdown: 'Discovery call done.', target: 'opportunity' }], hasPocQuote: false,
      qualification: { items: { volume: documented, hosting: documented, solution: documented, decisionMaker: documented, budget: documented, timeline: documented, currentPki: documented, useCases: documented, clmDriver: documented }, volume: { min: 1000, max: 1000, unitIsClmManagedCerts: true, unclear: false, evidence: ev('1000 certificates', 'note-1') }, solutionIncludesClm: true },
      noteFacts: { discoveryEvidence: null, pocQuoteExpectedEvidence: null, approverException: null, partnerNamed: null },
    },
    ticketFacts: { additionalRequests: [], slot: { date: '2026-11-05', start: '10:00', end: '11:00', timezone: 'Europe/Paris', isComplete: true, ambiguity: null, evidence: ev('Demo on 2026-11-05 from 10:00 to 11:00') }, slotsOfferedAwaitingCustomer: null, repDeclinedMove: null, onsite: null, language: 'en' },
    slotWindow: { startUtc: '2026-11-05T09:00:00.000Z', endUtc: '2026-11-05T10:00:00.000Z', timezone: 'Europe/Paris', timezoneAssumed: false },
    calendar: { members: [{ email: 'sbo@evertrust.fr', name: 'sbo', free: true }, { email: 'vdo@evertrust.fr', name: 'vdo', free: false }, { email: 'ela@evertrust.fr', name: 'ela', free: true }] },
    history: { hasRecentCompletedDiscovery: true, owner: null }, lastAskKeys: [], now: NOW,
  };
}

export function ctx(facts: Facts, config: Partial<Config> = {}, random: Random = () => 0): RuleContext {
  return { facts, config: { ...defaultConfig(), ...config }, random };
}

export function withDeal(facts: Facts, patch: Partial<DealFacts>): Facts {
  return { ...facts, deal: { ...facts.deal!, ...patch } };
}

export function withOpportunity(facts: Facts, patch: Partial<Opportunity>): Facts {
  return withDeal(facts, { opportunity: { ...facts.deal!.opportunity, ...patch } });
}

export function withTicketFacts(facts: Facts, patch: Partial<TicketFacts>): Facts {
  return { ...facts, ticketFacts: { ...facts.ticketFacts, ...patch } };
}

export function withItem(facts: Facts, id: QualificationItemId, status: ItemStatus): Facts {
  return withDeal(facts, { qualification: { ...facts.deal!.qualification, items: { ...facts.deal!.qualification.items, [id]: { ...facts.deal!.qualification.items[id], status } } } });
}

export function withVolume(facts: Facts, volume: VolumeFact | null): Facts {
  return withDeal(facts, { qualification: { ...facts.deal!.qualification, volume } });
}

export function asKind(facts: Facts, kind: RequestKind): Facts {
  return { ...facts, ticket: { ...facts.ticket, requestKind: kind } };
}

export function noDeal(facts: Facts, link: CrmLink, linkedRecordFound: boolean | null): Facts {
  return { ...facts, link, linkedRecordFound, companyId: link.kind === 'company' ? link.id : null, deal: null };
}
