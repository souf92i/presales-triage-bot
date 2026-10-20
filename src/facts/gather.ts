import { mapRequestType, parseAsksForm } from '../asks-parser.js';
import type { GraphClient, LinearComment, LinearIssue, LlmClient, SourceText, TwentyClient } from '../clients/types.js';
import { memberName, type Config } from '../config.js';
import { resolveCrmLink } from '../crm-link.js';
import type { Clock, CrmNote, DealFacts, DealType, Facts, ManualReason, Opportunity, RawLlm, Requester, RequestKind, Slot, SlotWindow } from '../domain/types.js';
import { DependencyError } from '../errors.js';
import type { AskKey } from '../rules/types.js';
import type { HistoryReader } from '../store/store.js';
import { subtractMonths, zonedToUtc } from '../time.js';
import { toSourceMap, verifyQualification, verifyTicketFacts } from './evidence.js';
import { hasPocQuote } from './poc-quote.js';
import { blankPlaceholders, mergeQualification, opportunitySources } from './qualification.js';

export interface GatherDeps {
  readonly config: Config; readonly twenty: TwentyClient; readonly graph: GraphClient;
  readonly llm: LlmClient; readonly history: HistoryReader; readonly clock: Clock;
}
export interface GatherInput {
  readonly issue: LinearIssue; readonly requester: Requester | null;
  readonly requesterComments: readonly LinearComment[]; readonly lastAskKeys: readonly AskKey[];
}
export type GatherResult =
  | { kind: 'manual'; reason: ManualReason }
  | { kind: 'facts'; facts: Facts; label: string; raw: RawLlm };

