import type { DatabaseSync } from 'node:sqlite';
import type { RequestKind } from '../domain/types.js';

export interface IndexEntry {
  readonly issueId: string;
  readonly identifier: string;
  readonly number: number;
  readonly companyId: string;
  readonly requestKind: RequestKind | null;
  readonly stateType: string;
  readonly assigneeEmail: string | null;
  readonly assigneeName: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly updatedAt: string;
}

type IndexRow = { issue_id: string; identifier: string; number: number; company_id: string; request_kind: RequestKind | null; state_type: string; assignee_email: string | null; assignee_name: string | null; created_at: string; completed_at: string | null; updated_at: string };

function entry(row: IndexRow): IndexEntry {
  return { issueId: row.issue_id, identifier: row.identifier, number: row.number, companyId: row.company_id, requestKind: row.request_kind, stateType: row.state_type, assigneeEmail: row.assignee_email, assigneeName: row.assignee_name, createdAt: row.created_at, completedAt: row.completed_at, updatedAt: row.updated_at };
}

export interface HistoryReader {
  isBackfillComplete(): boolean;
  hasCompletedTicket(companyId: string, kind: RequestKind, completedSinceIso: string, excludeIssueId: string): boolean;
  latestWorkedTicket(companyId: string, excludeIssueId: string): IndexEntry | null;
}

export function createIndex(database: DatabaseSync, isBackfillComplete: () => boolean) {
  const upsert = database.prepare(`INSERT INTO ticket_index(issue_id, identifier, number, company_id, request_kind, state_type, assignee_email, assignee_name, created_at, completed_at, updated_at)
    VALUES($issueId, $identifier, $number, $companyId, $requestKind, $stateType, $assigneeEmail, $assigneeName, $createdAt, $completedAt, $updatedAt)
    ON CONFLICT(issue_id) DO UPDATE SET identifier = excluded.identifier, number = excluded.number, company_id = excluded.company_id, request_kind = excluded.request_kind, state_type = excluded.state_type, assignee_email = excluded.assignee_email, assignee_name = excluded.assignee_name, created_at = excluded.created_at, completed_at = excluded.completed_at, updated_at = excluded.updated_at`);
  const remove = database.prepare('DELETE FROM ticket_index WHERE issue_id = $issueId');
  const completed = database.prepare("SELECT 1 FROM ticket_index WHERE company_id = $companyId AND state_type = 'completed' AND request_kind = $kind AND completed_at >= $completedSinceIso AND issue_id <> $excludeIssueId LIMIT 1");
  const latest = database.prepare("SELECT * FROM ticket_index WHERE company_id = $companyId AND state_type IN ('unstarted', 'started', 'completed') AND assignee_email IS NOT NULL AND issue_id <> $excludeIssueId ORDER BY created_at DESC, number DESC LIMIT 1");
  return {
    isBackfillComplete,
    hasCompletedTicket(companyId: string, kind: RequestKind, completedSinceIso: string, excludeIssueId: string): boolean {
      return completed.get({ $companyId: companyId, $kind: kind, $completedSinceIso: completedSinceIso, $excludeIssueId: excludeIssueId }) !== undefined;
    },
    latestWorkedTicket(companyId: string, excludeIssueId: string): IndexEntry | null {
      const row = latest.get({ $companyId: companyId, $excludeIssueId: excludeIssueId }) as IndexRow | undefined;
      return row === undefined ? null : entry(row);
    },
    upsert(value: IndexEntry): void {
      upsert.run({ $issueId: value.issueId, $identifier: value.identifier, $number: value.number, $companyId: value.companyId, $requestKind: value.requestKind, $stateType: value.stateType, $assigneeEmail: value.assigneeEmail, $assigneeName: value.assigneeName, $createdAt: value.createdAt, $completedAt: value.completedAt, $updatedAt: value.updatedAt });
    },
    delete(issueId: string): void {
      remove.run({ $issueId: issueId });
    },
  };
}
