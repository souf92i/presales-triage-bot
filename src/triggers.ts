import { createHash } from 'node:crypto';
import { parseRequesterName } from './asks-parser.js';
import type { IssueWithComments, LinearComment, LinearUser } from './clients/types.js';
import type { Mode, Requester, Verdict } from './domain/types.js';
import { normalizeName } from './text.js';

export const SYNCED_THREAD_PREFIX = 'This comment thread is synced';

export function isSyncedThreadRoot(comment: LinearComment): boolean {
  return comment.parentId === null && comment.body.startsWith(SYNCED_THREAD_PREFIX);
}

export function findSyncedThreadRoot(comments: readonly LinearComment[]): LinearComment | null {
  return comments.find(isSyncedThreadRoot) ?? null;
}

export function isRecheck(body: string): boolean {
  return body.trim().toLowerCase().startsWith('recheck');
}

export function resolveRequester(name: string | null, users: readonly LinearUser[]): Requester | null {
  if (name === null) return null;

  const normalizedName = normalizeName(name);
  const matches = users.filter((user) =>
    normalizeName(user.name) === normalizedName || normalizeName(user.displayName) === normalizedName,
  );

  return { name, linearUserId: matches.length === 1 ? matches[0]!.id : null };
}

export function isRequesterComment(
  comment: LinearComment,
  requester: Requester | null,
  botUserId: string,
): boolean {
  if (requester === null || comment.authorId === botUserId) return false;
  if (requester.linearUserId !== null && comment.authorId === requester.linearUserId) return true;
  return comment.authorId === null && normalizeName(comment.authorName) === normalizeName(requester.name);
}

export function requesterComments(
  comments: readonly LinearComment[],
  requester: Requester | null,
  botUserId: string,
  issueCreatedAt: string,
): readonly LinearComment[] {
  return comments
    .filter((comment) => comment.createdAt >= issueCreatedAt && isRequesterComment(comment, requester, botUserId))
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function computeInputHash(description: string, comments: readonly LinearComment[]): string {
  return createHash('sha256')
    .update(JSON.stringify([description, comments.map((comment) => [comment.id, comment.body])]))
    .digest('hex');
}

export function ticketInput(
  ticket: IssueWithComments,
  users: readonly LinearUser[],
  botUserId: string,
): { requester: Requester | null; requesterComments: readonly LinearComment[]; inputHash: string } {
  const requester = resolveRequester(parseRequesterName(ticket.issue.attachmentTitles), users);
  const comments = requesterComments(ticket.comments, requester, botUserId, ticket.issue.createdAt);

  return { requester, requesterComments: comments, inputHash: computeInputHash(ticket.issue.description, comments) };
}

export type TicketStatus = Verdict | 'handed_off';

export interface TriggerState {
  readonly status: TicketStatus;
  readonly mode: Mode;
  readonly inputHash: string | null;
  readonly commentIds: readonly string[];
}

export function shouldEvaluate(input: {
  state: TriggerState | null;
  mode: Mode;
  inTriage: boolean;
  botCanceled: boolean;
  inputHash: string;
  requesterComments: readonly LinearComment[];
}): boolean {
  const { state, mode, inTriage, botCanceled, inputHash, requesterComments } = input;
  if (!inTriage && !botCanceled) return false;
  if (state === null) return inTriage;
  if (state.status === 'pending_retry') return true;
  if (inTriage && state.mode !== mode) return true;
  if (inputHash === state.inputHash) return false;
  if (botCanceled && !inTriage) {
    return requesterComments.some((comment) => !state.commentIds.includes(comment.id) && isRecheck(comment.body));
  }
  if (mode === 'enforce' && state.status === 'accepted') {
    return requesterComments.some((comment) => !state.commentIds.includes(comment.id));
  }
  return true;
}
