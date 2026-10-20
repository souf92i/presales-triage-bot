import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditRecord, IndexEntry, TicketRecord } from '../src/store/store.js';
import { openStore } from '../src/store/store.js';

const stores: { close(): void }[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
});

function store() {
  const opened = openStore(':memory:');
  stores.push(opened);
  return opened;
}

function ticket(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    issueId: 'issue-1', identifier: 'PRE-1', status: 'waiting', mode: 'shadow', inputHash: 'hash',
    commentIds: ['comment-1'], lastAskKeys: ['slot.incomplete'], language: 'en', startedFrom: 'triage',
    firstFailureAt: null, lastError: null, lastEvaluatedAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z', ...overrides,
  };
}

function indexEntry(overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    issueId: 'issue-1', identifier: 'PRE-1', number: 1, companyId: 'company-1', requestKind: 'technical_discovery',
    stateType: 'completed', assigneeEmail: 'owner@example.com', assigneeName: 'Owner',
    createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T12:00:00.000Z',
    updatedAt: '2026-03-01T12:00:00.000Z', ...overrides,
  };
}

describe('SQLite store', () => {
  it('round-trips a ticket record with hash, comment ids and ask keys', () => {
    const opened = store();
    const record = ticket();

    opened.tickets.upsert(record);

    expect(opened.tickets.get(record.issueId)).toEqual(record);
  });

  it('listByStatus filters', () => {
    const opened = store();
    opened.tickets.upsert(ticket());
    opened.tickets.upsert(ticket({ issueId: 'issue-2', identifier: 'PRE-2', status: 'accepted' }));

    expect(opened.tickets.listByStatus(['waiting'])).toEqual([ticket()]);
  });

  it('createIfAbsent never extends a wait', () => {
    const opened = store();
    opened.waits.createIfAbsent('issue-1', '2026-10-27T12:00:00.000Z', '2026-10-20T12:00:00.000Z');
    opened.waits.createIfAbsent('issue-1', '2026-11-03T12:00:00.000Z', '2026-10-21T12:00:00.000Z');

    expect(opened.waits.get('issue-1')).toEqual({ expiresAt: '2026-10-27T12:00:00.000Z' });
  });

  it('listExpired returns waits at or before now', () => {
    const opened = store();
    opened.waits.createIfAbsent('before', '2026-10-20T11:59:59.999Z', '2026-10-20T10:00:00.000Z');
    opened.waits.createIfAbsent('at', '2026-10-20T12:00:00.000Z', '2026-10-20T10:00:00.000Z');
    opened.waits.createIfAbsent('after', '2026-10-20T12:00:00.001Z', '2026-10-20T10:00:00.000Z');

    expect(opened.waits.listExpired('2026-10-20T12:00:00.000Z')).toEqual([
      { issueId: 'before', expiresAt: '2026-10-20T11:59:59.999Z' },
      { issueId: 'at', expiresAt: '2026-10-20T12:00:00.000Z' },
    ]);
  });

  it('hasCompletedTicket counts only completed tickets of the kind in the window', () => {
    const opened = store();
    opened.index.upsert(indexEntry());
    opened.index.upsert(indexEntry({ issueId: 'started', stateType: 'started' }));
    opened.index.upsert(indexEntry({ issueId: 'canceled', stateType: 'canceled' }));
    opened.index.upsert(indexEntry({ issueId: 'old', completedAt: '2025-01-01T12:00:00.000Z' }));

    expect(opened.index.hasCompletedTicket('company-1', 'technical_discovery', '2025-10-20T00:00:00.000Z', 'other')).toBe(true);
    expect(opened.index.hasCompletedTicket('company-1', 'technical_discovery', '2025-10-20T00:00:00.000Z', 'issue-1')).toBe(false);
  });

  it('latestWorkedTicket skips unassigned and non-worked tickets and breaks ties by number', () => {
    const opened = store();
    opened.index.upsert(indexEntry({ issueId: 'pre-120', identifier: 'PRE-120', number: 120 }));
    opened.index.upsert(indexEntry({ issueId: 'pre-121', identifier: 'PRE-121', number: 121 }));
    opened.index.upsert(indexEntry({ issueId: 'backlog', createdAt: '2026-04-01T10:00:00.000Z', stateType: 'backlog' }));
    opened.index.upsert(indexEntry({ issueId: 'unassigned', createdAt: '2026-04-02T10:00:00.000Z', stateType: 'started', assigneeEmail: null, assigneeName: null }));

    expect(opened.index.latestWorkedTicket('company-1', 'other')).toEqual(indexEntry({ issueId: 'pre-121', identifier: 'PRE-121', number: 121 }));
  });

  it('isBackfillComplete follows the cursor', () => {
    const opened = store();
    expect(opened.index.isBackfillComplete()).toBe(false);
    opened.cursors.set('backfill_complete', 'true');
    expect(opened.index.isBackfillComplete()).toBe(true);
  });

  it('outages open once and close once', () => {
    const opened = store();
    expect(opened.outages.open('linear', '2026-10-20T12:00:00.000Z', 'down')).toBe(true);
    expect(opened.outages.open('linear', '2026-10-20T13:00:00.000Z', 'still down')).toBe(false);
    expect(opened.outages.close('linear')).toBe(true);
    expect(opened.outages.close('linear')).toBe(false);
  });

  it('audit round-trip', () => {
    const opened = store();
    const record: AuditRecord = {
      issueId: 'issue-1', identifier: 'PRE-1', at: '2026-10-20T12:00:00.000Z', mode: 'shadow', inputHash: 'hash',
      model: null, rawLlm: null, facts: null, results: [], annotations: [], verdict: 'handed_off', actions: ['comment'], error: null,
    };

    opened.audit.insert(record);

    expect(opened.audit.listForIssue('issue-1')).toEqual([record]);
  });

  it('openStore on a file path creates the directory and persists', () => {
    const directory = mkdtempSync(join(tmpdir(), 'triage-'));
    const path = join(directory, 'nested', 'triage.sqlite');
    const first = openStore(path);
    first.cursors.set('index_updated_at', '2026-10-20T12:00:00.000Z');
    first.close();
    const second = openStore(path);

    expect(second.cursors.get('index_updated_at')).toBe('2026-10-20T12:00:00.000Z');
    second.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
