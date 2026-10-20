import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ReplayFixtureSchema, runReplay } from '../src/replay/fixture.js';

const fixturePath = new URL('../fixtures/replay/PRE-304.json', import.meta.url);

async function fixture() {
  return ReplayFixtureSchema.parse(JSON.parse(await readFile(fixturePath, 'utf8')));
}

describe('replay', () => {
  it('PRE-304 replays as denied with the expected rules and annotations', async () => {
    const report = await runReplay(await fixture());

    expect(report.mismatches).toEqual([]);
    expect(report.verdict).toBe('denied');
    expect(report.comment).toContain('- Presales triage policy: the opportunity needs at least one qualification note.');
    expect(report.comment).toContain('  - Decision maker: missing, fill the Décisionnaires field');
    expect(report.comment).toContain('  - Twenty data quality check: Decision-maker. Complete these fields in Twenty.');
    expect(report.comment).toContain('- How many certificates will the CLM manage?');
    expect(report.comment).toContain('Available on the slot: ela, sbo.');
    expect(report.comment).toContain('No time zone was given; times are read as Europe/Paris.');
    expect(report.comment).not.toContain('Etienne');
  });

  it('reports mismatches when expectations differ', async () => {
    const input = await fixture();
    const report = await runReplay({ ...input, expected: { ...input.expected!, verdict: 'accepted' } });

    expect(report.mismatches).toHaveLength(1);
    expect(report.mismatches[0]).toContain('verdict');
  });

  it('rejects an invalid fixture', () => {
    expect(() => ReplayFixtureSchema.parse({})).toThrow();
  });
});
