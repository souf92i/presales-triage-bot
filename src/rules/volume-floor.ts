import { isDealContext, isNewBusiness, REASON, requireAll } from './applicability.js';
import type { Rule } from './types.js';

export const volumeFloorRule: Rule = {
  id: 'volume-floor',
  applies: ({ facts }) => requireAll(
    [isDealContext(facts), REASON.noDeal],
    [isNewBusiness(facts), REASON.notNewBusiness],
  ),
  evaluate: ({ facts, config }) => {
    const volume = facts.deal!.qualification.volume;
    if (volume === null) return { outcome: { kind: 'pass' }, annotations: [] };
    if (volume.unclear) return { outcome: { kind: 'ask', ask: { key: 'volume_floor.unclear', quote: volume.evidence.quote } }, annotations: [] };
    return {
      outcome: volume.max < config.minDealVolume
        ? { kind: 'deny', deny: { key: 'volume_floor.below_min', max: volume.max, min: config.minDealVolume } }
        : { kind: 'pass' },
      annotations: [],
    };
  },
};
