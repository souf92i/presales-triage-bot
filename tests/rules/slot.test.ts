import { describe, expect, it } from 'vitest';

import { shuffle, slotRule } from '../../src/rules/slot.js';
import { asKind, baseFacts, ctx, ev, withTicketFacts } from '../helpers/facts.js';

describe('slot rule', () => {
  it('passes and lists free members in shuffled order', () => {
    const result = slotRule.evaluate(ctx(baseFacts()));
    expect(result).toEqual({ outcome: { kind: 'pass' }, annotations: [{ key: 'slot.free_members', members: ['ela', 'sbo'] }] });
    expect(shuffle(['a', 'b', 'c'], () => 0)).toEqual(['b', 'c', 'a']);
  });

  it('asks whether the date can move when nobody is free', () => {
    const facts = { ...baseFacts(), calendar: { members: [] } };
    expect(slotRule.evaluate(ctx(facts))).toEqual({
      outcome: { kind: 'ask', ask: { key: 'slot.nobody_available', date: '2026-11-05', start: '10:00', end: '11:00', timezone: 'Europe/Paris' } },
      annotations: [],
    });
  });

  it('adds the timezone assumption first', () => {
    const facts = { ...baseFacts(), slotWindow: { ...baseFacts().slotWindow!, timezoneAssumed: true }, calendar: { members: [] } };
    expect(slotRule.evaluate(ctx(facts)).annotations).toEqual([{ key: 'slot.timezone_assumed', timezone: 'Europe/Paris' }]);
  });

  it('adds short notice with one full working day', () => {
    const facts = { ...baseFacts(), now: '2026-10-20T16:10:00.000Z', slotWindow: { ...baseFacts().slotWindow!, startUtc: '2026-10-22T11:00:00.000Z' } };
    expect(slotRule.evaluate(ctx(facts)).annotations).toEqual([
      { key: 'slot.short_notice', workingDays: 2 },
      { key: 'slot.free_members', members: ['ela', 'sbo'] },
    ]);
  });

  it('does not add short notice with two full working days', () => {
    const facts = { ...baseFacts(), now: '2026-10-20T16:10:00.000Z', slotWindow: { ...baseFacts().slotWindow!, startUtc: '2026-10-23T08:00:00.000Z' } };
    expect(slotRule.evaluate(ctx(facts)).annotations).toEqual([{ key: 'slot.free_members', members: ['ela', 'sbo'] }]);
  });

  it('adds the on site annotation', () => {
    const facts = withTicketFacts(baseFacts(), { onsite: ev('On site') });
    expect(slotRule.evaluate(ctx(facts)).annotations).toEqual([{ key: 'slot.onsite' }, { key: 'slot.free_members', members: ['ela', 'sbo'] }]);
  });

  it('asks for the missing parts of an incomplete slot', () => {
    const facts = withTicketFacts(baseFacts(), { slot: { ...baseFacts().ticketFacts.slot!, start: null, end: null } });
    expect(slotRule.evaluate(ctx({ ...facts, slotWindow: null }))).toEqual({ outcome: { kind: 'ask', ask: { key: 'slot.incomplete', missing: ['start', 'end'] } }, annotations: [] });
  });

  it('asks with no missing parts when ambiguous', () => {
    const facts = withTicketFacts(baseFacts(), { slot: { ...baseFacts().ticketFacts.slot!, ambiguity: 'could be another date' } });
    expect(slotRule.evaluate(ctx({ ...facts, slotWindow: null }))).toEqual({ outcome: { kind: 'ask', ask: { key: 'slot.incomplete', missing: [] } }, annotations: [] });
  });

  it('asks for a future date when the slot is past', () => {
    const facts = { ...baseFacts(), slotWindow: { ...baseFacts().slotWindow!, startUtc: '2026-10-19T09:00:00.000Z' }, calendar: null };
    expect(slotRule.evaluate(ctx(facts))).toEqual({ outcome: { kind: 'ask', ask: { key: 'slot.past', date: '2026-11-05', start: '10:00' } }, annotations: [] });
  });

  it('returns error when a future slot has no calendar', () => {
    expect(slotRule.evaluate(ctx({ ...baseFacts(), calendar: null }))).toEqual({ outcome: { kind: 'error', reason: 'calendar not read' }, annotations: [] });
  });

  it('passes with check-later when slots were offered', () => {
    const facts = withTicketFacts(baseFacts(), { slot: null, slotsOfferedAwaitingCustomer: ev('Sent options') });
    expect(slotRule.evaluate(ctx({ ...facts, slotWindow: null }))).toEqual({ outcome: { kind: 'pass' }, annotations: [{ key: 'slot.check_later' }] });
  });

  it('denies when no slot and nothing was offered', () => {
    const facts = withTicketFacts(baseFacts(), { slot: null });
    expect(slotRule.evaluate(ctx({ ...facts, slotWindow: null }))).toEqual({ outcome: { kind: 'deny', deny: { key: 'slot.no_slot' } }, annotations: [] });
  });

  it('denies when the rep declined to move after a nobody-available question', () => {
    const facts = withTicketFacts(baseFacts(), { repDeclinedMove: ev('Cannot move') });
    expect(slotRule.evaluate(ctx({ ...facts, lastAskKeys: ['slot.nobody_available'] }))).toEqual({ outcome: { kind: 'deny', deny: { key: 'slot.rep_declined_move' } }, annotations: [] });
  });

  it('ignores repDeclinedMove without that previous question', () => {
    const facts = withTicketFacts(baseFacts(), { repDeclinedMove: ev('Cannot move') });
    expect(slotRule.evaluate(ctx(facts)).outcome).toEqual({ kind: 'pass' });
  });

  it('skips poc and rfx', () => {
    expect(slotRule.applies(ctx(asKind(baseFacts(), 'poc')))).toEqual({ applies: false, reason: 'not applicable to poc' });
    expect(slotRule.applies(ctx(asKind(baseFacts(), 'rfx')))).toEqual({ applies: false, reason: 'not applicable to rfx' });
  });
});
