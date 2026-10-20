import type { SourceText } from '../clients/types.js';
import type { Evidence, QualificationExtraction, TicketFacts } from '../domain/types.js';
import { normalizeWhitespace } from '../text.js';
import { missingItem } from './qualification.js';

export type SourceMap = ReadonlyMap<string, SourceText>;

export function toSourceMap(sources: readonly SourceText[]): SourceMap {
  return new Map(sources.map((source) => [source.id, source]));
}

export function checkEvidence(evidence: Evidence | null, sources: SourceMap): boolean {
  if (evidence === null) return false;
  const source = sources.get(evidence.sourceId);
  const quote = normalizeWhitespace(evidence.quote);
  return source !== undefined && quote !== '' && normalizeWhitespace(source.text).includes(quote);
}

export function verifyTicketFacts(facts: TicketFacts, sources: SourceMap): TicketFacts {
  return {
    ...facts,
    additionalRequests: facts.additionalRequests.filter(({ evidence }) => checkEvidence(evidence, sources)),
    slot: facts.slot !== null && checkEvidence(facts.slot.evidence, sources) ? facts.slot : null,
    slotsOfferedAwaitingCustomer: checkEvidence(facts.slotsOfferedAwaitingCustomer, sources) ? facts.slotsOfferedAwaitingCustomer : null,
    repDeclinedMove: checkEvidence(facts.repDeclinedMove, sources) ? facts.repDeclinedMove : null,
    onsite: checkEvidence(facts.onsite, sources) ? facts.onsite : null,
  };
}

function verifiedItem<T extends QualificationExtraction['items'][keyof QualificationExtraction['items']]>(item: T, sources: SourceMap): T | typeof missingItem {
  return (item.status === 'known' || item.status === 'declared_unobtainable') && !checkEvidence(item.evidence, sources) ? missingItem : item;
}

function hasApprover(approver: string, configured: readonly string[]): boolean {
  return configured.some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(approver));
}

export function verifyQualification(
  extraction: QualificationExtraction,
  sources: SourceMap,
  opts: { discoverySinceIso: string; approvers: readonly string[]; noteIds: ReadonlySet<string> },
): QualificationExtraction {
  const itemEntries = Object.entries(extraction.items).map(([id, item]) => [id, verifiedItem(item, sources)]);
  const items = Object.fromEntries(itemEntries) as QualificationExtraction['items'];
  const volume = extraction.volume !== null && checkEvidence(extraction.volume.evidence, sources) ? extraction.volume : null;
  const partnerNamed = extraction.partnerNamed !== null && checkEvidence(extraction.partnerNamed.evidence, sources) ? extraction.partnerNamed : null;
  const discoverySource = extraction.discoveryEvidence === null ? undefined : sources.get(extraction.discoveryEvidence.sourceId);
  const discoveryEvidence = extraction.discoveryEvidence !== null
    && checkEvidence(extraction.discoveryEvidence, sources)
    && opts.noteIds.has(extraction.discoveryEvidence.sourceId)
    && discoverySource?.createdAt !== null
    && discoverySource?.createdAt !== undefined
    && discoverySource.createdAt >= opts.discoverySinceIso ? extraction.discoveryEvidence : null;
  const pocQuoteExpectedEvidence = extraction.pocQuoteExpectedEvidence !== null
    && checkEvidence(extraction.pocQuoteExpectedEvidence, sources)
    && opts.noteIds.has(extraction.pocQuoteExpectedEvidence.sourceId) ? extraction.pocQuoteExpectedEvidence : null;
  const approverException = extraction.approverException !== null
    && checkEvidence(extraction.approverException.evidence, sources)
    && hasApprover(extraction.approverException.approver, opts.approvers)
    && hasApprover(extraction.approverException.evidence.quote, opts.approvers) ? extraction.approverException : null;
  return { ...extraction, items, volume, partnerNamed, discoveryEvidence, pocQuoteExpectedEvidence, approverException };
}
