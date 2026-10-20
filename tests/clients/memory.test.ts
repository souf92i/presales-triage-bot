import { describe, expect, it } from 'vitest';
import { MemoryGraph, MemoryLlm, MemoryTwenty } from '../../src/clients/memory.js';
import { baseFacts, COMPANY_ID, NOW, OPP_ID } from '../helpers/facts.js';

describe('memory clients', () => {
  it('looks up CRM records, hides deleted opportunities and scopes notes and quotes', async () => {
    const opportunity = baseFacts().deal!.opportunity;
    const note = { id: 'note', createdAt: NOW, bodyMarkdown: 'note', opportunityId: OPP_ID, companyId: COMPANY_ID };
    const quote = { id: 'quote', opportunityId: OPP_ID, status: 'DRAFT' as const, lines: [] };
    const client = new MemoryTwenty({ opportunities: [opportunity, { ...opportunity, id: 'deleted', deleted: true }], companies: [{ id: COMPANY_ID, name: 'Acme' }], notes: [note], quotes: [quote] });
    expect(await client.getOpportunity(OPP_ID)).toEqual(opportunity);
    expect(await client.getOpportunity('deleted')).toBeNull(); expect(await client.getOpportunity('missing')).toBeNull();
    expect(await client.getCompany(COMPANY_ID)).toEqual({ id: COMPANY_ID, name: 'Acme' }); expect(await client.getCompany('missing')).toBeNull();
    const expected = [{ id: 'note', createdAt: NOW, bodyMarkdown: 'note' }];
    expect(await client.listNotes({ kind: 'opportunity', id: OPP_ID })).toEqual(expected);
    expect(await client.listNotes({ kind: 'company', id: COMPANY_ID })).toEqual(expected);
    expect(await client.listNotes({ kind: 'company', id: 'missing' })).toEqual([]);
    expect(await client.listQuotes(OPP_ID)).toEqual([{ id: 'quote', status: 'DRAFT', lines: [] }]);
    expect(await client.listQuotes('missing')).toEqual([]);
    expect(client.calls).toContain(`getOpportunity:${OPP_ID}`);
  });

  it('normalizes Graph emails, records windows and fails for an unknown email', async () => {
    const client = new MemoryGraph({ 'SBO@evertrust.fr': true, 'vdo@evertrust.fr': false });
    const start = new Date(NOW); const end = new Date('2026-10-20T13:00:00.000Z');
    expect(await client.getAvailability(['sbo@evertrust.fr', 'VDO@evertrust.fr'], start, end)).toEqual(new Map([['sbo@evertrust.fr', true], ['vdo@evertrust.fr', false]]));
    expect(client.calls).toEqual([{ emails: ['sbo@evertrust.fr', 'VDO@evertrust.fr'], start: NOW, end: end.toISOString() }]);
    await expect(client.getAvailability(['missing@evertrust.fr'], start, end)).rejects.toMatchObject({ name: 'DependencyError', dependency: 'graph' });
  });

  it('normalizes LLM outputs and records the inputs and raw values', async () => {
    const facts = baseFacts();
    const outputs = { ticketFacts: { ...facts.ticketFacts, language: 'FR', slot: { ...facts.ticketFacts.slot!, isComplete: false } }, qualification: { ...facts.deal!.qualification, ...facts.deal!.noteFacts } };
    const client = new MemoryLlm(outputs, 'test-model');
    const ticketInput = { formKind: 'demo' as const, form: facts.ticket.form, sources: [] };
    const qualificationInput = { hosting: ['SAAS'], sources: [] };
    const ticket = await client.extractTicketFacts(ticketInput);
    expect(ticket.value.language).toBe('fr'); expect(ticket.value.slot?.isComplete).toBe(true);
    expect(ticket.raw).toEqual(outputs.ticketFacts); expect(ticket.model).toBe('test-model');
    expect((await client.extractQualification(qualificationInput)).value).toEqual(outputs.qualification);
    expect(client.inputs).toEqual({ ticket: [ticketInput], qualification: [qualificationInput] });
  });

  it('rejects malformed memory LLM output through the same schemas as the real client', async () => {
    const facts = baseFacts(); const client = new MemoryLlm({ ticketFacts: {}, qualification: {} });
    await expect(client.extractTicketFacts({ formKind: 'demo', form: facts.ticket.form, sources: [] })).rejects.toMatchObject({ dependency: 'llm' });
    await expect(client.extractQualification({ hosting: [], sources: [] })).rejects.toMatchObject({ dependency: 'llm' });
  });
});
