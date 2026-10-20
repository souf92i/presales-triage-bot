import type { Facts, ManualReason, Random, RawLlm } from './domain/types.js';
import { gatherFacts, type GatherDeps, type GatherInput } from './facts/gather.js';
import { evaluateRules, type VerdictResult } from './verdict.js';

export type EvaluationOutcome =
  | { kind: 'manual'; reason: ManualReason }
  | { kind: 'evaluated'; facts: Facts; label: string; result: VerdictResult; raw: RawLlm };

export async function evaluateTicket(input: GatherInput, deps: GatherDeps & { random: Random }): Promise<EvaluationOutcome> {
  const gathered = await gatherFacts(input, deps);
  if (gathered.kind === 'manual') return gathered;
  const { facts, label, raw } = gathered;
  return { kind: 'evaluated', facts, label, raw, result: evaluateRules({ facts, config: deps.config, random: deps.random }) };
}
