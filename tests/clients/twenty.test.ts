import { describe, expect, it, vi } from 'vitest';
import { DependencyError } from '../../src/errors.js';
import { createTwentyClient } from '../../src/clients/twenty.js';

const opportunity = {
  id: '2341bae4-2621-4cf5-b5f3-ffe7ae25362d', name: 'SEFE -NB-CLM', companyId: 'ed09e1a7-7857-4ce1-b411-d2df62ff4ad5',
  technicalInformation: 'CLM for Public certs. Technical questionnaire provided https://evertrustfr.sharepoint.com/:x:/s/Intranet/IQDFkVHzoJwZRqcUglhQWVDEAWqtDNapiLkQgpU58LHFOJg?e=plOODy',
  decisionnaires: '', besoin: "CLM for Let's Encrypt and Globalsign Certs", blocker: '', dealtype: 'NEWBUSINESS', description: '',
  hosting: ['SAAS'], salesChannel: 'INDIRECT', dataQualityMissing: 'Decision-maker', dealActualPartner: null, deletedAt: null,
};

function fakeFetch(...responses: Response[]): any {
  return vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 }));
}
function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status }); }
function client(fetch: typeof globalThis.fetch) { return createTwentyClient({ baseUrl: 'https://crm.test/', apiKey: 'k', fetch }); }
function page(plural: string, rows: unknown[], pageInfo: { hasNextPage: boolean; endCursor: string | null } = { hasNextPage: false, endCursor: null }) { return { data: { [plural]: rows }, pageInfo }; }

describe('Twenty client', () => {
  it('maps the Sefe opportunity', async () => {
    const fetch = fakeFetch(json({ data: { opportunity } }));
    const result = await client(fetch).getOpportunity(opportunity.id);
    expect(result).toMatchObject({ id: opportunity.id, hosting: ['SAAS'], hasActualPartner: false });
    expect(fetch).toHaveBeenCalledWith('https://crm.test/rest/opportunities/2341bae4-2621-4cf5-b5f3-ffe7ae25362d', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer k', Accept: 'application/json' }) }));
  });

  it('returns null only for JSON 404 responses and for a deleted record', async () => {
    await expect(client(fakeFetch(json({ error: 'not found' }, 404))).getOpportunity('x')).resolves.toBeNull();
    await expect(client(fakeFetch(new Response('<html>not found</html>', { status: 404 }))).getOpportunity('x')).rejects.toMatchObject({ dependency: 'twenty' } satisfies Partial<DependencyError>);
    await expect(client(fakeFetch(json({ data: { opportunity: { ...opportunity, deletedAt: '2026-01-01' } } }))).getOpportunity('x')).resolves.toBeNull();
  });

  it('throws on 500 and on a missing required field', async () => {
    await expect(client(fakeFetch(new Response('bad', { status: 500 }))).getOpportunity('x')).rejects.toMatchObject({ dependency: 'twenty' } satisfies Partial<DependencyError>);
    const { hosting: _hosting, ...withoutHosting } = opportunity;
    await expect(client(fakeFetch(json({ data: { opportunity: withoutHosting } }))).getOpportunity('x')).rejects.toMatchObject({ dependency: 'twenty' } satisfies Partial<DependencyError>);
  });

  it('rejects an opportunity without deletedAt', async () => {
    const { deletedAt: _deletedAt, ...withoutDeletedAt } = opportunity;
    await expect(client(fakeFetch(json({ data: { opportunity: withoutDeletedAt } }))).getOpportunity('x')).rejects.toMatchObject({ dependency: 'twenty' } satisfies Partial<DependencyError>);
  });

  it('treats dealActualPartnerId as a partner', async () => {
    const { dealActualPartner, ...record } = opportunity;
    await expect(client(fakeFetch(json({ data: { opportunity: { ...record, dealActualPartnerId: 'p1' } } }))).getOpportunity('x')).resolves.toMatchObject({ hasActualPartner: true });
  });

  it('rejects an opportunity without either partner key', async () => {
    const { dealActualPartner: _dealActualPartner, ...withoutPartner } = opportunity;
    await expect(client(fakeFetch(json({ data: { opportunity: withoutPartner } }))).getOpportunity('x')).rejects.toMatchObject({ dependency: 'twenty' } satisfies Partial<DependencyError>);
  });

  it('getCompany maps and returns null on 404', async () => {
    await expect(client(fakeFetch(json({ data: { company: { id: 'c', name: 'Acme', deletedAt: null } } }))).getCompany('c')).resolves.toEqual({ id: 'c', name: 'Acme' });
    await expect(client(fakeFetch(json({ error: 'not found' }, 404))).getCompany('c')).resolves.toBeNull();
  });

  it('lists notes in two steps with pagination', async () => {
    const fetch = fakeFetch(
      json(page('noteTargets', [{ noteId: 'n1', targetOpportunityId: 'o', deletedAt: null }], { hasNextPage: true, endCursor: 'c1' })),
      json(page('noteTargets', [{ noteId: 'n2', targetOpportunityId: 'o', deletedAt: null }])),
      json(page('notes', [{ id: 'n1', createdAt: '2026-01-01', bodyV2: { markdown: 'one' }, deletedAt: null }, { id: 'n2', createdAt: '2026-01-02', bodyV2: { markdown: 'two' }, deletedAt: null }])),
    );
    await expect(client(fetch).listNotes({ kind: 'opportunity', id: 'o' })).resolves.toEqual([{ id: 'n1', createdAt: '2026-01-01', bodyMarkdown: 'one' }, { id: 'n2', createdAt: '2026-01-02', bodyMarkdown: 'two' }]);
    expect(fetch.mock.calls[1]?.[0]).toContain('starting_after=c1');
  });

  it('ignores deleted targets and notes', async () => {
    const fetch = fakeFetch(json(page('noteTargets', [{ noteId: 'gone', targetOpportunityId: 'o', deletedAt: 'x' }, { noteId: 'n', targetOpportunityId: 'o', deletedAt: null }])), json(page('notes', [{ id: 'n', createdAt: 'x', bodyV2: {}, deletedAt: 'x' }])));
    await expect(client(fetch).listNotes({ kind: 'opportunity', id: 'o' })).resolves.toEqual([]);
  });

  it('skips the notes call when no target exists', async () => {
    const fetch = fakeFetch(json(page('noteTargets', [])));
    await expect(client(fetch).listNotes({ kind: 'company', id: 'c' })).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('lists quotes with their lines and drops deleted ones', async () => {
    const fetch = fakeFetch(json(page('quotes', [{ id: 'q', opportunityId: 'o', status: 'DRAFT', deletedAt: null }, { id: 'gone', opportunityId: 'o', status: 'SENT', deletedAt: 'x' }])), json(page('quoteLines', [{ id: 'l', quoteId: 'q', productId: null, name: null, description: null, deletedAt: null }, { id: 'd', quoteId: 'q', productId: 'x', name: 'bad', description: 'bad', deletedAt: 'x' }])));
    await expect(client(fetch).listQuotes('o')).resolves.toEqual([{ id: 'q', status: 'DRAFT', lines: [{ productId: null, name: '', description: '' }] }]);
  });

  it('wraps a network failure in DependencyError twenty', async () => {
    await expect(client(vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch).getCompany('c')).rejects.toMatchObject({ dependency: 'twenty' } satisfies Partial<DependencyError>);
  });
});
