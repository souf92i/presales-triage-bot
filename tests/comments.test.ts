import { describe, expect, it } from 'vitest';

import { renderHandoffComment, renderManualComment, renderShadowComment, renderVerdictComment, renderWaitExpiryComment } from '../src/comments/render.js';
import { EN } from '../src/comments/en.js';
import { FR } from '../src/comments/fr.js';
import type { Annotation, Ask, Deny, RuleResult } from '../src/rules/types.js';

const denies: readonly Deny[] = [
  { key: 'single_request.multiple', items: [{ kind: 'poc', quote: 'a PoC' }] },
  { key: 'crm_link.invalid', raw: 'not a link', partnerOnly: true },
  { key: 'crm_link.not_found', recordKind: 'opportunity', id: 'opp-1' },
  { key: 'notes_exist.none', maxAgeMonths: 12 },
  { key: 'qualification.missing', items: [{ id: 'budget', status: 'declared_unobtainable' }], maxUnknown: 2, dataQualityMissing: 'Decision-maker' },
  { key: 'volume_floor.below_min', max: 100, min: 200 },
  { key: 'discovery_first.missing', kind: 'demo', maxAgeMonths: 12 },
  { key: 'slot.rep_declined_move' },
  { key: 'slot.no_slot' },
  { key: 'poc_volume.below_min', max: 100, min: 500 },
  { key: 'poc_paid.no_quote' },
  { key: 'wait.no_answer' },
];

const asks: readonly Ask[] = [
  { key: 'volume_floor.unclear', quote: 'many' },
  { key: 'slot.incomplete', missing: ['date'] },
  { key: 'slot.past', date: '2026-10-19', start: '09:00' },
  { key: 'slot.nobody_available', date: '2026-11-05', start: '10:00', end: '11:00', timezone: 'Europe/Paris' },
];

const annotations: readonly Annotation[] = [
  { key: 'slot.timezone_assumed', timezone: 'Europe/Paris' }, { key: 'slot.short_notice', workingDays: 2 },
  { key: 'slot.onsite' }, { key: 'slot.free_members', members: ['ela', 'sbo'] }, { key: 'slot.check_later' },
  { key: 'owner.active', owner: 'Ela', ticket: 'PRE-1', freeOnSlot: true }, { key: 'owner.away', owner: 'Mob', ticket: 'PRE-2' },
  { key: 'partner.caution', indirect: true }, { key: 'poc.go_nogo' }, { key: 'poc_paid.exception', approver: 'Ela', quote: 'approved' },
];

function expectClean(text: string): void {
  expect(text).not.toBe('');
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('[object');
  expect(text).not.toContain('{');
}

