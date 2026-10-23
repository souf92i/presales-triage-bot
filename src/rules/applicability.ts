import type { Facts } from '../domain/types.js';
import type { Applicability } from './types.js';

export const REASON = {
  noDeal: 'no valid opportunity',
  notNewBusiness: 'deal type is not NEWBUSINESS',
  kind: (kind: string) => `not applicable to ${kind}`,
} as const;

export function isDealContext(facts: Facts): boolean {
  return facts.deal !== null;
}

export function isNewBusiness(facts: Facts): boolean {
  return facts.deal?.dealType === 'NEWBUSINESS';
}

export function isNotRfx(facts: Facts): boolean {
  return facts.ticket.requestKind !== 'rfx';
}

export function requireAll(...checks: readonly (readonly [boolean, string])[]): Applicability {
  const failed = checks.find(([passes]) => !passes);
  return failed === undefined ? { applies: true } : { applies: false, reason: failed[1] };
}
