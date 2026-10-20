import type { Config } from '../config.js';
import type { Rule } from './types.js';
import { crmLinkRule } from './crm-link.js';
import { discoveryFirstRule } from './discovery-first.js';
import { notesExistRule } from './notes-exist.js';
import { pocPaidRule } from './poc-paid.js';
import { pocVolumeRule } from './poc-volume.js';
import { qualificationRule } from './qualification.js';
import { singleRequestRule } from './single-request.js';
import { slotRule } from './slot.js';
import { volumeFloorRule } from './volume-floor.js';

export const ALL_RULES: readonly Rule[] = [singleRequestRule, crmLinkRule, notesExistRule, qualificationRule, volumeFloorRule, discoveryFirstRule, slotRule, pocVolumeRule, pocPaidRule];

export function enabledRules(config: Config): readonly Rule[] {
  return ALL_RULES.filter((rule) => config.rules.includes(rule.id));
}
