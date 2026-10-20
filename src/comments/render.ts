import type { ManualReason, TemplateLanguage, Verdict } from '../domain/types.js';
import type { RuleResult } from '../rules/types.js';
import type { VerdictResult } from '../verdict.js';
import { EN } from './en.js';
import { FR } from './fr.js';
import type { Templates } from './templates.js';

function templatesFor(language: TemplateLanguage): Templates {
  return language === 'fr' ? FR : EN;
}

function notesBlock(templates: Templates, annotations: Pick<VerdictResult, 'annotations'>['annotations']): string {
  return annotations.length === 0 ? '' : [templates.notesHeading, ...annotations.map((annotation) => `- ${templates.annotation(annotation)}`)].join('\n');
}

export function renderVerdictComment(result: Pick<VerdictResult, 'denies' | 'asks' | 'annotations'> & { verdict: 'accepted' | 'waiting' | 'denied' }, language: TemplateLanguage): string {
  const templates = templatesFor(language);
  const notes = notesBlock(templates, result.annotations);
  if (result.verdict === 'accepted') return [templates.header('accepted'), templates.acceptedBody, notes].filter(Boolean).join('\n\n');
  if (result.verdict === 'waiting') return [templates.header('waiting'), result.asks.map((ask) => `- ${templates.ask(ask)}`).join('\n'), notes, templates.waitingFooter].filter(Boolean).join('\n\n');
  const reasons = result.denies.flatMap((deny) => {
    const text = templates.deny(deny);
    return [`- ${templates.policyPrefix}${text.policy}`, ...text.items.map((item) => `  - ${item}`)];
  });
  return [templates.header('denied'), [...reasons, ...result.asks.map((ask) => `- ${templates.ask(ask)}`)].join('\n'), notes, templates.recheckLine].filter(Boolean).join('\n\n');
}

export function renderShadowComment(input: { verdict: Verdict; results: readonly RuleResult[]; body: string }): string {
  const outcomes = input.results.map(({ ruleId, outcome }) => {
    if (outcome.kind === 'pass') return `- ${ruleId}: pass`;
    if (outcome.kind === 'deny') return `- ${ruleId}: deny (${outcome.deny.key})`;
    if (outcome.kind === 'ask') return `- ${ruleId}: ask (${outcome.ask.key})`;
    return `- ${ruleId}: ${outcome.kind} (${outcome.reason})`;
  });
  return ['Shadow mode, no action taken:', `Verdict: ${input.verdict}\nRules:\n${outcomes.join('\n')}`, '---', input.body].join('\n\n');
}

export function renderManualComment(reason: ManualReason): string {
  const french = reason.key === 'unsupported_form'
    ? 'Tri manuel nécessaire : la description du ticket ne suit pas le formulaire Asks (pas de section "Type of Request").'
    : `Tri manuel nécessaire : le type de demande "${reason.requestType}" n'est pas reconnu.`;
  const english = reason.key === 'unsupported_form'
    ? 'Manual triage needed: the ticket description does not follow the Asks form (no "Type of Request" section).'
    : `Manual triage needed: the request type "${reason.requestType}" is not recognized.`;
  return `${french}\n\n${english}`;
}

export function renderHandoffComment(): string {
  return 'Le tri automatique est indisponible, tri manuel nécessaire.\n\nAutomatic triage is unavailable, manual triage needed.';
}

export function renderWaitExpiryComment(language: TemplateLanguage): string {
  return renderVerdictComment({ verdict: 'denied', denies: [{ key: 'wait.no_answer' }], asks: [], annotations: [] }, language);
}
