import { fullWorkingDaysBetween } from '../time.js';
import { REASON } from './applicability.js';
import type { Annotation, Rule } from './types.js';

export function shuffle<T>(items: readonly T[], random: () => number): readonly T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export const slotRule: Rule = {
  id: 'slot',
  applies: ({ facts }) => ['demo', 'technical_discovery'].includes(facts.ticket.requestKind)
    ? { applies: true }
    : { applies: false, reason: REASON.kind(facts.ticket.requestKind) },
  evaluate: ({ facts, config, random }) => {
    const { slot, repDeclinedMove, slotsOfferedAwaitingCustomer, onsite } = facts.ticketFacts;
    if (repDeclinedMove !== null && facts.lastAskKeys.includes('slot.nobody_available')) {
      return { outcome: { kind: 'deny', deny: { key: 'slot.rep_declined_move' } }, annotations: [] };
    }
    if (slot !== null && facts.slotWindow === null) {
      const missing = (['date', 'start', 'end'] as const).filter((part) => slot[part] === null);
      return { outcome: { kind: 'ask', ask: { key: 'slot.incomplete', missing } }, annotations: [] };
    }
    if (facts.slotWindow !== null && facts.slotWindow.startUtc <= facts.now) {
      return { outcome: { kind: 'ask', ask: { key: 'slot.past', date: slot!.date!, start: slot!.start! } }, annotations: [] };
    }
    if (facts.slotWindow !== null) {
      if (facts.calendar === null) return { outcome: { kind: 'error', reason: 'calendar not read' }, annotations: [] };
      const annotations: Annotation[] = [];
      if (facts.slotWindow.timezoneAssumed) annotations.push({ key: 'slot.timezone_assumed', timezone: facts.slotWindow.timezone });
      const workingDays = fullWorkingDaysBetween(new Date(facts.now), new Date(facts.slotWindow.startUtc), config.defaultTimezone);
      if (workingDays < config.shortNoticeWorkingDays) annotations.push({ key: 'slot.short_notice', workingDays: config.shortNoticeWorkingDays });
      if (onsite !== null) annotations.push({ key: 'slot.onsite' });
      const freeMembers = facts.calendar.members.filter((member) => member.free).map((member) => member.name);
      if (freeMembers.length > 0) {
        return { outcome: { kind: 'pass' }, annotations: [...annotations, { key: 'slot.free_members', members: shuffle(freeMembers, random) }] };
      }
      return {
        outcome: { kind: 'ask', ask: { key: 'slot.nobody_available', date: slot!.date!, start: slot!.start!, end: slot!.end!, timezone: facts.slotWindow.timezone } },
        annotations,
      };
    }
    if (slot === null && slotsOfferedAwaitingCustomer !== null) return { outcome: { kind: 'pass' }, annotations: [{ key: 'slot.check_later' }] };
    return { outcome: { kind: 'deny', deny: { key: 'slot.no_slot' } }, annotations: [] };
  },
};
