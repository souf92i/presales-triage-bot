import type { AskKey } from '../rules/types.js';

export type Clock = () => Date;
export type Random = () => number;
export type Mode = 'enforce' | 'shadow';
export const REQUEST_KINDS = ['demo', 'technical_discovery', 'poc', 'rfx'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export type Target = 'End customer' | 'Partner';
export type TemplateLanguage = 'fr' | 'en';

export interface Evidence { readonly sourceId: string; readonly quote: string }

export interface AsksForm {
  readonly target: readonly Target[]; readonly customerName: string; readonly crmLinkRaw: string;
  readonly requestType: string; readonly deadline: string | null; readonly meetingText: string;
  readonly priority: string; readonly sharepointLink: string; readonly requesterName: string | null;
}
export type CrmLink =
  | { readonly kind: 'opportunity'; readonly id: string }
  | { readonly kind: 'company'; readonly id: string }
  | { readonly kind: 'invalid'; readonly raw: string };

export type DealType = 'NEWBUSINESS' | 'EXISTINGBUSINESS' | 'UPSALE' | 'ADDITIONAL_YEAR';
export interface Opportunity {
  readonly id: string; readonly companyId: string | null; readonly dealtype: string | null;
  readonly hosting: readonly string[];
  readonly decisionnaires: string; readonly besoin: string; readonly technicalInformation: string;
  readonly blocker: string; readonly description: string;
  readonly salesChannel: string | null; readonly hasActualPartner: boolean; readonly dataQualityMissing: string;
}
export interface Company { readonly id: string; readonly name: string }
export interface CrmNote { readonly id: string; readonly createdAt: string; readonly bodyMarkdown: string; readonly target: 'opportunity' | 'company' }
export interface QuoteLine { readonly productId: string | null; readonly name: string; readonly description: string }
export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
export interface Quote { readonly id: string; readonly status: (typeof QUOTE_STATUSES)[number]; readonly lines: readonly QuoteLine[] }

export const QUALIFICATION_ITEMS = ['volume', 'hosting', 'solution', 'decisionMaker', 'budget', 'timeline', 'currentPki', 'useCases', 'clmDriver'] as const;
export type QualificationItemId = (typeof QUALIFICATION_ITEMS)[number];
export type ItemStatus = 'known' | 'declared_unobtainable' | 'missing';
export interface QualificationItem { readonly status: ItemStatus; readonly value: string | null; readonly evidence: Evidence | null }
export interface VolumeFact { readonly min: number; readonly max: number; readonly unitIsClmManagedCerts: boolean; readonly unclear: boolean; readonly evidence: Evidence }
export interface NoteFacts {
  readonly discoveryEvidence: Evidence | null;
  readonly pocQuoteExpectedEvidence: Evidence | null;
  readonly approverException: { readonly approver: string; readonly evidence: Evidence } | null;
  readonly partnerNamed: { readonly name: string; readonly evidence: Evidence } | null;
}
export interface QualificationFacts {
  readonly items: Readonly<Record<QualificationItemId, QualificationItem>>;
  readonly volume: VolumeFact | null;
  readonly solutionIncludesClm: boolean | null;
}
export type QualificationExtraction = QualificationFacts & NoteFacts;

export interface Slot {
  readonly date: string | null; readonly start: string | null; readonly end: string | null;
  readonly timezone: string | null; readonly isComplete: boolean; readonly ambiguity: string | null;
  readonly evidence: Evidence;
}
export interface TicketFacts {
  readonly additionalRequests: readonly { readonly kind: RequestKind; readonly evidence: Evidence }[];
  readonly slot: Slot | null;
  readonly slotsOfferedAwaitingCustomer: Evidence | null;
  readonly repDeclinedMove: Evidence | null;
  readonly onsite: Evidence | null;
  readonly language: string;
}
export interface SlotWindow { readonly startUtc: string; readonly endUtc: string; readonly timezone: string; readonly timezoneAssumed: boolean }
export interface MemberAvailability { readonly email: string; readonly name: string; readonly free: boolean }
export interface OwnerFacts { readonly email: string; readonly name: string; readonly ticketIdentifier: string; readonly activeInPool: boolean }
export interface Requester { readonly name: string; readonly linearUserId: string | null }

export interface DealFacts {
  readonly opportunity: Opportunity;
  readonly dealType: DealType;
  readonly notes: readonly CrmNote[];
  readonly hasPocQuote: boolean;
  readonly qualification: QualificationFacts;
  readonly noteFacts: NoteFacts;
}
export interface Facts {
  readonly ticket: { readonly id: string; readonly identifier: string; readonly title: string; readonly createdAt: string; readonly form: AsksForm; readonly requestKind: RequestKind };
  readonly requester: Requester | null;
  readonly link: CrmLink;
  readonly linkedRecordFound: boolean | null;
  readonly companyId: string | null;
  readonly deal: DealFacts | null;
  readonly ticketFacts: TicketFacts;
  readonly slotWindow: SlotWindow | null;
  readonly calendar: { readonly members: readonly MemberAvailability[] } | null;
  readonly history: { readonly hasRecentCompletedDiscovery: boolean; readonly owner: OwnerFacts | null } | null;
  readonly lastAskKeys: readonly AskKey[];
  readonly now: string;
}
export type Verdict = 'accepted' | 'waiting' | 'denied' | 'manual' | 'pending_retry';
export type ManualReason = { readonly key: 'unsupported_form' } | { readonly key: 'unknown_request_type'; readonly requestType: string };
export interface RawLlm { readonly model: string | null; readonly ticketFacts: unknown; readonly qualification: unknown }
