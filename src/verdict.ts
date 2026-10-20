import { ownerAnnotation, partnerAnnotation } from './annotations.js';
import { enabledRules } from './rules/registry.js';
import type { Annotation, Ask, Deny, Rule, RuleContext, RuleResult } from './rules/types.js';
import type { Facts } from './domain/types.js';

export type RuleVerdict = 'accepted' | 'waiting' | 'denied' | 'pending_retry';

export interface VerdictResult {
  readonly verdict: RuleVerdict;
  readonly results: readonly RuleResult[];
  readonly denies: readonly Deny[];
  readonly asks: readonly Ask[];
  readonly errors: readonly string[];
  readonly annotations: readonly Annotation[];
}

export function runRules(rules: readonly Rule[], ctx: RuleContext): readonly RuleResult[] {
  return rules.map((rule) => {
    const applicability = rule.applies(ctx);
    return applicability.applies
      ? { ruleId: rule.id, ...rule.evaluate(ctx) }
      : { ruleId: rule.id, outcome: { kind: 'skip', reason: applicability.reason }, annotations: [] };
  });
}

function errorMessages(results: readonly RuleResult[], facts: Facts): string[] {
  const errors = results.flatMap(({ ruleId, outcome }) => outcome.kind === 'error' ? [`${ruleId}: ${outcome.reason}`] : []);
  if (facts.history === null) errors.push('history: backfill not complete');
  return errors;
}

function verdictFor(errors: readonly string[], denies: readonly Deny[], asks: readonly Ask[]): RuleVerdict {
  if (errors.length > 0) return 'pending_retry';
  if (denies.length > 0) return 'denied';
  return asks.length > 0 ? 'waiting' : 'accepted';
}

function acceptedAnnotations(annotations: Annotation[], facts: Facts): Annotation[] {
  const partner = partnerAnnotation(facts);
  const owner = ownerAnnotation(facts);
  if (partner !== null) annotations.push(partner);
  if (owner !== null) annotations.push(owner);
  if (facts.ticket.requestKind === 'poc') annotations.push({ key: 'poc.go_nogo' });
  return annotations;
}

export function assembleVerdict(results: readonly RuleResult[], facts: Facts): VerdictResult {
  const denies = results.flatMap(({ outcome }) => outcome.kind === 'deny' ? [outcome.deny] : []);
  const asks = results.flatMap(({ outcome }) => outcome.kind === 'ask' ? [outcome.ask] : []);
  const errors = errorMessages(results, facts);
  const verdict = verdictFor(errors, denies, asks);
  if (verdict === 'pending_retry') return { verdict, results, denies, asks, errors, annotations: [] };

  const annotations = results.flatMap((result) => result.annotations);
  return { verdict, results, denies, asks, errors, annotations: verdict === 'accepted' ? acceptedAnnotations(annotations, facts) : annotations };
}

export function evaluateRules(ctx: RuleContext): VerdictResult {
  return assembleVerdict(runRules(enabledRules(ctx.config), ctx), ctx.facts);
}
