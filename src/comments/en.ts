import { COMPANY_URL_SHAPE, OPPORTUNITY_URL_SHAPE } from '../crm-link.js';
import type { Annotation, Ask, Deny } from '../rules/types.js';
import { assertNever, joinList, truncate, type DenyText, type Templates } from './templates.js';

const kindNames = { demo: 'Product demonstration', technical_discovery: 'Technical discovery', poc: 'PoC', rfx: 'RFx response' } as const;
const qualification = {
  volume: ['Volume (number of certificates managed by the CLM)', 'add it in a Twenty note on the opportunity'],
  hosting: ['Hosting', 'fill the Hosting field of the opportunity in Twenty'],
  solution: ['Desired solution', 'fill the Besoin field or add a Twenty note'],
  decisionMaker: ['Decision maker', 'fill the Décisionnaires field of the opportunity in Twenty'],
  budget: ['Budget', 'add it in a Twenty note'],
  timeline: ['Project timeline', 'add it in a Twenty note'],
  currentPki: ['Current PKI', 'fill the Technical information field or add a Twenty note'],
  useCases: ['Use cases', 'fill the Besoin field or add a Twenty note'],
  clmDriver: ['CLM driver (why a CLM now)', 'add it in a Twenty note'],
} as const;

function itemLine(item: Extract<Deny, { key: 'qualification.missing' }>['items'][number]): string {
  const [label, fix] = qualification[item.id];
  return item.status === 'declared_unobtainable' ? `${label}: declared unobtainable, ${fix}` : `${label}: missing, ${fix}`;
}

function deny(denyValue: Deny): DenyText {
  switch (denyValue.key) {
    case 'single_request.multiple': return { policy: 'one request per ticket. Please create a separate ask for each additional request below.', items: denyValue.items.map((item) => `Additional ${kindNames[item.kind]}: "${item.quote}"`) };
    case 'crm_link.invalid': return { policy: 'each ask needs a link to its Twenty opportunity.', items: [denyValue.raw === '' ? 'No link was given.' : `The link given ("${truncate(denyValue.raw)}") is not a Twenty opportunity link.`, `Edit the ticket description and paste the opportunity URL in this shape: ${OPPORTUNITY_URL_SHAPE}`, ...(denyValue.partnerOnly ? [`For a partner-only ask, a company link is also accepted: ${COMPANY_URL_SHAPE}`] : [])] };
    case 'crm_link.not_found': return { policy: 'each ask needs a link to an existing Twenty record.', items: [`No Twenty ${denyValue.recordKind} with id ${denyValue.id} exists. Check the link in the ticket description.`] };
    case 'rfx_deal.not_rfx': return { policy: 'an RFx ticket needs a Twenty opportunity for that RFI, RFQ or RFP.', items: ['The linked opportunity is not marked RFX in its type of negotiation. Create the opportunity of the RFx in Twenty, or set its type of negotiation to RFX, then link it in the ticket description.'] };
    case 'notes_exist.none': return { policy: 'the opportunity needs at least one qualification note.', items: [`Twenty has no note on the opportunity and no note on its company from the last ${denyValue.maxAgeMonths} months. Add a note on the opportunity in Twenty.`] };
    case 'qualification.missing': return { policy: `a new business opportunity needs a known volume and decision maker, and at most ${denyValue.maxUnknown} other unknown qualification items.`, items: [...denyValue.items.map(itemLine), ...(denyValue.dataQualityMissing === '' ? [] : [`Twenty data quality check: ${denyValue.dataQualityMissing}. Complete these fields in Twenty.`])] };
    case 'volume_floor.below_min': return { policy: `new business deals under ${denyValue.min} certificates are handled by partners.`, items: [`The volume recorded is ${denyValue.max} certificates. If this is wrong, correct it in a Twenty note on the opportunity.`] };
    case 'discovery_first.missing': return { policy: `${kindNames[denyValue.kind]} requests for a new business deal need a technical discovery first.`, items: [`No completed technical discovery for this customer in the last ${denyValue.maxAgeMonths} months, and no Twenty note says one took place. If one took place, add a Twenty note that says so.`, ...(denyValue.kind === 'demo' ? ['Please create a Technical discovery ask instead.'] : [])] };
    case 'slot.rep_declined_move': return { policy: 'a meeting needs an available presales engineer.', items: ['Nobody is available on the requested slot and the date cannot move.'] };
    case 'slot.no_slot': return { policy: 'a meeting request needs a target date and time.', items: ['The ticket gives no slot and does not say that slots were offered to the customer. Reply in this thread with the date, start time and end time.'] };
    case 'poc_volume.below_min': return { policy: `a PoC needs a volume of at least ${denyValue.min} certificates.`, items: [`The volume recorded is ${denyValue.max} certificates. If this is wrong, correct it in a Twenty note on the opportunity.`] };
    case 'poc_paid.no_quote': return { policy: 'PoCs are paid unless an approver agreed otherwise.', items: ['No Twenty quote with a PoC line is linked to the opportunity. Link the PoC quote to the opportunity in Twenty.', 'If an approver agreed to a free PoC, add a Twenty note that quotes the agreement and names the approver.'] };
    case 'wait.no_answer': return { policy: 'questions must be answered within the waiting period.', items: ['No answer from the requester was received.'] };
    default: return assertNever(denyValue);
  }
}

