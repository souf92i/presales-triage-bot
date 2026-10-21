import type { Dependency } from '../errors.js';
import { DependencyError } from '../errors.js';

export type FetchLike = typeof fetch;

function networkCause(error: unknown): string {
  const inner = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (!(inner instanceof Error)) return String(inner);
  return inner.message || String((inner as { code?: unknown }).code ?? inner.name);
}

export async function requestJson(dep: Dependency, fetchFn: FetchLike, url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetchFn(url, init);
    if (!response.ok) {
      try {
        return { status: response.status, body: await response.json() };
      } catch {
        return { status: response.status, body: null };
      }
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new DependencyError(dep, `Invalid JSON response from ${new URL(url).pathname}`, { cause });
    }
    return { status: response.status, body };
  } catch (cause) {
    if (cause instanceof DependencyError) throw cause;
    throw new DependencyError(dep, `Network failure for ${new URL(url).pathname}: ${networkCause(cause)}`, { cause });
  }
}
