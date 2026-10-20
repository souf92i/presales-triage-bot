import { describe, expect, it } from 'vitest';

import { kindFromLabels, mapRequestType, parseAsksForm, parseRequesterName } from '../src/asks-parser.js';
import { defaultConfig } from '../src/config.js';
import { ATTACHMENTS, PRE_282, PRE_294, PRE_295, PRE_297, PRE_303, PRE_304 } from './fixtures/asks.js';

describe('Asks form parser', () => {
  const placeholders = defaultConfig().placeholderValues;

  it('parses PRE-304 (Sefe)', () => {
    expect(parseAsksForm(PRE_304, ATTACHMENTS['PRE-304'], placeholders)).toEqual({
      target: ['End customer'], customerName: 'Sefe',
      crmLinkRaw: 'https://crm.evertrust.internal/object/opportunity/2341bae4-2621-4cf5-b5f3-ffe7ae25362d',
      requestType: 'Product demonstration', deadline: '2026-10-22',
      meetingText: 'The earlier the better, they want to buy without POC. SaaS 200 public certificate holders. Target date: 22.10. 13:00 - 14:00. Blocker sent',
      priority: 'Critical',
      sharepointLink: 'https://evertrustfr.sharepoint.com/:f:/s/Intranet/IgBLkKyhcyaRRrMwo1ZIJa_5AVB_Ix7oKu37Ve138rahUUI?e=1bJ5it',
      requesterName: 'Hilde WALDENFELS',
    });
  });

  it('keeps multi-line meeting text and an empty trailing section (PRE-294)', () => {
    const form = parseAsksForm(PRE_294, ATTACHMENTS['PRE-294'], placeholders);
    expect(form?.requestType).toBe('PoC');
    expect(form?.sharepointLink).toBe('');
    expect(form?.meetingText).toMatch(/^Possible facture cette année \(500 certificats\)\nEstimation et guide POC pour :/);
    expect(form?.meetingText).toContain('* **Serveur Web avec load balancer F5**');
  });

  it('keeps prose when the link section has no URL (PRE-297)', () => {
    expect(parseAsksForm(PRE_297, ATTACHMENTS['PRE-297'], placeholders)?.crmLinkRaw).toMatch(/^CLM pour gérer/);
  });

  it('parses two targets and the view URL (PRE-295)', () => {
    const form = parseAsksForm(PRE_295, ATTACHMENTS['PRE-295'], placeholders);
    expect(form?.target).toEqual(['End customer', 'Partner']);
    expect(form?.crmLinkRaw).toBe('https://crm.evertrust.internal/objects/opportunities?viewId=47dd53b2-27a6-45d1-a0aa-5e1b1fc05259');
  });

  it('parses a partner-only ask with a company link (PRE-282)', () => {
    const form = parseAsksForm(PRE_282, ATTACHMENTS['PRE-282'], placeholders);
    expect(form?.target).toEqual(['Partner']);
    expect(form?.crmLinkRaw).toBe('https://crm.evertrust.internal/object/company/aa561e6f-d166-5576-93ef-a4cada04a352');
  });

  it('turns the placeholder link "xxx" into an empty value (PRE-303)', () => {
    const form = parseAsksForm(PRE_303, ATTACHMENTS['PRE-303'], placeholders);
    expect(form?.crmLinkRaw).toBe('');
    expect(form?.meetingText).toBe('14h-15h');
  });

  it('returns null for a description without the Type of Request heading', () => {
    expect(parseAsksForm('Please schedule a demo for Acme next week.', [], placeholders)).toBeNull();
    expect(parseAsksForm('#### Target\n\nEnd customer', [], placeholders)).toBeNull();
  });

  it('treats a placeholder Type of Request as empty', () => {
    expect(parseAsksForm('#### Type of Request\n\nTBD', [], placeholders)?.requestType).toBe('');
  });

  it('sets deadline to null when it is not an ISO date', () => {
    expect(parseAsksForm('#### Type of Request\n\nPoC\n\n#### Deadline\n\nnext week', [], placeholders)?.deadline).toBeNull();
  });

  it('reads the requester from the Ask attachment', () => {
    expect(parseRequesterName(['Slack thread', 'Ask from Hilde WALDENFELS'])).toBe('Hilde WALDENFELS');
    expect(parseRequesterName([])).toBeNull();
  });

  it('maps every form value case-insensitively and returns null for unknown values', () => {
    const mapping = defaultConfig().requestTypes;
    expect(mapRequestType('Product demonstration', mapping)).toEqual({ kind: 'demo', label: 'demo' });
    expect(mapRequestType(' technical workshop ', mapping)).toEqual({ kind: 'technical_discovery', label: 'technical discovery' });
    expect(mapRequestType('Technical discovery', mapping)?.kind).toBe('technical_discovery');
    expect(mapRequestType('PoC', mapping)).toEqual({ kind: 'poc', label: 'poc' });
    expect(mapRequestType('RFx response (RFI/RFP)', mapping)).toEqual({ kind: 'rfx', label: 'rfi rfp' });
    expect(mapRequestType('Technical questionnaire', mapping)?.label).toBe('rfi rfp');
    expect(mapRequestType('Technical support', mapping)).toBeNull();
  });

  it('reverses the label mapping', () => {
    expect(kindFromLabels(['Bug', 'Technical Discovery'], defaultConfig().requestTypes)).toBe('technical_discovery');
    expect(kindFromLabels([], defaultConfig().requestTypes)).toBeNull();
  });
});