function ask(askValue: Ask): string {
  switch (askValue.key) {
    case 'volume_floor.unclear': return `How many certificates will the CLM manage? The ticket says "${askValue.quote}", which does not give the number of certificates managed by the CLM.`;
    case 'slot.incomplete': {
      const names = { date: 'date', start: 'start time', end: 'end time' } as const;
      return askValue.missing.length === 0 ? 'The meeting slot is not clear. Please give the exact date, start time and end time.' : `Please give the ${joinList(askValue.missing.map((part) => names[part]), ' and ')} of the meeting.`;
    }
    case 'slot.past': return `The meeting slot (${askValue.date} ${askValue.start}) is in the past. Please give a future date and time.`;
    case 'slot.nobody_available': return `Nobody in the presales team is available on ${askValue.date} from ${askValue.start} to ${askValue.end} (${askValue.timezone}). Can the date move?`;
    default: return assertNever(askValue);
  }
}

function annotation(annotationValue: Annotation): string {
  switch (annotationValue.key) {
    case 'slot.timezone_assumed': return `No time zone was given; times are read as ${annotationValue.timezone}.`;
    case 'slot.short_notice': return `Short notice: fewer than ${annotationValue.workingDays} full working days before the meeting. Please confirm the slot cannot move.`;
    case 'slot.onsite': return 'On site meeting: travel was not checked. The triage owner picks the presales engineer.';
    case 'slot.free_members': return `Available on the slot: ${annotationValue.members.join(', ')}.`;
    case 'slot.check_later': return 'Slots were offered to the customer. Availability will be checked once a date is known.';
    case 'owner.active': {
      if (annotationValue.freeOnSlot === true) return `This customer is followed by ${annotationValue.owner} (see ${annotationValue.ticket}), please assign accordingly. ${annotationValue.owner} is available on the slot.`;
      if (annotationValue.freeOnSlot === false) return `This customer is followed by ${annotationValue.owner} (see ${annotationValue.ticket}), please assign accordingly. ${annotationValue.owner} is not available on the slot.`;
      return `This customer is followed by ${annotationValue.owner} (see ${annotationValue.ticket}), please assign accordingly.`;
    }
    case 'owner.away': return `${annotationValue.owner} followed this customer (see ${annotationValue.ticket}) and is currently away; the triage owner decides.`;
    case 'partner.caution': return `No partner is recorded for this deal in Twenty, in the notes or in the ask.${annotationValue.indirect ? ' The deal is marked as indirect, but no partner is named.' : ''}`;
    case 'poc.go_nogo': return 'This ticket was not disqualified; you can run the PoC Go/NoGo gate.';
    case 'poc_paid.exception': return `PoC fee waived by ${annotationValue.approver}: "${annotationValue.quote}"`;
    default: return assertNever(annotationValue);
  }
}

export const EN: Templates = {
  header: (verdict) => ({ denied: '**Presales triage: request not accepted**', waiting: '**Presales triage: information needed**', accepted: '**Presales triage: request accepted**' })[verdict],
  acceptedBody: 'This request meets the presales triage policy.', notesHeading: 'Notes:', policyPrefix: 'Presales triage policy: ',
  recheckLine: 'Once fixed, reply `recheck` in this thread to run the check again.', waitingFooter: 'Reply in this thread. The request is checked again after each reply.', deny, ask, annotation,
};
