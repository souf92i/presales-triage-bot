import type { DatabaseSync } from 'node:sqlite';

type WaitRow = { issue_id: string; expires_at: string };

export function createWaits(database: DatabaseSync) {
  const get = database.prepare('SELECT issue_id, expires_at FROM waits WHERE issue_id = $issueId');
  const create = database.prepare('INSERT INTO waits(issue_id, expires_at, created_at) VALUES($issueId, $expiresAt, $createdAt) ON CONFLICT(issue_id) DO NOTHING');
  const remove = database.prepare('DELETE FROM waits WHERE issue_id = $issueId');
  const expired = database.prepare('SELECT issue_id, expires_at FROM waits WHERE expires_at <= $nowIso ORDER BY expires_at, issue_id');
  return {
    get(issueId: string): { expiresAt: string } | null {
      const row = get.get({ $issueId: issueId }) as WaitRow | undefined;
      return row === undefined ? null : { expiresAt: row.expires_at };
    },
    createIfAbsent(issueId: string, expiresAt: string, createdAt: string): void {
      create.run({ $issueId: issueId, $expiresAt: expiresAt, $createdAt: createdAt });
    },
    delete(issueId: string): void {
      remove.run({ $issueId: issueId });
    },
    listExpired(nowIso: string): readonly { issueId: string; expiresAt: string }[] {
      return (expired.all({ $nowIso: nowIso }) as WaitRow[]).map((row) => ({ issueId: row.issue_id, expiresAt: row.expires_at }));
    },
  };
}
