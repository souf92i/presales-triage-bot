import type { Dependency } from '../errors.js';
import { DependencyError } from '../errors.js';

export type FetchLike = typeof fetch;

export async function requestJson(dep: Dependency, fetchFn: FetchLike, url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetchFn(url, init);
    if (!response.ok) return { status: response.status, body: null };
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new DependencyError(dep, `Invalid JSON response from ${new URL(url).pathname}`, { cause });
    }
    return { status: response.status, body };
  } catch (cause) {
    if (cause instanceof DependencyError) throw cause;
    throw new DependencyError(dep, `Network failure for ${new URL(url).pathname}`, { cause });
  }
}
