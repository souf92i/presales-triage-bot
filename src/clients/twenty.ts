import { z } from 'zod';
import type { TwentyClient } from './types.js';
import type { FetchLike } from './http.js';
import { requestJson } from './http.js';
import { DependencyError } from '../errors.js';

const nullableText = z.string().nullable();
const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const noteTargetSchema = z.object({ noteId: z.string(), targetOpportunityId: z.string().nullable().optional(), targetCompanyId: z.string().nullable().optional(), deletedAt: z.unknown().nullable() });
const noteSchema = z.object({ id: z.string(), createdAt: z.string(), bodyV2: z.object({ markdown: z.string().nullable().optional() }).nullable().optional(), deletedAt: z.unknown().nullable() });
const quoteSchema = z.object({ id: z.string(), opportunityId: z.string(), status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']), deletedAt: z.unknown().nullable() });
const quoteLineSchema = z.object({ id: z.string(), quoteId: z.string(), productId: z.string().nullable(), name: nullableText, description: nullableText, deletedAt: z.unknown().nullable() });
const opportunitySchema = z.object({
  id: z.string(), companyId: z.string().nullable(), dealtype: nullableText, hosting: z.array(z.string()).nullable(),
  decisionnaires: nullableText, besoin: nullableText, technicalInformation: nullableText, blocker: nullableText, description: nullableText,
  salesChannel: nullableText, dataQualityMissing: nullableText, dealActualPartner: z.unknown().optional(), dealActualPartnerId: z.unknown().optional(), deletedAt: z.unknown().nullable(),
}).superRefine((record, context) => {
  if (!('dealActualPartner' in record) && !('dealActualPartnerId' in record)) context.addIssue({ code: 'custom', message: 'partner field is required' });
});
const companySchema = z.object({ id: z.string(), name: z.string(), deletedAt: z.unknown().nullable() });
type Context = { readonly fetchFn: FetchLike; readonly root: string; readonly headers: HeadersInit };

function filterParam(field: string, op: string, value: string | readonly string[]): string {
  return `${field}[${op}]:${Array.isArray(value) ? JSON.stringify(value) : value}`;
}
function parse<T>(schema: z.ZodType<T>, value: unknown, path: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DependencyError('twenty', `Invalid Twenty response for ${path}`);
  return result.data;
}
async function get(context: Context, path: string): Promise<{ status: number; body: unknown }> {
  const result = await requestJson('twenty', context.fetchFn, `${context.root}${path}`, { method: 'GET', headers: context.headers });
  if (result.status !== 404 && (result.status < 200 || result.status >= 300)) throw new DependencyError('twenty', `Twenty returned ${result.status} for ${path}`);
  return result;
}
async function list<T>(context: Context, plural: string, filter: string, schema: z.ZodType<T>): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ limit: '60', filter });
    if (cursor !== null) query.set('starting_after', cursor);
    const path = `/${plural}?${query}`;
    const parsed = parse(z.object({ data: z.object({ [plural]: z.array(schema) }), pageInfo: pageInfoSchema }), (await get(context, path)).body, path);
    const pageRows = parsed.data[plural];
    if (pageRows === undefined) throw new DependencyError('twenty', `Invalid Twenty response for ${path}`);
    rows.push(...pageRows);
    if (!parsed.pageInfo.hasNextPage) return rows;
    if (parsed.pageInfo.endCursor === null) throw new DependencyError('twenty', `Invalid Twenty response for ${path}`);
    cursor = parsed.pageInfo.endCursor;
  }
  throw new DependencyError('twenty', `Twenty pagination exceeded 100 pages for /${plural}`);
}
async function listChunked<T>(context: Context, plural: string, field: string, ids: readonly string[], schema: z.ZodType<T>): Promise<T[]> {
  return (await Promise.all(Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => list(context, plural, filterParam(field, 'in', ids.slice(index * 50, index * 50 + 50)), schema)))).flat();
}

export function createTwentyClient(opts: { baseUrl: string; apiKey: string; fetch?: FetchLike }): TwentyClient {
  const fetchFn = opts.fetch ?? fetch;
  const root = `${opts.baseUrl.replace(/\/$/, '')}/rest`;
  const headers = { Authorization: `Bearer ${opts.apiKey}`, Accept: 'application/json' };
  const context = { fetchFn, root, headers };

  return {
    async getOpportunity(id) {
      const path = `/opportunities/${id}`;
      const result = await get(context, path);
      if (result.status === 404) return null;
      const wrapper = parse(z.object({ data: z.object({ opportunity: opportunitySchema.nullable() }) }), result.body, path);
      const record = wrapper.data.opportunity;
      if (record === null || record.deletedAt !== null) return null;
      return {
        id: record.id, companyId: record.companyId, dealtype: record.dealtype, hosting: record.hosting ?? [],
        decisionnaires: record.decisionnaires ?? '', besoin: record.besoin ?? '', technicalInformation: record.technicalInformation ?? '',
        blocker: record.blocker ?? '', description: record.description ?? '', salesChannel: record.salesChannel,
        hasActualPartner: record.dealActualPartnerId != null || record.dealActualPartner != null, dataQualityMissing: record.dataQualityMissing ?? '',
      };
    },
    async getCompany(id) {
      const path = `/companies/${id}`;
      const result = await get(context, path);
      if (result.status === 404) return null;
      const wrapper = parse(z.object({ data: z.object({ company: companySchema.nullable() }) }), result.body, path);
      const record = wrapper.data.company;
      return record === null || record.deletedAt !== null ? null : { id: record.id, name: record.name };
    },
    async listNotes(target) {
      const field = target.kind === 'opportunity' ? 'targetOpportunityId' : 'targetCompanyId';
      const targets = (await list(context, 'noteTargets', filterParam(field, 'eq', target.id), noteTargetSchema)).filter((row) => row.deletedAt === null);
      const ids = [...new Set(targets.map((row) => row.noteId))];
      if (ids.length === 0) return [];
      const notes = await listChunked(context, 'notes', 'id', ids, noteSchema);
      return notes.filter((row) => row.deletedAt === null).map((row) => ({ id: row.id, createdAt: row.createdAt, bodyMarkdown: row.bodyV2?.markdown ?? '' }));
    },
    async listQuotes(opportunityId) {
      const quotes = (await list(context, 'quotes', filterParam('opportunityId', 'eq', opportunityId), quoteSchema)).filter((row) => row.deletedAt === null);
      const ids = quotes.map((quote) => quote.id);
      const lines = (await listChunked(context, 'quoteLines', 'quoteId', ids, quoteLineSchema)).filter((line) => line.deletedAt === null);
      return quotes.map((quote) => ({ id: quote.id, status: quote.status, lines: lines.filter((line) => line.quoteId === quote.id).map((line) => ({ productId: line.productId, name: line.name ?? '', description: line.description ?? '' })) }));
    },
  };
}
