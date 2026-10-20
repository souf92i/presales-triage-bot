const dateTimeFormatterOptions = {
  hourCycle: 'h23' as const,
  year: 'numeric' as const,
  month: 'numeric' as const,
  day: 'numeric' as const,
  hour: 'numeric' as const,
  minute: 'numeric' as const,
  second: 'numeric' as const,
};

function wallAsUtc(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, ...dateTimeFormatterOptions }).formatToParts(at);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
}

export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const guess = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(time.slice(0, 2)),
    Number(time.slice(3, 5)),
  );
  const off1 = wallAsUtc(new Date(guess), timeZone) - guess;
  const cand = guess - off1;
  const off2 = wallAsUtc(new Date(cand), timeZone) - cand;
  return new Date(guess - off2);
}

export function endOfDayUtc(date: string, timeZone: string): Date {
  return new Date(zonedToUtc(date, '23:59', timeZone).getTime() + 59_999);
}

export function localDate(at: Date, timeZone: string): string {
  return new Date(wallAsUtc(at, timeZone)).toISOString().slice(0, 10);
}

export function fullWorkingDaysBetween(from: Date, to: Date, timeZone: string): number {
  const start = new Date(`${localDate(from, timeZone)}T00:00:00.000Z`);
  const end = localDate(to, timeZone);
  let count = 0;

  for (start.setUTCDate(start.getUTCDate() + 1); start.toISOString().slice(0, 10) < end; start.setUTCDate(start.getUTCDate() + 1)) {
    const day = start.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function subtractMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month,
    Math.min(from.getUTCDate(), lastDay),
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds(),
    from.getUTCMilliseconds(),
  ));
}
