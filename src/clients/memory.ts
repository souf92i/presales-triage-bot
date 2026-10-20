import { defaultConfig } from '../config.js';
import type { Company, Opportunity, Quote } from '../domain/types.js';
import { DependencyError } from '../errors.js';
import { normalizeQualification, normalizeTicketFacts } from '../facts/llm-schemas.js';
import type { GraphClient, LlmClient, QualificationInput, TicketFactsInput, TwentyClient } from './types.js';

export interface MemoryTwentyData {
  opportunities: readonly (Opportunity & { deleted?: boolean })[];
  companies: readonly Company[];
  notes: readonly { id: string; createdAt: string; bodyMarkdown: string; opportunityId: string | null; companyId: string | null }[];
  quotes: readonly (Quote & { opportunityId: string })[];
}

export class MemoryTwenty implements TwentyClient {
  readonly calls: string[] = [];
  constructor(private readonly data: MemoryTwentyData) {}

  async getOpportunity(id: string): Promise<Opportunity | null> {
    this.calls.push(`getOpportunity:${id}`);
    const opportunity = this.data.opportunities.find((record) => record.id === id && !record.deleted);
    if (!opportunity) return null;
    const { deleted, ...record } = opportunity;
    return record;
  }

  async getCompany(id: string): Promise<Company | null> {
    this.calls.push(`getCompany:${id}`);
    return this.data.companies.find((company) => company.id === id) ?? null;
  }

  async listNotes(target: { kind: 'opportunity' | 'company'; id: string }) {
    this.calls.push(`listNotes:${target.kind}:${target.id}`);
    return this.data.notes.filter((note) => note[target.kind === 'opportunity' ? 'opportunityId' : 'companyId'] === target.id)
      .map(({ id, createdAt, bodyMarkdown }) => ({ id, createdAt, bodyMarkdown }));
  }

  async listQuotes(opportunityId: string): Promise<readonly Quote[]> {
    this.calls.push(`listQuotes:${opportunityId}`);
    return this.data.quotes.filter((quote) => quote.opportunityId === opportunityId)
      .map(({ id, status, lines }) => ({ id, status, lines }));
  }
}

export class MemoryGraph implements GraphClient {
  readonly calls: { emails: readonly string[]; start: string; end: string }[] = [];
  private readonly free: ReadonlyMap<string, boolean>;

  constructor(free: Readonly<Record<string, boolean>>) {
    this.free = new Map(Object.entries(free).map(([email, available]) => [email.toLowerCase(), available]));
  }

  async getAvailability(emails: readonly string[], startUtc: Date, endUtc: Date): Promise<ReadonlyMap<string, boolean>> {
    this.calls.push({ emails: [...emails], start: startUtc.toISOString(), end: endUtc.toISOString() });
    return new Map(emails.map((email) => {
      const key = email.toLowerCase();
      const free = this.free.get(key);
      if (free === undefined) throw new DependencyError('graph', `No availability for ${email}`);
      return [key, free];
    }));
  }
}

export class MemoryLlm implements LlmClient {
  readonly inputs: { ticket: TicketFactsInput[]; qualification: QualificationInput[] } = { ticket: [], qualification: [] };

  constructor(private readonly outputs: { ticketFacts: unknown; qualification: unknown }, private readonly model = defaultConfig().llmModel) {}

  async extractTicketFacts(input: TicketFactsInput) {
    this.inputs.ticket.push(input);
    return { value: normalizeTicketFacts(this.outputs.ticketFacts), raw: this.outputs.ticketFacts, model: this.model };
  }

  async extractQualification(input: QualificationInput) {
    this.inputs.qualification.push(input);
    return { value: normalizeQualification(this.outputs.qualification), raw: this.outputs.qualification, model: this.model };
  }
}
