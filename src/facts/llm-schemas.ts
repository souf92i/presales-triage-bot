import { z } from 'zod';
import type { QualificationExtraction, TicketFacts } from '../domain/types.js';
import { DependencyError } from '../errors.js';
import { isValidTimeZone } from '../time.js';

const EvidenceSchema = z.object({ sourceId: z.string(), quote: z.string() });
const ItemSchema = z.object({ status: z.enum(['known', 'declared_unobtainable', 'missing']), value: z.string().nullable(), evidence: EvidenceSchema.nullable() });
const SlotSchema = z.object({ date: z.string().nullable(), start: z.string().nullable(), end: z.string().nullable(), timezone: z.string().nullable(), isComplete: z.boolean(), ambiguity: z.string().nullable(), evidence: EvidenceSchema });

export const LlmTicketFactsSchema = z.object({
  additionalRequests: z.array(z.object({ kind: z.enum(['demo', 'technical_discovery', 'poc', 'rfx']), evidence: EvidenceSchema })),
  slot: SlotSchema.nullable(),
  slotsOfferedAwaitingCustomer: EvidenceSchema.nullable(),
  repDeclinedMove: EvidenceSchema.nullable(),
  onsite: EvidenceSchema.nullable(),
  language: z.string(),
});

export const LlmQualificationSchema = z.object({
  items: z.object({ volume: ItemSchema, hosting: ItemSchema, solution: ItemSchema, decisionMaker: ItemSchema, budget: ItemSchema, timeline: ItemSchema, currentPki: ItemSchema, useCases: ItemSchema, clmDriver: ItemSchema }),
  volume: z.object({ min: z.number(), max: z.number(), unitIsClmManagedCerts: z.boolean(), unclear: z.boolean(), evidence: EvidenceSchema }).nullable(),
  solutionIncludesClm: z.boolean().nullable(),
  discoveryEvidence: EvidenceSchema.nullable(),
  pocQuoteExpectedEvidence: EvidenceSchema.nullable(),
  approverException: z.object({ approver: z.string(), evidence: EvidenceSchema }).nullable(),
  partnerNamed: z.object({ name: z.string(), evidence: EvidenceSchema }).nullable(),
});

function fail(): never { throw new DependencyError('llm', 'invalid LLM output'); }

export function normalizeTicketFacts(raw: unknown): TicketFacts {
  const parsed = LlmTicketFactsSchema.safeParse(raw);
  if (!parsed.success) return fail();
  const { slot } = parsed.data;
  if (slot !== null) {
    if ((slot.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) || (slot.start !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start)) || (slot.end !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.end)) || (slot.timezone !== null && !isValidTimeZone(slot.timezone))) return fail();
  }
  return { ...parsed.data, language: /^[a-z]{2}/i.test(parsed.data.language) ? parsed.data.language.slice(0, 2).toLowerCase() : 'en', slot: slot === null ? null : { ...slot, isComplete: slot.date !== null && slot.start !== null && slot.end !== null } };
}

export function normalizeQualification(raw: unknown): QualificationExtraction {
  const parsed = LlmQualificationSchema.safeParse(raw);
  if (!parsed.success) return fail();
  const { volume } = parsed.data;
  if (volume !== null && (!Number.isFinite(volume.min) || !Number.isFinite(volume.max) || volume.min < 0 || volume.max < 0 || volume.min > volume.max)) return fail();
  return parsed.data;
}
