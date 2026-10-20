import type { Config } from '../config.js';
import type { Facts, QualificationItemId, Random, RequestKind } from '../domain/types.js';

export const RULE_IDS = ['single-request', 'crm-link', 'notes-exist', 'qualification', 'volume-floor', 'discovery-first', 'slot', 'poc-volume', 'poc-paid'] as const;
export type RuleId = (typeof RULE_IDS)[number];
export type Deny =
  | { key: 'single_request.multiple'; items: readonly { kind: RequestKind; quote: string }[] }
  | { key: 'crm_link.invalid'; raw: string; partnerOnly: boolean }
  | { key: 'crm_link.not_found'; recordKind: 'opportunity' | 'company'; id: string }
  | { key: 'notes_exist.none'; maxAgeMonths: number }
  | { key: 'qualification.missing'; items: readonly { id: QualificationItemId; status: 'missing' | 'declared_unobtainable' }[]; maxUnknown: number; dataQualityMissing: string }
  | { key: 'volume_floor.below_min'; max: number; min: number }
  | { key: 'discovery_first.missing'; kind: 'demo' | 'poc'; maxAgeMonths: number }
  | { key: 'slot.rep_declined_move' }
  | { key: 'slot.no_slot' }
  | { key: 'poc_volume.below_min'; max: number; min: number }
  | { key: 'poc_paid.no_quote' }
  | { key: 'wait.no_answer' };
export type Ask =
  | { key: 'volume_floor.unclear'; quote: string }
  | { key: 'slot.incomplete'; missing: readonly ('date' | 'start' | 'end')[] }
  | { key: 'slot.past'; date: string; start: string }
  | { key: 'slot.nobody_available'; date: string; start: string; end: string; timezone: string };
export type Annotation =
  | { key: 'slot.timezone_assumed'; timezone: string }
  | { key: 'slot.short_notice'; workingDays: number }
  | { key: 'slot.onsite' }
  | { key: 'slot.free_members'; members: readonly string[] }
  | { key: 'slot.check_later' }
  | { key: 'owner.active'; owner: string; ticket: string; freeOnSlot: boolean | null }
  | { key: 'owner.away'; owner: string; ticket: string }
  | { key: 'partner.caution'; indirect: boolean }
  | { key: 'poc.go_nogo' }
  | { key: 'poc_paid.exception'; approver: string; quote: string };
export type DenyKey = Deny['key']; export type AskKey = Ask['key']; export type AnnotationKey = Annotation['key'];
export type RuleOutcome =
  | { kind: 'pass' } | { kind: 'deny'; deny: Deny } | { kind: 'ask'; ask: Ask }
  | { kind: 'skip'; reason: string } | { kind: 'error'; reason: string };
export interface RuleResult { readonly ruleId: RuleId; readonly outcome: RuleOutcome; readonly annotations: readonly Annotation[] }
export interface RuleContext { readonly facts: Facts; readonly config: Config; readonly random: Random }
export type Applicability = { applies: true } | { applies: false; reason: string };
export interface Rule {
  readonly id: RuleId;
  applies(ctx: RuleContext): Applicability;
  evaluate(ctx: RuleContext): { outcome: Exclude<RuleOutcome, { kind: 'skip' }>; annotations: readonly Annotation[] };
}
