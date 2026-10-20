import type { DatabaseSync } from 'node:sqlite';
import type { Facts, Mode, RawLlm, Verdict } from '../domain/types.js';
import type { Annotation, RuleResult } from '../rules/types.js';

export interface AuditRecord {
  readonly issueId: string;
  readonly identifier: string;
  readonly at: string;
  readonly mode: Mode;
  readonly inputHash: string;
  readonly model: string | null;
  readonly rawLlm: RawLlm | null;
  readonly facts: Facts | null;
  readonly results: readonly RuleResult[];
  readonly annotations: readonly Annotation[];
  readonly verdict: Verdict | 'handed_off';
  readonly actions: readonly string[];
  readonly error: string | null;
}

type AuditRow = { record: string };

export function createAudit(database: DatabaseSync) {
  const insert = database.prepare('INSERT INTO audit(issue_id, at, verdict, record) VALUES($issueId, $at, $verdict, $record)');
  const list = database.prepare('SELECT record FROM audit WHERE issue_id = $issueId ORDER BY id');
  return {
    insert(record: AuditRecord): void {
      insert.run({ $issueId: record.issueId, $at: record.at, $verdict: record.verdict, $record: JSON.stringify(record) });
    },
    listForIssue(issueId: string): readonly AuditRecord[] {
      return (list.all({ $issueId: issueId }) as AuditRow[]).map((row) => JSON.parse(row.record) as AuditRecord);
    },
  };
}
