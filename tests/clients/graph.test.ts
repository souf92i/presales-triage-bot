import { describe, expect, it, vi } from 'vitest';
import { createGraphClient, parseGraphDateTime } from '../../src/clients/graph.js';

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status }); }
function fakeFetch(...responses: Response[]): any { return vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 })); }
const clock = (now = '2026-10-20T00:00:00.000Z') => vi.fn(() => new Date(now));
const dates = () => [new Date('2026-10-22T11:00:00Z'), new Date('2026-10-22T12:00:00Z')] as const;
const token = () => json({ access_token: 'token', expires_in: 3600 });
const schedule = (value: unknown[]) => json({ value });
const entry = (email: string, scheduleItems: unknown[] = []) => ({ scheduleId: email, scheduleItems });
function graph(fetch: typeof globalThis.fetch, now = clock()) { return { client: createGraphClient({ tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', schedulerMailbox: 'scheduler@example.com', fetch, clock: now }), now }; }

describe('Graph client', () => {
  it('requests a token then getSchedule with UTC times', async () => {
    const fetch = fakeFetch(token(), schedule([entry('a@example.com')])); const { client } = graph(fetch); const [start, end] = dates();
    await client.getAvailability(['a@example.com'], start, end);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://login.microsoftonline.com/tenant/oauth2/v2.0/token');
    expect(fetch.mock.calls[1]?.[0]).toBe('https://graph.microsoft.com/v1.0/users/scheduler%40example.com/calendar/getSchedule');
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ headers: expect.objectContaining({ Prefer: 'outlook.timezone="UTC"' }) });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ startTime: { dateTime: '2026-10-22T11:00:00', timeZone: 'UTC' }, endTime: { dateTime: '2026-10-22T12:00:00', timeZone: 'UTC' } });
  });
  it('reuses the cached token', async () => { const fetch = fakeFetch(token(), schedule([entry('a')]), schedule([entry('a')])); const { client } = graph(fetch); const [s, e] = dates(); await client.getAvailability(['a'], s, e); await client.getAvailability(['a'], s, e); expect(fetch).toHaveBeenCalledTimes(3); });
  it('refreshes the token after expiry', async () => { const fetch = fakeFetch(token(), schedule([entry('a')]), token(), schedule([entry('a')])); const now = clock(); const { client } = graph(fetch, now); const [s, e] = dates(); await client.getAvailability(['a'], s, e); now.mockReturnValue(new Date('2026-10-20T01:00:00Z')); await client.getAvailability(['a'], s, e); expect(fetch).toHaveBeenCalledTimes(4); });
  it('marks busy, tentative and oof overlaps as not free', async () => { const [s, e] = dates(); for (const status of ['busy', 'tentative', 'oof']) { const { client } = graph(fakeFetch(token(), schedule([entry('a', [{ status, start: { dateTime: '2026-10-22T11:30:00' }, end: { dateTime: '2026-10-22T12:30:00' } }])]))); await expect(client.getAvailability(['a'], s, e)).resolves.toEqual(new Map([['a', false]])); } });
  it('treats free, workingElsewhere and unknown as available, and an item ending at slot start as non-overlapping', async () => { const [s, e] = dates(); const { client } = graph(fakeFetch(token(), schedule([entry('a', ['free', 'workingElsewhere', 'unknown', 'busy'].map((status, index) => ({ status, start: { dateTime: index === 3 ? '2026-10-22T10:00:00' : '2026-10-22T11:20:00' }, end: { dateTime: '2026-10-22T11:00:00' } })))]))); await expect(client.getAvailability(['a'], s, e)).resolves.toEqual(new Map([['a', true]])); });
  it('throws DependencyError for a schedule error or a missing schedule', async () => { const [s, e] = dates(); await expect(graph(fakeFetch(token(), schedule([{ scheduleId: 'a', error: { code: 'Error' } }]))).client.getAvailability(['a'], s, e)).rejects.toMatchObject({ dependency: 'graph' }); await expect(graph(fakeFetch(token(), schedule([]))).client.getAvailability(['a'], s, e)).rejects.toMatchObject({ dependency: 'graph' }); });
  it('parseGraphDateTime', () => { expect(parseGraphDateTime('2026-10-22T11:00:00.0000000').toISOString()).toBe('2026-10-22T11:00:00.000Z'); });
});
