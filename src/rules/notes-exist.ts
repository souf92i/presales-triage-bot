import { isDealContext, isNotRfx, REASON, requireAll } from './applicability.js';
import type { Rule } from './types.js';

export const notesExistRule: Rule = {
  id: 'notes-exist',
  applies: ({ facts }) => requireAll(
    [isDealContext(facts), REASON.noDeal],
    [isNotRfx(facts), REASON.kind(facts.ticket.requestKind)],
  ),
  evaluate: ({ facts, config }) => ({
    outcome: facts.deal!.notes.length === 0
      ? { kind: 'deny', deny: { key: 'notes_exist.none', maxAgeMonths: config.noteMaxAgeMonths } }
      : { kind: 'pass' },
    annotations: [],
  }),
};
