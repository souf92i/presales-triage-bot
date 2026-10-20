import { describe, expect, it } from 'vitest';

import {
  defaultConfig,
  loadConfig,
  loadEnv,
  managedLabels,
  memberName,
  templateLanguage,
} from '../src/config.js';
import { ConfigError } from '../src/errors.js';
import { RULE_IDS } from '../src/rules/types.js';

describe('config', () => {
  it('applies every spec default', () => {
    const config = defaultConfig();

    expect(config).toMatchObject({
      teamKey: 'PRE',
      triageOwnerEmail: 'ela@evertrust.fr',
      minDealVolume: 200,
      minPocVolume: 500,
      maxUnknownItems: 2,
      waitDays: 7,
      handoffHours: 2,
      shortNoticeWorkingDays: 2,
      noteMaxAgeMonths: 12,
      discoveryMaxAgeMonths: 12,
      pollSeconds: 120,
      defaultTimezone: 'Europe/Paris',
      enforce: false,
      overrideLabel: 'triage-override',
      llmModel: 'claude-sonnet-5-5',
      llmEffort: 'medium',
      pocProducts: [],
      pocQuoteLinePattern: '\\bpoc\\b|proof of concept',
    });
    expect(config.pocQuoteExcludedStatuses).toEqual(['EXPIRED', 'REJECTED']);
    expect(config.placeholderValues).toEqual(['TBD', '?', '-', 'n/a', 'xxx', 'à définir', 'unknown', '']);
    expect(config.approvers).toEqual(['Etienne', 'Mohamed', 'Soufiane', 'Vincent']);
    expect(config.pool.map((member) => [member.email, member.active])).toEqual([
      ['sbo@evertrust.fr', true],
      ['vdo@evertrust.fr', true],
      ['mob@evertrust.fr', false],
      ['ela@evertrust.fr', true],
    ]);
    expect(config.rules).toEqual(RULE_IDS);
    expect(managedLabels(config)).toEqual(['demo', 'technical discovery', 'poc', 'rfi rfp']);
  });

  it.each(['{"pollSecond":5}', '{"defaultTimezone":"Mars/Base"}', '{"pocQuoteLinePattern":"("}'])(
    'rejects invalid configuration %s with ConfigError',
    (contents) => {
      expect(() => loadConfig('config.json', () => contents)).toThrow(ConfigError);
    },
  );

  it('returns defaults when the config file is missing', () => {
    expect(loadConfig('missing.json', () => {
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    })).toEqual(defaultConfig());
  });

  it('memberName returns the email local part', () => {
    expect(memberName({ email: 'sbo@evertrust.fr', active: true })).toBe('sbo');
  });

  it('templateLanguage maps fr and falls back to en', () => {
    expect(templateLanguage('fr')).toBe('fr');
    expect(templateLanguage('en')).toBe('en');
    expect(templateLanguage('de')).toBe('en');
  });

  it('loadEnv lists every missing variable at once', () => {
    expect(() => loadEnv({ TWENTY_API_KEY: 'k' })).toThrow(
      /LINEAR_CLIENT_ID.*LINEAR_CLIENT_SECRET.*TWENTY_BASE_URL/s,
    );
  });

  it('loadEnv applies path defaults and keeps the alert webhook optional', () => {
    const env = loadEnv({
      LINEAR_CLIENT_ID: 'linear-id',
      LINEAR_CLIENT_SECRET: 'linear-secret',
      TWENTY_BASE_URL: 'https://twenty.example',
      TWENTY_API_KEY: 'twenty-key',
      GRAPH_TENANT_ID: 'tenant',
      GRAPH_CLIENT_ID: 'graph-id',
      GRAPH_CLIENT_SECRET: 'graph-secret',
      ANTHROPIC_API_KEY: 'anthropic-key',
    });

    expect(env).toMatchObject({
      CONFIG_PATH: './config.json',
      DB_PATH: './data/triage.sqlite',
      ALERT_WEBHOOK_URL: undefined,
    });
  });
});
