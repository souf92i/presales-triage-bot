import { applyOutcome, expireWait, postHandoff, type StartedFrom } from './actions.js';
import { kindFromLabels, mapRequestType, parseAsksForm } from './asks-parser.js';
import type { GraphClient, IssueWithComments, LinearClient, LinearIssue, LinearWorkspace, LlmClient, TwentyClient } from './clients/types.js';
import type { Config } from './config.js';
import { resolveCrmLink } from './crm-link.js';
import type { Clock, Mode, Random } from './domain/types.js';
import { DependencyError } from './errors.js';
import { evaluateTicket, type EvaluationOutcome } from './evaluate.js';
import type { Logger } from './log.js';
import type { AuditRecord, Store, TicketRecord } from './store/store.js';
import { shouldEvaluate, ticketInput } from './triggers.js';

export interface PollerDeps {
  readonly config: Config; readonly linear: LinearClient; readonly twenty: TwentyClient;
  readonly graph: GraphClient; readonly llm: LlmClient; readonly store: Store;
  readonly workspace: LinearWorkspace; readonly botUserId: string;
  readonly clock: Clock; readonly random: Random; readonly log: Logger;
}

type Candidate = IssueWithComments & ReturnType<typeof ticketInput> & {
  readonly record: TicketRecord | null;
  readonly startedFrom: StartedFrom;
};

function logError(error: unknown, phase: string, deps: PollerDeps): void {
  if (error instanceof DependencyError) {
    deps.log('warn', phase, { dependency: error.dependency, error: error.message });
  } else {
    deps.log('error', phase, { error: String(error), stack: error instanceof Error ? error.stack : undefined });
  }
}

async function indexIssue(issue: LinearIssue, deps: PollerDeps): Promise<void> {
  const { config, store } = deps;
  const form = parseAsksForm(issue.description, issue.attachmentTitles, config.placeholderValues);
  const kind = (form && mapRequestType(form.requestType, config.requestTypes)?.kind)
    ?? kindFromLabels(issue.labels.map(({ name }) => name), config.requestTypes);
  const link = form === null ? null : resolveCrmLink(form.crmLinkRaw, form.target);
  const companyId = link?.kind === 'opportunity' ? (await deps.twenty.getOpportunity(link.id))?.companyId ?? null
    : link?.kind === 'company' ? link.id : null;
  if (companyId === null) { store.index.delete(issue.id); return; }
  store.index.upsert({
    issueId: issue.id, identifier: issue.identifier, number: issue.number, companyId, requestKind: kind,
    stateType: issue.stateType, assigneeEmail: issue.assignee?.email ?? null, assigneeName: issue.assignee?.name ?? null,
    createdAt: issue.createdAt, completedAt: issue.completedAt, updatedAt: issue.updatedAt,
  });
}

export async function refreshIndex(deps: PollerDeps): Promise<void> {
  const cursor = deps.store.cursors.get('index_updated_at');
  const issues = await deps.linear.listIssuesUpdatedSince(deps.config.teamKey, cursor);
  let latest = cursor;
  for (const issue of issues) {
    await indexIssue(issue, deps);
    if (latest === null || issue.updatedAt > latest) latest = issue.updatedAt;
  }
  if (latest !== null) deps.store.cursors.set('index_updated_at', latest);
  if (cursor === null) deps.store.cursors.set('backfill_complete', 'true');
}

function addCandidate(ticket: IssueWithComments, startedFrom: StartedFrom, candidates: Candidate[], mode: Mode, deps: PollerDeps): void {
  if (ticket.issue.labels.some(({ name }) => name.toLowerCase() === deps.config.overrideLabel.toLowerCase())) return;
  const input = ticketInput(ticket, deps.workspace.users, deps.botUserId);
  const record = deps.store.tickets.get(ticket.issue.id);
  if (shouldEvaluate({ state: record, mode, inTriage: startedFrom === 'triage', botCanceled: startedFrom === 'canceled', ...input })) {
    candidates.push({ ...ticket, ...input, record, startedFrom });
  }
}

