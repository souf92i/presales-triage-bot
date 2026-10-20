import type { Dependency } from '../errors.js';
import type { TicketStatus } from '../triggers.js';
import { createAudit, type AuditRecord } from './audit.js';
import { createCursors, type CursorName } from './cursors.js';
import { openDatabase } from './db.js';
import { createIndex, type HistoryReader, type IndexEntry } from './index-repo.js';
import { createOutages } from './outages.js';
import { createTickets, type TicketRecord } from './tickets.js';
import { createWaits } from './waits.js';

export type { AuditRecord } from './audit.js';
export type { CursorName } from './cursors.js';
export type { HistoryReader, IndexEntry } from './index-repo.js';
export type { TicketRecord } from './tickets.js';

export interface Store {
  readonly tickets: { get(issueId: string): TicketRecord | null; upsert(record: TicketRecord): void; listByStatus(statuses: readonly TicketStatus[]): readonly TicketRecord[] };
  readonly waits: { get(issueId: string): { expiresAt: string } | null; createIfAbsent(issueId: string, expiresAt: string, createdAt: string): void; delete(issueId: string): void; listExpired(nowIso: string): readonly { issueId: string; expiresAt: string }[] };
  readonly index: HistoryReader & { upsert(entry: IndexEntry): void; delete(issueId: string): void };
  readonly outages: { open(dependency: Dependency, atIso: string, error: string): boolean; close(dependency: Dependency): boolean };
  readonly audit: { insert(record: AuditRecord): void; listForIssue(issueId: string): readonly AuditRecord[] };
  readonly cursors: { get(name: CursorName): string | null; set(name: CursorName, value: string): void };
  close(): void;
}

export function openStore(path: string): Store {
  const database = openDatabase(path);
  const cursors = createCursors(database);
  return {
    tickets: createTickets(database),
    waits: createWaits(database),
    index: createIndex(database, () => cursors.get('backfill_complete') === 'true'),
    outages: createOutages(database),
    audit: createAudit(database),
    cursors,
    close(): void {
      database.close();
    },
  };
}
