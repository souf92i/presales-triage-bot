import type { DatabaseSync } from 'node:sqlite';
import type { TicketStatus, TriggerState } from '../triggers.js';
import type { AskKey } from '../rules/types.js';

export interface TicketRecord extends TriggerState {
  readonly issueId: string;
  readonly identifier: string;
  readonly lastAskKeys: readonly AskKey[];
  readonly language: string;
  readonly startedFrom: 'triage' | 'canceled';
  readonly firstFailureAt: string | null;
  readonly lastError: string | null;
  readonly lastEvaluatedAt: string | null;
  readonly updatedAt: string;
}

type TicketRow = { issue_id: string; identifier: string; status: TicketStatus; mode: TicketRecord['mode']; input_hash: string | null; comment_ids: string; last_ask_keys: string; language: string; started_from: TicketRecord['startedFrom']; first_failure_at: string | null; last_error: string | null; last_evaluated_at: string | null; updated_at: string };

function record(row: TicketRow): TicketRecord {
  return {
    issueId: row.issue_id, identifier: row.identifier, status: row.status, mode: row.mode, inputHash: row.input_hash,
    commentIds: JSON.parse(row.comment_ids) as readonly string[], lastAskKeys: JSON.parse(row.last_ask_keys) as readonly AskKey[],
    language: row.language, startedFrom: row.started_from, firstFailureAt: row.first_failure_at, lastError: row.last_error,
    lastEvaluatedAt: row.last_evaluated_at, updatedAt: row.updated_at,
  };
}

export function createTickets(database: DatabaseSync) {
  const get = database.prepare('SELECT * FROM tickets WHERE issue_id = $issueId');
  const upsert = database.prepare(`INSERT INTO tickets(issue_id, identifier, status, mode, input_hash, comment_ids, last_ask_keys, language, started_from, first_failure_at, last_error, last_evaluated_at, updated_at)
    VALUES($issueId, $identifier, $status, $mode, $inputHash, $commentIds, $lastAskKeys, $language, $startedFrom, $firstFailureAt, $lastError, $lastEvaluatedAt, $updatedAt)
    ON CONFLICT(issue_id) DO UPDATE SET identifier = excluded.identifier, status = excluded.status, mode = excluded.mode, input_hash = excluded.input_hash, comment_ids = excluded.comment_ids, last_ask_keys = excluded.last_ask_keys, language = excluded.language, started_from = excluded.started_from, first_failure_at = excluded.first_failure_at, last_error = excluded.last_error, last_evaluated_at = excluded.last_evaluated_at, updated_at = excluded.updated_at`);
  const listByStatus = database.prepare('SELECT * FROM tickets WHERE status IN (SELECT value FROM json_each($statuses)) ORDER BY issue_id');

  return {
    get(issueId: string): TicketRecord | null {
      const row = get.get({ $issueId: issueId }) as TicketRow | undefined;
      return row === undefined ? null : record(row);
    },
    upsert(value: TicketRecord): void {
      upsert.run({ $issueId: value.issueId, $identifier: value.identifier, $status: value.status, $mode: value.mode, $inputHash: value.inputHash, $commentIds: JSON.stringify(value.commentIds), $lastAskKeys: JSON.stringify(value.lastAskKeys), $language: value.language, $startedFrom: value.startedFrom, $firstFailureAt: value.firstFailureAt, $lastError: value.lastError, $lastEvaluatedAt: value.lastEvaluatedAt, $updatedAt: value.updatedAt });
    },
    listByStatus(statuses: readonly TicketStatus[]): readonly TicketRecord[] {
      return (listByStatus.all({ $statuses: JSON.stringify(statuses) }) as TicketRow[]).map(record);
    },
  };
}
