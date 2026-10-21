import { readFileSync } from 'node:fs';

import { z } from 'zod';

import type { LinearUser } from './clients/types.js';
import { ConfigError } from './errors.js';
import { QUOTE_STATUSES, REQUEST_KINDS, type RequestKind, type TemplateLanguage } from './domain/types.js';
import { RULE_IDS } from './rules/types.js';
import { isValidTimeZone } from './time.js';

export interface PoolMember { email: string; active: boolean }
export interface RequestTypeMapping { formValue: string; kind: RequestKind; label: string }

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

const requestTypes: readonly RequestTypeMapping[] = [
  { formValue: 'Product demonstration', kind: 'demo', label: 'demo' },
  { formValue: 'Technical Workshop', kind: 'technical_discovery', label: 'technical discovery' },
  { formValue: 'Technical discovery', kind: 'technical_discovery', label: 'technical discovery' },
  { formValue: 'PoC', kind: 'poc', label: 'poc' },
  { formValue: 'RFx response (RFI/RFP)', kind: 'rfx', label: 'rfi rfp' },
  { formValue: 'Technical questionnaire', kind: 'rfx', label: 'rfi rfp' },
];

export const ConfigSchema = z.object({
  teamKey: z.string().default('PRE'),
  triageOwnerEmail: z.string().default('ela@evertrust.fr'),
  pool: z.array(z.object({ email: z.string(), active: z.boolean() })).refine(
    (pool) => pool.some((member) => member.active),
    'pool must have at least one active member',
  ).default(() => [
    { email: 'sbo@evertrust.fr', active: true },
    { email: 'vdo@evertrust.fr', active: true },
    { email: 'mob@evertrust.fr', active: false },
    { email: 'ela@evertrust.fr', active: true },
  ]),
  approvers: z.array(z.string()).default(() => ['Etienne', 'Mohamed', 'Soufiane', 'Vincent']),
  minDealVolume: z.number().int().positive().default(200),
  minPocVolume: z.number().int().positive().default(500),
  maxUnknownItems: z.number().int().nonnegative().default(2),
  waitDays: z.number().int().positive().default(7),
  handoffHours: z.number().int().positive().default(2),
  shortNoticeWorkingDays: z.number().int().positive().default(2),
  noteMaxAgeMonths: z.number().int().positive().default(12),
  discoveryMaxAgeMonths: z.number().int().positive().default(12),
  pollSeconds: z.number().int().positive().default(120),
  defaultTimezone: z.string().refine(isValidTimeZone, 'must be a valid IANA time zone').default('Europe/Paris'),
  enforce: z.boolean().default(false),
  overrideLabel: z.string().default('triage-override'),
  requestTypes: z.array(z.object({
    formValue: z.string(), kind: z.enum(REQUEST_KINDS), label: z.string(),
  })).default(() => [...requestTypes]),
  pocProducts: z.array(z.string()).default(() => []),
  pocQuoteLinePattern: z.string().refine(isValidPattern, 'must be a valid regular expression').default('\\bpoc\\b|proof of concept'),
  pocQuoteExcludedStatuses: z.array(z.enum(QUOTE_STATUSES)).default(
    (): (typeof QUOTE_STATUSES)[number][] => ['EXPIRED', 'REJECTED'],
  ),
  placeholderValues: z.array(z.string()).default(() => ['TBD', '?', '-', 'n/a', 'xxx', 'à définir', 'unknown', '']),
  llmModel: z.string().default('claude-sonnet-5-5'),
  llmEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  rules: z.array(z.enum(RULE_IDS)).default(() => [...RULE_IDS]),
}).strict();

export type Config = z.infer<typeof ConfigSchema>;

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

export function loadConfig(path: string, readFile: (path: string) => string = (filePath) => readFileSync(filePath, 'utf8')): Config {
  let contents: string;
  try {
    contents = readFile(path);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return defaultConfig();
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Cannot read config ${path}: ${message}`);
  }

  try {
    return ConfigSchema.parse(JSON.parse(contents));
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ConfigError(`Invalid config: ${z.prettifyError(error)}`);
    }
    if (error instanceof SyntaxError) {
      throw new ConfigError(`Invalid config: ${error.message}`);
    }
    throw error;
  }
}

export function memberName(member: PoolMember, users: readonly LinearUser[]): string {
  const user = users.find((candidate) => candidate.email.toLowerCase() === member.email.toLowerCase());
  return user?.name.split(' ')[0] ?? member.email.split('@')[0] ?? member.email;
}

export function managedLabels(config: Config): readonly string[] {
  return [...new Set(config.requestTypes.map((requestType) => requestType.label.toLowerCase()))];
}

export function templateLanguage(language: string): TemplateLanguage {
  return language === 'fr' ? 'fr' : 'en';
}

export interface Env {
  LINEAR_CLIENT_ID: string; LINEAR_CLIENT_SECRET: string; TWENTY_BASE_URL: string; TWENTY_API_KEY: string;
  GRAPH_TENANT_ID: string; GRAPH_CLIENT_ID: string; GRAPH_CLIENT_SECRET: string; ANTHROPIC_API_KEY: string;
  ALERT_WEBHOOK_URL: string | undefined; CONFIG_PATH: string; DB_PATH: string;
}

const EnvSchema = z.object({
  LINEAR_CLIENT_ID: z.string().min(1),
  LINEAR_CLIENT_SECRET: z.string().min(1),
  TWENTY_BASE_URL: z.string().min(1),
  TWENTY_API_KEY: z.string().min(1),
  GRAPH_TENANT_ID: z.string().min(1),
  GRAPH_CLIENT_ID: z.string().min(1),
  GRAPH_CLIENT_SECRET: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ALERT_WEBHOOK_URL: z.string().optional(),
  CONFIG_PATH: z.string().default('./config.json'),
  DB_PATH: z.string().default('./data/triage.sqlite'),
});

export function loadEnv(env: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const invalid = result.error.issues.map((issue) => issue.path[0]).join(', ');
    throw new ConfigError(`Invalid environment variables: ${invalid}`);
  }

  return { ...result.data, ALERT_WEBHOOK_URL: result.data.ALERT_WEBHOOK_URL };
}
