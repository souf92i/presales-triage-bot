import { describe, expect, it } from 'vitest';

import {
  addDays,
  endOfDayUtc,
  fullWorkingDaysBetween,
  isValidTimeZone,
  localDate,
  subtractMonths,
  zonedToUtc,
} from '../src/time.js';

describe('time helpers', () => {
  it('converts zoned times to UTC across DST and time zones', () => {
    expect(zonedToUtc('2026-10-22', '13:00', 'Europe/Paris').toISOString()).toBe('2026-10-22T11:00:00.000Z');
    expect(zonedToUtc('2026-10-26', '13:00', 'Europe/Paris').toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(zonedToUtc('2026-10-22', '13:00', 'America/New_York').toISOString()).toBe('2026-10-22T17:00:00.000Z');
  });

  it('converts local date boundaries', () => {
    expect(endOfDayUtc('2026-10-22', 'Europe/Paris').toISOString()).toBe('2026-10-22T21:59:59.999Z');
    expect(localDate(new Date('2026-10-20T23:30:00Z'), 'Europe/Paris')).toBe('2026-10-21');
  });

  it('counts full working days between local dates', () => {
    expect(fullWorkingDaysBetween(new Date('2026-10-19T08:00:00Z'), new Date('2026-10-21T07:00:00Z'), 'Europe/Paris')).toBe(1);
    expect(fullWorkingDaysBetween(new Date('2026-10-20T16:10:00Z'), new Date('2026-10-22T11:00:00Z'), 'Europe/Paris')).toBe(1);
    expect(fullWorkingDaysBetween(new Date('2026-10-20T12:00:00Z'), new Date('2026-10-23T08:00:00Z'), 'Europe/Paris')).toBe(2);
    expect(fullWorkingDaysBetween(new Date('2026-10-23T12:00:00Z'), new Date('2026-10-27T08:00:00Z'), 'Europe/Paris')).toBe(1);
    expect(fullWorkingDaysBetween(new Date('2026-10-20T12:00:00Z'), new Date('2026-10-20T15:00:00Z'), 'Europe/Paris')).toBe(0);
  });

  it('adjusts UTC dates without mutating them', () => {
    expect(subtractMonths(new Date('2026-03-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addDays(new Date('2026-10-20T12:00:00Z'), 7).toISOString()).toBe('2026-10-27T12:00:00.000Z');
  });

  it('validates IANA time zones', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
  });
});
