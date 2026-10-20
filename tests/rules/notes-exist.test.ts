import { describe, expect, it } from 'vitest';

import { notesExistRule } from '../../src/rules/notes-exist.js';
import { baseFacts, ctx, noDeal, withDeal } from '../helpers/facts.js';

describe('notes-exist rule', () => {
  it('passes with base facts', () => expect(notesExistRule.evaluate(ctx(baseFacts())).outcome).toEqual({ kind: 'pass' }));
  it('denies with no notes', () => expect(notesExistRule.evaluate(ctx(withDeal(baseFacts(), { notes: [] }))).outcome).toEqual({ kind: 'deny', deny: { key: 'notes_exist.none', maxAgeMonths: 12 } }));
  it('skips on partner-only', () => expect(notesExistRule.applies(ctx(noDeal(baseFacts(), { kind: 'company', id: 'company-1' }, true)))).toEqual({ applies: false, reason: 'no valid opportunity' }));
  it('skips on invalid link', () => expect(notesExistRule.applies(ctx(noDeal(baseFacts(), { kind: 'invalid', raw: 'bad' }, null)))).toEqual({ applies: false, reason: 'no valid opportunity' }));
});
