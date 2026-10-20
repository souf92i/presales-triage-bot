import { describe, expect, it, vi } from 'vitest';
import { createLlmClient, type ParseFn } from '../../src/clients/llm.js';
import type { QualificationExtraction, TicketFacts } from '../../src/domain/types.js';

const ticket: TicketFacts = {
  additionalRequests: [], slot: { date: '2026-10-22', start: '13:00', end: '14:00', timezone: 'Europe/Paris', isComplete: false, ambiguity: null, evidence: { sourceId: 'ticket', quote: 'Target date: 22.10. 13:00 - 14:00' } },
  slotsOfferedAwaitingCustomer: null, repDeclinedMove: null, onsite: null, language: 'FR',
};
const qualification: QualificationExtraction = {
  items: Object.fromEntries(['volume', 'hosting', 'solution', 'decisionMaker', 'budget', 'timeline', 'currentPki', 'useCases', 'clmDriver'].map((key) => [key, { status: 'missing', value: null, evidence: null }])),
  volume: null, solutionIncludesClm: null, discoveryEvidence: null, pocQuoteExpectedEvidence: null, approverException: null, partnerNamed: null,
} as QualificationExtraction;
const input = {
  formKind: 'demo' as const,
  form: { target: ['End customer'] as const, customerName: '', crmLinkRaw: '', requestType: '', deadline: null, meetingText: 'Target date: 22.10. 13:00 - 14:00', priority: '', sharepointLink: '', requesterName: null },
  sources: [{ id: 'ticket', label: 'Ticket', createdAt: '2026-10-20T10:00:00Z', text: 'Target date: 22.10. 13:00 - 14:00' }],
};
const fake = (response: Awaited<ReturnType<ParseFn>> = { stop_reason: 'end_turn', parsed_output: ticket, model: 'served-model' }): ParseFn => vi.fn(async () => response);
const client = (parse: ParseFn) => createLlmClient({ model: 'claude-sonnet-5-5', effort: 'medium', parse });

describe('LLM client', () => {
  it('sends model, effort, adaptive thinking, the fallback beta and the sources', async () => {
    const parse = fake(); await client(parse).extractTicketFacts(input);
    const params = vi.mocked(parse).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 16000, thinking: { type: 'adaptive' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'medium' } });
    expect((params.output_config as { format?: unknown }).format).toBeDefined();
    expect(JSON.stringify(params)).not.toMatch(/temperature|tool_choice|budget_tokens/);
    expect(String((params.messages as { content: string }[])[0]?.content)).toContain('<source id="ticket"');
    expect(String((params.messages as { content: string }[])[0]?.content)).toContain('Target date: 22.10. 13:00 - 14:00');
  });

  it('returns the raw output and served model', async () => {
    const parse = fake(); const result = await client(parse).extractTicketFacts(input);
    expect(result.raw).toBe(ticket); expect(result.model).toBe('served-model');
  });

  it('recomputes isComplete from date, start and end', async () => {
    const result = await client(fake()).extractTicketFacts(input);
    expect(result.value.slot?.isComplete).toBe(true); expect(result.value.language).toBe('fr');
  });

  it.each([
    ['refusal', { stop_reason: 'refusal', parsed_output: ticket, model: 'm' }, 'LLM did not return a usable response: refusal'],
    ['max_tokens', { stop_reason: 'max_tokens', parsed_output: ticket, model: 'm' }, 'LLM did not return a usable response: max_tokens'],
    ['null parsed_output', { stop_reason: 'end_turn', parsed_output: null, model: 'm' }, 'LLM did not return a usable response'],
    ['a bad date format', { stop_reason: 'end_turn', parsed_output: { ...ticket, slot: { ...ticket.slot!, date: '22.10' } }, model: 'm' }, 'invalid LLM output'],
    ['an invalid timezone', { stop_reason: 'end_turn', parsed_output: { ...ticket, slot: { ...ticket.slot!, timezone: 'Europe/Not-Real' } }, model: 'm' }, 'invalid LLM output'],
  ])('throws DependencyError on %s', async (_name, response, message) => {
    await expect(client(fake(response)).extractTicketFacts(input)).rejects.toMatchObject({ dependency: 'llm', message });
  });

  it('throws DependencyError on min > max volume', async () => {
    const raw = { ...qualification, volume: { min: 3, max: 2, unitIsClmManagedCerts: true, unclear: false, evidence: { sourceId: 'ticket', quote: '3' } } };
    await expect(client(fake({ stop_reason: 'end_turn', parsed_output: raw, model: 'm' })).extractQualification({ hosting: [], sources: input.sources })).rejects.toMatchObject({ dependency: 'llm' });
  });

  it('throws DependencyError when the SDK throws', async () => {
    const parse: ParseFn = vi.fn(async () => { throw new Error('offline'); });
    await expect(client(parse).extractTicketFacts(input)).rejects.toMatchObject({ dependency: 'llm' });
  });
});
