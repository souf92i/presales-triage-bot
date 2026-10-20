import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOutageTracker, withOutageTracking } from '../src/alerts.js';
import { DependencyError } from '../src/errors.js';
import { openStore, type Store } from '../src/store/store.js';
import { NOW } from './helpers/facts.js';

const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });

function setup(webhookUrl: string | undefined = 'https://alerts.example.com/hook') {
  const store = openStore(':memory:');
  stores.push(store);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 200 }));
  const log = vi.fn();
  const tracker = createOutageTracker({ outages: store.outages, webhookUrl, fetch, log, clock: () => new Date(NOW) });
  return { store, fetch, log, tracker };
}

describe('outage alerts', () => {
  it('alerts once per outage and again after recovery', async () => {
    const { store, fetch, log, tracker } = setup();
    const error = new DependencyError('linear', 'offline');
    await tracker.failure('linear', error);
    await tracker.failure('linear', error);
    const restarted = createOutageTracker({ outages: store.outages, webhookUrl: 'https://alerts.example.com/hook', fetch, log, clock: () => new Date(NOW) });
    await restarted.failure('linear', error);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://alerts.example.com/hook');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init?.body))).toEqual({ text: `Presales Triage: linear is unavailable since ${NOW}. Error: offline` });
    expect(log).toHaveBeenCalledWith('error', 'dependency outage started', { dependency: 'linear', error: 'offline' });
    restarted.success('linear');
    restarted.success('linear');
    expect(log.mock.calls.filter(([level]) => level === 'info')).toEqual([['info', 'dependency outage ended', { dependency: 'linear' }]]);
    await tracker.failure('linear', error);
    expect(fetch).toHaveBeenCalledTimes(2);
    await tracker.failure('graph', new Error('graph offline'));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['network', 'http'] as const)('webhook %s failure is logged, not thrown', async (kind) => {
    const { fetch, log, tracker } = setup();
    if (kind === 'network') fetch.mockRejectedValueOnce(new Error('connection failed'));
    else fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(tracker.failure('twenty', new Error('offline'))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({ dependency: 'twenty' }));
    await tracker.failure('twenty', new Error('still offline'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('records an outage without a webhook', async () => {
    const { fetch, log, tracker } = setup('');
    await tracker.failure('llm', new Error('offline'));
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('error', 'dependency outage started', { dependency: 'llm', error: 'offline' });
  });

  it('withOutageTracking reports success and DependencyError but not other errors', async () => {
    const dependencyError = new DependencyError('linear', 'offline');
    const otherError = new Error('programming error');
    let failureTracked = false;
    const tracker = { success: vi.fn(), failure: vi.fn(async () => { await Promise.resolve(); failureTracked = true; }) };
    class Client {
      readonly value = 'viewer';
      async getViewerId() { return this.value; }
      async unavailable() { throw dependencyError; }
      async broken() { throw otherError; }
    }
    const client = withOutageTracking(new Client(), 'linear', tracker);
    expect(client.value).toBe('viewer');
    await expect(client.getViewerId()).resolves.toBe('viewer');
    expect(tracker.success).toHaveBeenCalledExactlyOnceWith('linear');
    await expect(client.unavailable()).rejects.toBe(dependencyError);
    expect(failureTracked).toBe(true);
    expect(tracker.failure).toHaveBeenCalledExactlyOnceWith('linear', dependencyError);
    await expect(client.broken()).rejects.toBe(otherError);
    expect(tracker.success).toHaveBeenCalledTimes(1);
    expect(tracker.failure).toHaveBeenCalledTimes(1);
  });
});
