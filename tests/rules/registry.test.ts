import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../../src/config.js';
import { ALL_RULES, enabledRules } from '../../src/rules/registry.js';

describe('rule registry', () => {
  it('has the present rule ids in RULE_IDS order', () => expect(ALL_RULES.map((rule) => rule.id)).toEqual(['single-request', 'crm-link', 'rfx-deal', 'notes-exist', 'qualification', 'volume-floor', 'discovery-first', 'slot', 'poc-volume', 'poc-paid']));
  it('drops ids missing from config.rules', () => expect(enabledRules({ ...defaultConfig(), rules: ['crm-link'] }).map((rule) => rule.id)).toEqual(['crm-link']));
});
