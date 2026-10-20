import type { CrmLink, Target } from './domain/types.js';

export const OPPORTUNITY_URL_SHAPE = 'https://crm.evertrust.internal/object/opportunity/<id>';
export const COMPANY_URL_SHAPE = 'https://crm.evertrust.internal/object/company/<id>';

const CRM_LINK_PATTERN = /^https:\/\/crm\.evertrust\.internal\/object\/(opportunity|company)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\/?#].*)?$/i;

export function isPartnerOnly(target: readonly Target[]): boolean {
  return target.length === 1 && target[0] === 'Partner';
}

export function resolveCrmLink(raw: string, target: readonly Target[]): CrmLink {
  const match = CRM_LINK_PATTERN.exec(raw.trim());
  if (match === null) {
    return { kind: 'invalid', raw };
  }

  const kind = match[1];
  const id = match[2];
  if (kind === undefined || id === undefined) {
    return { kind: 'invalid', raw };
  }

  if (kind === 'opportunity') {
    return { kind: 'opportunity', id: id.toLowerCase() };
  }

  if (kind === 'company' && isPartnerOnly(target)) {
    return { kind: 'company', id: id.toLowerCase() };
  }

  return { kind: 'invalid', raw };
}
