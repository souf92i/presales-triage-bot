import { hasOwnerAnnotation } from './annotations.js';
import type { LinearClient, LinearComment, LinearIssue, LinearWorkspace } from './clients/types.js';
import { renderHandoffComment, renderManualComment, renderShadowComment, renderVerdictComment, renderWaitExpiryComment } from './comments/render.js';
import { managedLabels, templateLanguage, type Config } from './config.js';
import type { Clock, Mode, SlotWindow } from './domain/types.js';
import type { EvaluationOutcome } from './evaluate.js';
import { addDays, endOfDayUtc } from './time.js';
import { findSyncedThreadRoot } from './triggers.js';

export type StartedFrom = 'triage' | 'canceled';
export interface ActionDeps {
  readonly linear: LinearClient;
  readonly workspace: LinearWorkspace;
  readonly config: Config;
  readonly clock: Clock;
}
export interface ActionsResult {
  readonly skipped: boolean;
  readonly actions: readonly string[];
  readonly waitExpiresAt: string | null;
}

const skipped: ActionsResult = { skipped: true, actions: ['skipped:pre-action-check'], waitExpiresAt: null };

export function computeWaitExpiry(now: Date, waitDays: number, slotWindow: SlotWindow | null, deadline: string | null, timeZone: string): Date {
  const candidates = [addDays(now, waitDays).getTime()];
  if (slotWindow !== null) candidates.push(new Date(slotWindow.startUtc).getTime());
  if (deadline !== null) candidates.push(endOfDayUtc(deadline, timeZone).getTime());
  return new Date(Math.min(...candidates.filter((candidate) => candidate > now.getTime())));
}

export async function preActionCheck(issueId: string, startedFrom: StartedFrom, deps: ActionDeps): Promise<LinearIssue | null> {
  const issue = await deps.linear.getIssue(issueId);
  if (issue === null) return null;
  if (issue.labels.some(({ name }) => name.toLowerCase() === deps.config.overrideLabel.toLowerCase())) return null;
  if (startedFrom === 'triage' && issue.stateType !== 'triage') return null;
  if (startedFrom === 'canceled' && issue.stateId !== deps.workspace.canceledStateId) return null;
  return issue;
}

async function updateLabels(issue: LinearIssue, mappedLabel: string, deps: ActionDeps): Promise<string[]> {
  const label = mappedLabel.toLowerCase();
  const actions: string[] = [];
  if (!issue.labels.some(({ name }) => name.toLowerCase() === label)) {
    await deps.linear.addLabel(issue.id, deps.workspace.labelIds[label]!);
    actions.push(`label:+${mappedLabel}`);
  }
  const managed = managedLabels(deps.config);
  for (const present of issue.labels) {
    const name = present.name.toLowerCase();
    if (name !== label && managed.includes(name)) {
      await deps.linear.removeLabel(issue.id, present.id);
      actions.push(`label:-${name}`);
    }
  }
  return actions;
}

async function enforceState(issue: LinearIssue, outcome: Extract<EvaluationOutcome, { kind: 'evaluated' }>, deps: ActionDeps): Promise<string[]> {
  const { verdict, annotations } = outcome.result;
  const actions: string[] = [];
  const input: { stateId?: string; assigneeId?: string } = {};
  if (verdict === 'denied' && issue.stateId !== deps.workspace.canceledStateId) {
    input.stateId = deps.workspace.canceledStateId;
    actions.push('state:canceled');
  }
  if ((verdict === 'waiting' || verdict === 'accepted') && issue.stateType !== 'triage') {
    input.stateId = deps.workspace.triageStateId;
    actions.push('state:triage');
  }
  if (verdict === 'accepted' && !hasOwnerAnnotation(annotations)) {
    input.assigneeId = deps.workspace.triageOwnerId;
    actions.push(`assign:${deps.config.triageOwnerEmail}`);
  }
  if (actions.length > 0) await deps.linear.updateIssue(issue.id, input);
  return actions;
}

function renderOutcomeBody(outcome: EvaluationOutcome): string {
  if (outcome.kind === 'manual') return renderManualComment(outcome.reason);
  const { verdict } = outcome.result;
  if (verdict === 'pending_retry') throw new Error('applyOutcome called with pending_retry');
  return renderVerdictComment({ ...outcome.result, verdict }, templateLanguage(outcome.facts.ticketFacts.language));
}

export async function applyOutcome(args: { issue: LinearIssue; comments: readonly LinearComment[]; outcome: EvaluationOutcome; mode: Mode; startedFrom: StartedFrom }, deps: ActionDeps): Promise<ActionsResult> {
  const { outcome, mode } = args;
  let body = renderOutcomeBody(outcome);
  const issue = await preActionCheck(args.issue.id, args.startedFrom, deps);
  if (issue === null) return skipped;
  const actions = outcome.kind === 'evaluated' ? await updateLabels(issue, outcome.label, deps) : [];
  if (mode === 'shadow') body = renderShadowComment({
    verdict: outcome.kind === 'manual' ? 'manual' : outcome.result.verdict,
    results: outcome.kind === 'manual' ? [] : outcome.result.results,
    body,
  });
  const parentId = mode === 'shadow' ? null : findSyncedThreadRoot(args.comments)?.id ?? null;
  const commentId = await deps.linear.createComment({ issueId: issue.id, parentId, body });
  actions.push(`comment:${commentId}`);
  let waitExpiresAt: string | null = null;
  if (mode === 'enforce' && outcome.kind === 'evaluated') {
    actions.push(...await enforceState(issue, outcome, deps));
    if (outcome.result.verdict === 'waiting') waitExpiresAt = computeWaitExpiry(
      deps.clock(), deps.config.waitDays, outcome.facts.slotWindow, outcome.facts.ticket.form.deadline, deps.config.defaultTimezone,
    ).toISOString();
  }
  return { skipped: false, actions, waitExpiresAt };
}

export async function postHandoff(args: { issue: LinearIssue; comments: readonly LinearComment[]; mode: Mode; startedFrom: StartedFrom }, deps: ActionDeps): Promise<ActionsResult> {
  const issue = await preActionCheck(args.issue.id, args.startedFrom, deps);
  if (issue === null) return skipped;
  const handoff = renderHandoffComment();
  const body = args.mode === 'shadow' ? renderShadowComment({ verdict: 'pending_retry', results: [], body: handoff }) : handoff;
  const parentId = args.mode === 'shadow' ? null : findSyncedThreadRoot(args.comments)?.id ?? null;
  const commentId = await deps.linear.createComment({ issueId: issue.id, parentId, body });
  return { skipped: false, actions: [`comment:${commentId}`], waitExpiresAt: null };
}

export async function expireWait(args: { issue: LinearIssue; comments: readonly LinearComment[]; language: string }, deps: ActionDeps): Promise<ActionsResult> {
  const issue = await preActionCheck(args.issue.id, 'triage', deps);
  if (issue === null) return skipped;
  const commentId = await deps.linear.createComment({
    issueId: issue.id,
    parentId: findSyncedThreadRoot(args.comments)?.id ?? null,
    body: renderWaitExpiryComment(templateLanguage(args.language)),
  });
  await deps.linear.updateIssue(issue.id, { stateId: deps.workspace.canceledStateId });
  return { skipped: false, actions: [`comment:${commentId}`, 'state:canceled'], waitExpiresAt: null };
}
