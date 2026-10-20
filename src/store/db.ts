import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  if (path !== ':memory:') database.exec('PRAGMA journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS tickets(issue_id TEXT PRIMARY KEY, identifier TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL,
      input_hash TEXT, comment_ids TEXT NOT NULL DEFAULT '[]', last_ask_keys TEXT NOT NULL DEFAULT '[]',
      language TEXT NOT NULL DEFAULT 'en', started_from TEXT NOT NULL DEFAULT 'triage', first_failure_at TEXT, last_error TEXT, last_evaluated_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS waits(issue_id TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ticket_index(issue_id TEXT PRIMARY KEY, identifier TEXT NOT NULL, number INTEGER NOT NULL, company_id TEXT NOT NULL,
      request_kind TEXT, state_type TEXT NOT NULL, assignee_email TEXT, assignee_name TEXT,
      created_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ticket_index_company ON ticket_index(company_id);
    CREATE TABLE IF NOT EXISTS outages(dependency TEXT PRIMARY KEY, started_at TEXT NOT NULL, last_error TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id TEXT NOT NULL, at TEXT NOT NULL, verdict TEXT NOT NULL, record TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cursors(name TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return database;
}