async function recheckIds(deps: PollerDeps): Promise<{ issueIds: ReadonlySet<string>; latest: string }> {
  const cursor = deps.store.cursors.get('comments_created_at');
  const issueIds = new Set<string>();
  let latest = cursor ?? deps.clock().toISOString();
  if (cursor !== null) {
    const comments = await deps.linear.listCommentsCreatedSince(deps.config.teamKey, cursor);
    for (const comment of comments) {
      const record = deps.store.tickets.get(comment.issueId);
      if (record?.status === 'denied' || (record?.startedFrom === 'canceled' && ['handed_off', 'pending_retry'].includes(record.status))) {
        issueIds.add(comment.issueId);
      }
      if (comment.createdAt > latest) latest = comment.createdAt;
    }
  }
  for (const record of deps.store.tickets.listByStatus(['pending_retry'])) {
    if (record.startedFrom === 'canceled') issueIds.add(record.issueId);
  }
  return { issueIds, latest };
}

async function collectCandidates(candidates: Candidate[], mode: Mode, deps: PollerDeps): Promise<void> {
  for (const ticket of await deps.linear.listTriageIssues(deps.config.teamKey)) {
    addCandidate(ticket, 'triage', candidates, mode, deps);
  }
  if (mode === 'shadow') return;
  const { issueIds, latest } = await recheckIds(deps);
  for (const id of issueIds) {
    if (candidates.some(({ issue }) => issue.id === id)) continue;
    const ticket = await deps.linear.getIssueWithComments(id);
    if (ticket?.issue.stateId === deps.workspace.canceledStateId) addCandidate(ticket, 'canceled', candidates, mode, deps);
  }
  deps.store.cursors.set('comments_created_at', latest);
}

function baseRecord(candidate: Candidate, mode: Mode, deps: PollerDeps): TicketRecord {
  return {
    issueId: candidate.issue.id, identifier: candidate.issue.identifier, status: 'pending_retry',
    inputHash: null, commentIds: [], lastAskKeys: [], language: 'en',
    firstFailureAt: null, lastError: null, lastEvaluatedAt: null, ...candidate.record,
    mode, startedFrom: candidate.startedFrom, updatedAt: deps.clock().toISOString(),
  };
}

function audit(candidate: Candidate, mode: Mode, outcome: EvaluationOutcome | null,
  details: Pick<AuditRecord, 'verdict' | 'actions' | 'error'>, deps: PollerDeps): void {
  const evaluated = outcome?.kind === 'evaluated' ? outcome : null;
  const record: AuditRecord = {
    issueId: candidate.issue.id, identifier: candidate.issue.identifier, at: deps.clock().toISOString(), mode,
    inputHash: candidate.inputHash, model: evaluated?.raw.model ?? null, rawLlm: evaluated?.raw ?? null,
    facts: evaluated?.facts ?? null, results: evaluated?.result.results ?? [], annotations: evaluated?.result.annotations ?? [],
    ...details,
  };
  deps.store.audit.insert(record);
  deps.log('info', 'audit', { ...record });
}

function persistOutcome(candidate: Candidate, mode: Mode, outcome: EvaluationOutcome, waitExpiresAt: string | null, deps: PollerDeps): void {
  const evaluated = outcome.kind === 'evaluated' ? outcome : null;
  const status = evaluated?.result.verdict ?? 'manual';
  deps.store.tickets.upsert({
    ...baseRecord(candidate, mode, deps), status, inputHash: candidate.inputHash,
    commentIds: candidate.requesterComments.map(({ id }) => id),
    lastAskKeys: evaluated?.result.asks.map(({ key }) => key) ?? [],
    language: evaluated?.facts.ticketFacts.language ?? candidate.record?.language ?? 'en',
    firstFailureAt: null, lastError: null, lastEvaluatedAt: deps.clock().toISOString(),
  });
  if (mode === 'enforce') {
    if (status === 'waiting' && waitExpiresAt !== null) {
      deps.store.waits.createIfAbsent(candidate.issue.id, waitExpiresAt, deps.clock().toISOString());
    } else {
      deps.store.waits.delete(candidate.issue.id);
    }
  }
}

