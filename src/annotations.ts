import type { Facts } from './domain/types.js';
import type { Annotation } from './rules/types.js';

export function ownerAnnotation(facts: Facts): Annotation | null {
  const owner = facts.history?.owner;
  if (owner === null || owner === undefined) return null;
  if (!owner.activeInPool) return { key: 'owner.away', owner: owner.name, ticket: owner.ticketIdentifier };

  return {
    key: 'owner.active',
    owner: owner.name,
    ticket: owner.ticketIdentifier,
    freeOnSlot: facts.calendar?.members.find((member) => member.email.toLowerCase() === owner.email.toLowerCase())?.free ?? null,
  };
}

export function partnerAnnotation(facts: Facts): Annotation | null {
  if (
    facts.deal === null
    || facts.ticket.form.target.includes('Partner')
    || facts.deal.opportunity.hasActualPartner
    || facts.deal.noteFacts.partnerNamed !== null
  ) return null;

  return { key: 'partner.caution', indirect: facts.deal.opportunity.salesChannel === 'INDIRECT' };
}

export function hasOwnerAnnotation(annotations: readonly Annotation[]): boolean {
  return annotations.some((annotation) => annotation.key === 'owner.active' || annotation.key === 'owner.away');
}
