import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { LlmClient, LlmResult, QualificationInput, TicketFactsInput } from './types.js';
import type { QualificationExtraction, TicketFacts } from '../domain/types.js';
import { DependencyError } from '../errors.js';
import { LlmQualificationSchema, LlmTicketFactsSchema, normalizeQualification, normalizeTicketFacts } from '../facts/llm-schemas.js';
import { QUALIFICATION_SYSTEM, renderSources, TICKET_FACTS_SYSTEM } from '../facts/prompts.js';

export type ParseFn = (params: Record<string, unknown>) => Promise<{ stop_reason: string | null; parsed_output: unknown; model: string }>;

export function sdkParse(apiKey: string): ParseFn {
  const client = new Anthropic({ apiKey });
  return (params) => client.beta.messages.parse(params as never) as Promise<{ stop_reason: string | null; parsed_output: unknown; model: string }>;
}

function message(input: TicketFactsInput): string {
  return `Form request type: ${input.formKind}\nDeadline: ${input.form.deadline ?? 'none'}\nTarget: ${input.form.target.join(', ')}\n\n${renderSources(input.sources)}`;
}
function qualificationMessage(input: QualificationInput): string { return `hosting field: ${input.hosting.join(', ') || 'empty'}\n\n${renderSources(input.sources)}`; }

export function createLlmClient(opts: { model: string; effort: string; parse: ParseFn }): LlmClient {
  async function extract<T>(system: string, content: string, schema: unknown, normalize: (raw: unknown) => T): Promise<LlmResult<T>> {
    try {
      const response = await opts.parse({ model: opts.model, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', thinking: { type: 'adaptive' }, output_config: { effort: opts.effort, format: zodOutputFormat(schema as never) }, system, messages: [{ role: 'user', content }] });
      const stopped = response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens';
      if (stopped || response.parsed_output === null) {
        const suffix = stopped ? `: ${response.stop_reason}` : '';
        throw new DependencyError('llm', `LLM did not return a usable response${suffix}`);
      }
      return { value: normalize(response.parsed_output), raw: response.parsed_output, model: response.model };
    } catch (error) {
      if (error instanceof DependencyError) throw error;
      throw new DependencyError('llm', 'LLM request failed', { cause: error });
    }
  }
  return { extractTicketFacts: (input) => extract(TICKET_FACTS_SYSTEM, message(input), LlmTicketFactsSchema, normalizeTicketFacts), extractQualification: (input) => extract(QUALIFICATION_SYSTEM, qualificationMessage(input), LlmQualificationSchema, normalizeQualification) };
}
