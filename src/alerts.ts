import type { FetchLike } from './clients/http.js';
import type { Clock } from './domain/types.js';
import { DependencyError, type Dependency } from './errors.js';
import type { Logger } from './log.js';
import type { Store } from './store/store.js';

export interface OutageTracker {
  success(dep: Dependency): void;
  failure(dep: Dependency, error: Error): Promise<void>;
}

export function createOutageTracker(opts: { outages: Store['outages']; webhookUrl: string | undefined; fetch?: FetchLike; log: Logger; clock: Clock }): OutageTracker {
  const fetchFn = opts.fetch ?? fetch;
  return {
    success(dependency) {
      if (opts.outages.close(dependency)) opts.log('info', 'dependency outage ended', { dependency });
    },
    async failure(dependency, error) {
      const since = opts.clock().toISOString();
      if (!opts.outages.open(dependency, since, error.message)) return;
      opts.log('error', 'dependency outage started', { dependency, error: error.message });
      if (!opts.webhookUrl) return;
      try {
        const response = await fetchFn(opts.webhookUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `Presales Triage: ${dependency} is unavailable since ${since}. Error: ${error.message}` }),
        });
        if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
      } catch (webhookError) {
        opts.log('warn', 'dependency outage webhook failed', {
          dependency, error: webhookError instanceof Error ? webhookError.message : String(webhookError),
        });
      }
    },
  };
}

export function withOutageTracking<T extends object>(client: T, dep: Dependency, tracker: OutageTracker): T {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        let result: unknown;
        try {
          result = await Reflect.apply(value, target, args);
        } catch (error) {
          if (error instanceof DependencyError) await tracker.failure(dep, error);
          throw error;
        }
        tracker.success(dep);
        return result;
      };
    },
  });
}