describe('comment templates', () => {
  it('renders every deny, ask and annotation key in both languages', () => {
    for (const templates of [EN, FR]) {
      for (const deny of denies) expectClean(templates.deny(deny).policy + templates.deny(deny).items.join(''));
      for (const ask of asks) expectClean(templates.ask(ask));
      for (const annotation of annotations) expectClean(templates.annotation(annotation));
    }
  });

  it('never uses an em-dash', () => {
    const comments = [
      ...['en', 'fr'].flatMap((language) => [
        renderVerdictComment({ verdict: 'denied', denies, asks, annotations }, language as 'en' | 'fr'),
        renderVerdictComment({ verdict: 'waiting', denies: [], asks, annotations }, language as 'en' | 'fr'),
        renderVerdictComment({ verdict: 'accepted', denies: [], asks: [], annotations }, language as 'en' | 'fr'),
        renderWaitExpiryComment(language as 'en' | 'fr'),
      ]),
      renderShadowComment({ verdict: 'denied', results: [], body: 'Ticket body' }),
      renderManualComment({ key: 'unsupported_form' }), renderHandoffComment(),
    ];
    for (const comment of comments) expect(comment).not.toContain('\u2014');
  });

  it('denied comment lists deny reasons and open questions in one bullet list, then the recheck line', () => {
    const comment = renderVerdictComment({ verdict: 'denied', denies: [{ key: 'notes_exist.none', maxAgeMonths: 12 }, { key: 'qualification.missing', items: [{ id: 'decisionMaker', status: 'missing' }], maxUnknown: 2, dataQualityMissing: '' }], asks: [{ key: 'volume_floor.unclear', quote: 'many' }], annotations: [] }, 'en');
    expect(comment).toContain('- Presales triage policy: the opportunity needs at least one qualification note.');
    expect(comment).toContain('  - Decision maker: missing, fill the Décisionnaires field');
    expect(comment).toContain('- How many certificates will the CLM manage?');
    expect(comment.split('\n').at(-1)).toBe('Once fixed, reply `recheck` in this thread to run the check again.');
  });

  it('qualification deny shows the unobtainable suffix and data quality', () => {
    const comment = renderVerdictComment({ verdict: 'denied', denies: [{ key: 'qualification.missing', items: [{ id: 'budget', status: 'declared_unobtainable' }], maxUnknown: 2, dataQualityMissing: 'Decision-maker' }], asks: [], annotations: [] }, 'en');
    expect(comment).toContain('  - Budget: declared unobtainable, add it in a Twenty note');
    expect(comment).toContain('  - Twenty data quality check: Decision-maker. Complete these fields in Twenty.');
  });

  it('uses the revised qualification and PoC wording in both languages', () => {
    const qualification: Deny = { key: 'qualification.missing', items: [{ id: 'budget', status: 'missing' }, { id: 'timeline', status: 'declared_unobtainable' }], maxUnknown: 2, dataQualityMissing: 'Decision-maker' };
    expect(EN.deny(qualification).items).toEqual(['Budget: missing, add it in a Twenty note', 'Project timeline: declared unobtainable, add it in a Twenty note', 'Twenty data quality check: Decision-maker. Complete these fields in Twenty.']);
    expect(FR.deny(qualification).items).toEqual(['Budget : information manquante, ajoutez-le dans une note Twenty', 'Calendrier du projet : information déclarée impossible à obtenir, ajoutez-le dans une note Twenty', 'Contrôle qualité Twenty : Decision-maker. Complétez ces champs dans Twenty.']);
    expect(EN.deny({ key: 'poc_volume.below_min', max: 100, min: 500 }).items).toEqual(['The volume recorded is 100 certificates. If this is wrong, correct it in a Twenty note on the opportunity.']);
    expect(FR.deny({ key: 'poc_volume.below_min', max: 100, min: 500 }).items).toEqual(["Le volume indiqué est de 100 certificats. S'il est faux, corrigez-le dans une note Twenty sur l'opportunité."]);
  });

  it('waiting comment lists the questions as bullets with the footer', () => {
    const comment = renderVerdictComment({ verdict: 'waiting', denies: [], asks: [{ key: 'slot.past', date: '2026-10-19', start: '09:00' }], annotations: [] }, 'en');
    expect(comment).toContain('- The meeting slot (2026-10-19 09:00) is in the past.');
    expect(comment).toContain('Reply in this thread. The request is checked again after each reply.');
  });

  it('accepted comment in French', () => {
    const comment = renderVerdictComment({ verdict: 'accepted', denies: [], asks: [], annotations: [{ key: 'slot.onsite' }] }, 'fr');
    expect(comment).toContain('**Triage avant-vente : demande acceptée**');
    expect(comment).toContain('Remarques :');
  });

  it('crm link deny shows the URL shape and partner hint and truncates long raw text to 120 characters', () => {
    const comment = renderVerdictComment({ verdict: 'denied', denies: [{ key: 'crm_link.invalid', raw: 'x'.repeat(121), partnerOnly: true }], asks: [], annotations: [] }, 'en');
    expect(comment).toContain('https://crm.evertrust.internal/object/opportunity/<id>');
    expect(comment).toContain('company link is also accepted');
    expect(comment).toContain(`"${'x'.repeat(120)}..."`);
  });

  it('incomplete slot question joins missing parts', () => {
    expect(renderVerdictComment({ verdict: 'waiting', denies: [], asks: [{ key: 'slot.incomplete', missing: ['start', 'end'] }], annotations: [] }, 'en')).toContain('Please give the start time and end time of the meeting.');
    expect(renderVerdictComment({ verdict: 'waiting', denies: [], asks: [{ key: 'slot.incomplete', missing: ['start', 'end'] }], annotations: [] }, 'fr')).toContain("Merci d'indiquer l'heure de début et l'heure de fin de la réunion.");
  });

  it('renders owner availability branches in both languages', () => {
    const owner = { key: 'owner.active' as const, owner: 'Ela', ticket: 'PRE-1' };
    expect(EN.annotation({ ...owner, freeOnSlot: false })).toBe('This customer is followed by Ela (see PRE-1), please assign accordingly. Ela is not available on the slot.');
    expect(EN.annotation({ ...owner, freeOnSlot: null })).toBe('This customer is followed by Ela (see PRE-1), please assign accordingly.');
    expect(FR.annotation({ ...owner, freeOnSlot: false })).toContain("n'est pas disponible");
    expect(FR.annotation({ ...owner, freeOnSlot: null })).toBe("Ce client est suivi par Ela (voir PRE-1), merci d'assigner en conséquence.");
  });

  it('shadow comment lists the verdict and each rule outcome', () => {
    const results: readonly RuleResult[] = [
      { ruleId: 'notes-exist', outcome: { kind: 'deny', deny: { key: 'notes_exist.none', maxAgeMonths: 12 } }, annotations: [] },
      { ruleId: 'poc-paid', outcome: { kind: 'skip', reason: 'not applicable to demo' }, annotations: [] },
    ];
    const comment = renderShadowComment({ verdict: 'denied', results, body: 'Ticket body' });
    expect(comment.startsWith('Shadow mode, no action taken:')).toBe(true);
    expect(comment).toContain('- notes-exist: deny (notes_exist.none)');
    expect(comment).toContain('- poc-paid: skip (not applicable to demo)');
  });

  it('manual, handoff and wait expiry comments', () => {
    expect(renderManualComment({ key: 'unsupported_form' })).toBe('Tri manuel nécessaire : la description du ticket ne suit pas le formulaire Asks (pas de section "Type of Request").\n\nManual triage needed: the ticket description does not follow the Asks form (no "Type of Request" section).');
    expect(renderManualComment({ key: 'unknown_request_type', requestType: 'Custom request' })).toBe('Tri manuel nécessaire : le type de demande "Custom request" n\'est pas reconnu.\n\nManual triage needed: the request type "Custom request" is not recognized.');
    expect(renderHandoffComment()).toBe('Le tri automatique est indisponible, tri manuel nécessaire.\n\nAutomatic triage is unavailable, manual triage needed.');
    const comment = renderWaitExpiryComment('en');
    expect(comment).toContain('No answer from the requester was received.');
    expect(comment).toContain('Once fixed, reply `recheck` in this thread to run the check again.');
  });
});
