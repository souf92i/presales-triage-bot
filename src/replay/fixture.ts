import { z } from 'zod';

import { renderOutcomeBody } from '../actions.js';
import { MemoryGraph, MemoryLlm, MemoryTwenty } from '../clients/memory.js';
import type { LinearComment, LinearIssue, LinearUser } from '../clients/types.js';
import { ConfigSchema, type Config } from '../config.js';
import type { Verdict } from '../domain/types.js';
import { evaluateTicket } from '../evaluate.js';
import type { Annotation, AnnotationKey, AskKey, DenyKey, RuleId, RuleOutcome } from '../rules/types.js';
import { openStore, type IndexEntry } from '../store/store.js';
import { ticketInput } from '../triggers.js';

const labelSchema = z.object({ id: z.string(), name: z.string() });
const issueSchema = z.object({
  id: z.string(), identifier: z.string(), number: z.number(), title: z.string(), description: z.string(),
  createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().nullable(), stateType: z.string(), stateId: z.string(),
  assignee: z.object({ id: z.string(), email: z.string(), name: z.string() }).nullable(), labels: z.array(labelSchema), attachmentTitles: z.array(z.string()),
});
const commentSchema = z.object({ id: z.string(), issueId: z.string(), body: z.string(), createdAt: z.string(), parentId: z.string().nullable(), authorId: z.string().nullable(), authorName: z.string() });
const userSchema = z.object({ id: z.string(), name: z.string(), displayName: z.string(), email: z.string() });
const opportunitySchema = z.object({
  id: z.string(), companyId: z.string().nullable(), dealtype: z.string().nullable(), hosting: z.array(z.string()),
  decisionnaires: z.string(), besoin: z.string(), technicalInformation: z.string(), blocker: z.string(), description: z.string(),
  salesChannel: z.string().nullable(), hasActualPartner: z.boolean(), dataQualityMissing: z.string(), deleted: z.boolean().optional(),
});
const twentySchema = z.object({
  opportunities: z.array(opportunitySchema), companies: z.array(z.object({ id: z.string(), name: z.string() })),
  notes: z.array(z.object({ id: z.string(), createdAt: z.string(), bodyMarkdown: z.string(), opportunityId: z.string().nullable(), companyId: z.string().nullable() })),
  quotes: z.array(z.object({ id: z.string(), opportunityId: z.string(), status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']), lines: z.array(z.object({ productId: z.string().nullable(), name: z.string(), description: z.string() })) })),
});
const historySchema = z.object({
  issueId: z.string(), identifier: z.string(), number: z.number(), companyId: z.string(), requestKind: z.enum(['demo', 'technical_discovery', 'poc', 'rfx']).nullable(),
  stateType: z.string(), assigneeEmail: z.string().nullable(), assigneeName: z.string().nullable(), createdAt: z.string(), completedAt: z.string().nullable(), updatedAt: z.string(),
});

export const ReplayFixtureSchema = z.object({
  now: z.string(), config: ConfigSchema.partial().optional(), botUserId: z.string(), users: z.array(userSchema).optional(), lastAskKeys: z.array(z.string()).optional(),
  backfillComplete: z.boolean().default(true), issue: issueSchema, comments: z.array(commentSchema), twenty: twentySchema,
  calendar: z.record(z.string(), z.boolean()), history: z.array(historySchema), llm: z.object({ ticketFacts: z.unknown(), qualification: z.unknown() }),
  expected: z.object({ verdict: z.enum(['accepted', 'waiting', 'denied', 'manual', 'pending_retry']), denies: z.array(z.string()).optional(), asks: z.array(z.string()).optional(), annotations: z.array(z.string()).optional() }).optional(),
}).strict();

export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;
export interface ReplayReport { verdict: Verdict; rules: { ruleId: RuleId; outcome: RuleOutcome }[]; annotations: Annotation[]; comment: string | null; mismatches: string[] }

function replayConfig(config: ReplayFixture['config']): Config {
  return ConfigSchema.parse({ ...ConfigSchema.parse({}), ...config });
}

function compareSet(name: string, actual: readonly string[], expected: readonly string[] | undefined): string[] {
  if (expected === undefined) return [];
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.join('\u0000') === right.join('\u0000') ? [] : [`${name} differs: expected ${right.join(', ')}, got ${left.join(', ')}`];
}

export async function runReplay(fixture: ReplayFixture): Promise<ReplayReport> {
  const store = openStore(':memory:');
  try {
    for (const entry of fixture.history as readonly IndexEntry[]) store.index.upsert(entry);
    if (fixture.backfillComplete) store.cursors.set('backfill_complete', 'true');
    const users = fixture.users as LinearUser[] ?? [];
    const input = ticketInput({ issue: fixture.issue as LinearIssue, comments: fixture.comments as LinearComment[] }, users, fixture.botUserId);
    const outcome = await evaluateTicket({ issue: fixture.issue as LinearIssue, ...input, lastAskKeys: fixture.lastAskKeys as AskKey[] ?? [] }, {
      config: replayConfig(fixture.config), twenty: new MemoryTwenty(fixture.twenty), graph: new MemoryGraph(fixture.calendar),
      llm: new MemoryLlm(fixture.llm), history: store.index, clock: () => new Date(fixture.now), random: () => 0, users,
    });
    const report = outcome.kind === 'manual'
      ? { verdict: 'manual' as const, rules: [], annotations: [], comment: renderOutcomeBody(outcome) }
      : { verdict: outcome.result.verdict, rules: outcome.result.results.map(({ ruleId, outcome: ruleOutcome }) => ({ ruleId, outcome: ruleOutcome })), annotations: [...outcome.result.annotations], comment: renderOutcomeBody(outcome) };
    const mismatches = fixture.expected === undefined ? [] : [
      ...(report.verdict === fixture.expected.verdict ? [] : [`verdict differs: expected ${fixture.expected.verdict}, got ${report.verdict}`]),
      ...compareSet('denies', outcome.kind === 'manual' ? [] : outcome.result.denies.map(({ key }) => key), fixture.expected.denies),
      ...compareSet('asks', outcome.kind === 'manual' ? [] : outcome.result.asks.map(({ key }) => key), fixture.expected.asks),
      ...compareSet('annotations', report.annotations.map(({ key }) => key), fixture.expected.annotations),
    ];
    return { ...report, mismatches };
  } finally {
    store.close();
  }
}
