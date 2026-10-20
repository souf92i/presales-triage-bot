import type { Annotation, Ask, Deny } from '../rules/types.js';

export interface DenyText {
  readonly policy: string;
  readonly items: readonly string[];
}

export interface Templates {
  header(verdict: 'accepted' | 'waiting' | 'denied'): string;
  readonly acceptedBody: string;
  readonly notesHeading: string;
  readonly policyPrefix: string;
  readonly recheckLine: string;
  readonly waitingFooter: string;
  deny(deny: Deny): DenyText;
  ask(ask: Ask): string;
  annotation(annotation: Annotation): string;
}

export function truncate(raw: string, max = 120): string {
  return raw.length > max ? `${raw.slice(0, max)}...` : raw;
}

export function joinList(parts: readonly string[], conjunction: string): string {
  if (parts.length < 2) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]}${conjunction}${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}${conjunction}${parts.at(-1)}`;
}

export function assertNever(value: never): never {
  throw new Error(`Unknown template value: ${JSON.stringify(value)}`);
}
