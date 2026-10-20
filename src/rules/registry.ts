import type { Config } from '../config.js';
import type { Rule } from './types.js';
import { crmLinkRule } from './crm-link.js';
import { notesExistRule } from './notes-exist.js';
import { singleRequestRule } from './single-request.js';

export const ALL_RULES: readonly Rule[] = [singleRequestRule, crmLinkRule, notesExistRule];

export function enabledRules(config: Config): readonly Rule[] {
  return ALL_RULES.filter((rule) => config.rules.includes(rule.id));
}
