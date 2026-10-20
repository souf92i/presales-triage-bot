import { z } from 'zod';
import type { GraphClient } from './types.js';
import type { FetchLike } from './http.js';
import { requestJson } from './http.js';
import { DependencyError } from '../errors.js';
import type { Clock } from '../domain/types.js';

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number() });
const scheduleSchema = z.object({ value: z.array(z.object({ scheduleId: z.string(), scheduleItems: z.array(z.object({ status: z.string(), start: z.object({ dateTime: z.string() }), end: z.object({ dateTime: z.string() }) })).optional(), error: z.unknown().optional() })) });

export function parseGraphDateTime(value: string): Date {
  const offset = /(?:Z|[+-]\d\d:\d\d)$/.test(value);
  const milliseconds = value.replace(/\.(\d{3})\d*/, '.$1');
  return new Date(offset ? milliseconds : `${milliseconds}Z`);
}
function formatUtc(date: Date): string { return date.toISOString().replace(/\.\d{3}Z$/, ''); }

export function createGraphClient(opts: { tenantId: string; clientId: string; clientSecret: string; schedulerMailbox: string; fetch?: FetchLike; clock?: Clock }): GraphClient {
  const fetchFn = opts.fetch ?? fetch;
  const clock = opts.clock ?? (() => new Date());
  let cached: { token: string; expiresAt: Date } | null = null;
  const invalid = (message: string) => new DependencyError('graph', message);

  async function token(): Promise<string> {
    if (cached !== null && cached.expiresAt > clock()) return cached.token;
    const body = new URLSearchParams({ client_id: opts.clientId, client_secret: opts.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
    const result = await requestJson('graph', fetchFn, `https://login.microsoftonline.com/${opts.tenantId}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (result.status < 200 || result.status >= 300) throw invalid(`Graph token request returned ${result.status}`);
    const parsed = tokenSchema.safeParse(result.body);
    if (!parsed.success) throw invalid('Invalid Graph token response');
    cached = { token: parsed.data.access_token, expiresAt: new Date(clock().getTime() + Math.max(0, parsed.data.expires_in - 300) * 1000) };
    return cached.token;
  }

  return {
    async getAvailability(emails, startUtc, endUtc) {
      const accessToken = await token();
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(opts.schedulerMailbox)}/calendar/getSchedule`;
      const body = { schedules: emails, startTime: { dateTime: formatUtc(startUtc), timeZone: 'UTC' }, endTime: { dateTime: formatUtc(endUtc), timeZone: 'UTC' }, availabilityViewInterval: 15 };
      const result = await requestJson('graph', fetchFn, url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC"' }, body: JSON.stringify(body) });
      if (result.status === 401) cached = null;
      if (result.status < 200 || result.status >= 300) throw invalid(`Graph getSchedule returned ${result.status}`);
      const parsed = scheduleSchema.safeParse(result.body);
      if (!parsed.success) throw invalid('Invalid Graph getSchedule response');
      const byEmail = new Map(parsed.data.value.map((entry) => [entry.scheduleId.toLowerCase(), entry]));
      return new Map(emails.map((email) => {
        const entry = byEmail.get(email.toLowerCase());
        if (entry === undefined || entry.error !== undefined) throw invalid(`Graph schedule unavailable for ${email}`);
        const busy = (entry.scheduleItems ?? []).some((item) => ['busy', 'tentative', 'oof'].includes(item.status) && parseGraphDateTime(item.start.dateTime) < endUtc && parseGraphDateTime(item.end.dateTime) > startUtc);
        return [email.toLowerCase(), !busy] as const;
      }));
    },
  };
}