async function gatherNotes(opportunity: Opportunity, deps: GatherDeps, now: Date): Promise<readonly CrmNote[]> {
  const opportunityNotes = await deps.twenty.listNotes({ kind: 'opportunity', id: opportunity.id });
  const notes = new Map<string, CrmNote>(opportunityNotes.map((note) => [note.id, { ...note, target: 'opportunity' }]));
  if (opportunity.companyId !== null) {
    const companyNotes = await deps.twenty.listNotes({ kind: 'company', id: opportunity.companyId });
    const since = subtractMonths(now, deps.config.noteMaxAgeMonths).toISOString();
    for (const note of companyNotes) {
      if (note.createdAt >= since && !notes.has(note.id)) notes.set(note.id, { ...note, target: 'company' });
    }
  }
  return [...notes.values()].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function dealType(value: string | null): DealType {
  const type = value ?? 'NEWBUSINESS';
  if (type === 'NEWBUSINESS' || type === 'EXISTINGBUSINESS' || type === 'UPSALE' || type === 'ADDITIONAL_YEAR') return type;
  throw new DependencyError('twenty', `Unknown dealtype: ${type}`);
}

async function gatherDeal(opportunity: Opportunity, ticketSources: readonly SourceText[], deps: GatherDeps, now: Date) {
  const o = blankPlaceholders(opportunity, deps.config.placeholderValues);
  const type = dealType(o.dealtype);
  const notes = await gatherNotes(o, deps, now);
  const pocQuote = hasPocQuote(await deps.twenty.listQuotes(o.id), deps.config);
  const sources = [...opportunitySources(o), ...notes.map((note) => ({ id: note.id, label: `Note on ${note.target}`, createdAt: note.createdAt, text: note.bodyMarkdown })), ...ticketSources];
  const result = await deps.llm.extractQualification({ hosting: o.hosting, sources });
  const extraction = verifyQualification(result.value, toSourceMap(sources), {
    discoverySinceIso: subtractMonths(now, deps.config.discoveryMaxAgeMonths).toISOString(),
    approvers: deps.config.approvers, noteIds: new Set(notes.map((note) => note.id)),
  });
  const deal: DealFacts = { opportunity: o, dealType: type, notes, hasPocQuote: pocQuote, ...mergeQualification(o, extraction) };
  return { deal, raw: result.raw };
}

function slotWindow(slot: Slot | null, config: Config): SlotWindow | null {
  if (!slot?.isComplete || slot.ambiguity !== null) return null;
  const timezone = slot.timezone ?? config.defaultTimezone;
  return { startUtc: zonedToUtc(slot.date!, slot.start!, timezone).toISOString(), endUtc: zonedToUtc(slot.date!, slot.end!, timezone).toISOString(), timezone, timezoneAssumed: slot.timezone === null };
}

async function gatherCalendar(window: SlotWindow | null, kind: RequestKind, deps: GatherDeps, now: Date): Promise<Facts['calendar']> {
  if (window === null || window.startUtc <= now.toISOString() || (kind !== 'demo' && kind !== 'technical_discovery')) return null;
  const members = deps.config.pool.filter((member) => member.active);
  const availability = await deps.graph.getAvailability(members.map((member) => member.email), new Date(window.startUtc), new Date(window.endUtc));
  return { members: members.map((member) => {
    const free = availability.get(member.email.toLowerCase());
    if (free === undefined) throw new DependencyError('graph', `No availability for ${member.email}`);
    return { email: member.email, name: memberName(member), free };
  }) };
}

function gatherHistory(companyId: string | null, issueId: string, deps: GatherDeps, now: Date): Facts['history'] {
  if (!deps.history.isBackfillComplete()) return null;
  const hasRecentCompletedDiscovery = companyId !== null && deps.history.hasCompletedTicket(companyId, 'technical_discovery', subtractMonths(now, deps.config.discoveryMaxAgeMonths).toISOString(), issueId);
  const previous = companyId === null ? null : deps.history.latestWorkedTicket(companyId, issueId);
  if (previous?.assigneeEmail == null) return { hasRecentCompletedDiscovery, owner: null };
  const email = previous.assigneeEmail;
  const member = deps.config.pool.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
  return { hasRecentCompletedDiscovery, owner: { email, name: member ? memberName(member) : previous.assigneeName ?? email, ticketIdentifier: previous.identifier, activeInPool: member?.active ?? false } };
}

export async function gatherFacts(input: GatherInput, deps: GatherDeps): Promise<GatherResult> {
  const { issue } = input;
  const form = parseAsksForm(issue.description, issue.attachmentTitles, deps.config.placeholderValues);
  if (form === null) return { kind: 'manual', reason: { key: 'unsupported_form' } };
  const mapping = mapRequestType(form.requestType, deps.config.requestTypes);
  if (mapping === null) return { kind: 'manual', reason: { key: 'unknown_request_type', requestType: form.requestType } };
  const now = deps.clock();
  const sources: readonly SourceText[] = [
    { id: 'ticket', label: 'Ticket', createdAt: issue.createdAt, text: `${issue.title}\n${issue.description}` },
    ...input.requesterComments.map((comment) => ({ id: comment.id, label: `Reply by ${comment.authorName}`, createdAt: comment.createdAt, text: comment.body })),
  ];
  const link = resolveCrmLink(form.crmLinkRaw, form.target);
  let linkedRecordFound: boolean | null = null;
  let deal: DealFacts | null = null;
  let qualificationRaw: unknown = null;
  if (link.kind === 'opportunity') {
    const opportunity = await deps.twenty.getOpportunity(link.id);
    linkedRecordFound = opportunity !== null;
    if (opportunity !== null) {
      const gathered = await gatherDeal(opportunity, sources, deps, now);
      deal = gathered.deal; qualificationRaw = gathered.raw;
    }
  } else if (link.kind === 'company') {
    linkedRecordFound = (await deps.twenty.getCompany(link.id)) !== null;
  }
  const companyId = deal?.opportunity.companyId ?? (link.kind === 'company' ? link.id : null);
  const ticketResult = await deps.llm.extractTicketFacts({ formKind: mapping.kind, form, sources });
  const ticketFacts = verifyTicketFacts(ticketResult.value, toSourceMap(sources));
  const window = slotWindow(ticketFacts.slot, deps.config);
  const calendar = await gatherCalendar(window, mapping.kind, deps, now);
  const history = gatherHistory(companyId, issue.id, deps, now);
  return {
    kind: 'facts', label: mapping.label,
    facts: { ticket: { id: issue.id, identifier: issue.identifier, title: issue.title, createdAt: issue.createdAt, form, requestKind: mapping.kind }, requester: input.requester, link, linkedRecordFound, companyId, deal, ticketFacts, slotWindow: window, calendar, history, lastAskKeys: input.lastAskKeys, now: now.toISOString() },
    raw: { model: ticketResult.model, ticketFacts: ticketResult.raw, qualification: qualificationRaw },
  };
}
