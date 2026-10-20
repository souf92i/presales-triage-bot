import { isDealContext, REASON } from './applicability.js';
import type { Rule } from './types.js';

export const notesExistRule: Rule = {
  id: 'notes-exist',
  applies: ({ facts }) => isDealContext(facts) ? { applies: true } : { applies: false, reason: REASON.noDeal },
  evaluate: ({ facts, config }) => ({
    outcome: facts.deal!.notes.length === 0
      ? { kind: 'deny', deny: { key: 'notes_exist.none', maxAgeMonths: config.noteMaxAgeMonths } }
      : { kind: 'pass' },
    annotations: [],
  }),
};
