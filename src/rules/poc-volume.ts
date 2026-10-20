import { isDealContext, isNewBusiness, REASON, requireAll } from './applicability.js';
import type { Rule } from './types.js';

export const pocVolumeRule: Rule = {
  id: 'poc-volume',
  applies: ({ facts }) => requireAll(
    [isDealContext(facts), REASON.noDeal],
    [isNewBusiness(facts), REASON.notNewBusiness],
    [facts.ticket.requestKind === 'poc', REASON.kind(facts.ticket.requestKind)],
  ),
  evaluate: ({ facts, config }) => {
    const volume = facts.deal!.qualification.volume;
    if (volume === null || volume.unclear) return { outcome: { kind: 'pass' }, annotations: [] };
    return {
      outcome: volume.max < config.minPocVolume
        ? { kind: 'deny', deny: { key: 'poc_volume.below_min', max: volume.max, min: config.minPocVolume } }
        : { kind: 'pass' },
      annotations: [],
    };
  },
};