async function failCandidate(candidate: Candidate, mode: Mode, outcome: EvaluationOutcome | null, error: unknown, deps: PollerDeps): Promise<void> {
  let message = error instanceof Error ? error.message : String(error);
  if (outcome?.kind === 'evaluated' && outcome.result.verdict === 'pending_retry') {
    deps.log('warn', 'evaluate', { error: message });
  } else {
    logError(error, 'evaluate', deps);
  }
  const now = deps.clock();
  const firstFailureAt = candidate.record?.firstFailureAt ?? now.toISOString();
  let actions: readonly string[] = [];
  let status: 'pending_retry' | 'handed_off' = 'pending_retry';
  if (now.getTime() - new Date(firstFailureAt).getTime() >= deps.config.handoffHours * 60 * 60 * 1000) {
    try {
      const result = await postHandoff({ ...candidate, mode }, deps);
      if (result.skipped) { audit(candidate, mode, outcome, { verdict: status, actions: result.actions, error: message }, deps); return; }
      actions = result.actions;
      status = 'handed_off';
    } catch (handoffError) {
      logError(handoffError, 'handoff', deps);
      message = handoffError instanceof Error ? handoffError.message : String(handoffError);
    }
  }
  deps.store.tickets.upsert({
    ...baseRecord(candidate, mode, deps), status, firstFailureAt: status === 'handed_off' ? null : firstFailureAt,
    lastError: message, ...(status === 'handed_off' ? {
      inputHash: candidate.inputHash, commentIds: candidate.requesterComments.map(({ id }) => id), lastEvaluatedAt: now.toISOString(),
    } : {}),
  });
  audit(candidate, mode, outcome, { verdict: status, actions, error: message }, deps);
}

async function evaluateCandidate(candidate: Candidate, mode: Mode, deps: PollerDeps): Promise<void> {
  let outcome: EvaluationOutcome | null = null;
  try {
    outcome = await evaluateTicket({
      ...candidate, lastAskKeys: candidate.record?.lastAskKeys ?? [],
    }, { ...deps, history: deps.store.index });
    if (outcome.kind === 'evaluated' && outcome.result.verdict === 'pending_retry') {
      await failCandidate(candidate, mode, outcome, new Error(outcome.result.errors.join('; ')), deps);
      return;
    }
    const result = await applyOutcome({ ...candidate, outcome, mode }, deps);
    if (!result.skipped) persistOutcome(candidate, mode, outcome, result.waitExpiresAt, deps);
    audit(candidate, mode, outcome, { verdict: outcome.kind === 'manual' ? 'manual' : outcome.result.verdict, actions: result.actions, error: null }, deps);
  } catch (error) {
    await failCandidate(candidate, mode, outcome, error, deps);
  }
}

async function expireWaits(deps: PollerDeps): Promise<void> {
  for (const wait of deps.store.waits.listExpired(deps.clock().toISOString())) {
    try {
      const record = deps.store.tickets.get(wait.issueId);
      if (record?.status !== 'waiting') continue;
      const ticket = await deps.linear.getIssueWithComments(wait.issueId);
      if (ticket === null) { deps.store.waits.delete(wait.issueId); continue; }
      const input = ticketInput(ticket, deps.workspace.users, deps.botUserId);
      if (input.inputHash !== record.inputHash && ticket.issue.stateType === 'triage'
        && !ticket.issue.labels.some(({ name }) => name.toLowerCase() === deps.config.overrideLabel.toLowerCase())) continue;
      const result = await expireWait({ ...ticket, language: record.language }, deps);
      if (!result.skipped) {
        deps.store.tickets.upsert({
          ...record, status: 'denied', lastAskKeys: [], inputHash: input.inputHash,
          commentIds: input.requesterComments.map(({ id }) => id), updatedAt: deps.clock().toISOString(),
        });
        audit({ ...ticket, ...input, record, startedFrom: record.startedFrom }, 'enforce', null,
          { verdict: 'denied', actions: result.actions, error: null }, deps);
      }
      deps.store.waits.delete(wait.issueId);
    } catch (error) { logError(error, 'wait_expiry', deps); }
  }
}

export async function runTick(deps: PollerDeps): Promise<void> {
  const mode = deps.config.enforce ? 'enforce' : 'shadow';
  let indexFailure: { error: unknown } | null = null;
  try { await refreshIndex(deps); }
  catch (error) { indexFailure = { error }; logError(error, 'index', deps); }
  const candidates: Candidate[] = [];
  let collected = false;
  try { await collectCandidates(candidates, mode, deps); collected = true; }
  catch (error) { logError(error, 'collect', deps); }
  for (const candidate of candidates) {
    if (indexFailure !== null) await failCandidate(candidate, mode, null, indexFailure.error, deps);
    else await evaluateCandidate(candidate, mode, deps);
  }
  if (mode === 'enforce' && collected) {
    try { await expireWaits(deps); } catch (error) { logError(error, 'wait_expiry', deps); }
  }
}
