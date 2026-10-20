import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

it('runs on Node 26 or later', () => {
  expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(26);
});

it('has a working node:sqlite', () => {
  const db = new DatabaseSync(':memory:');
  expect(db.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 });
  db.close();
});
