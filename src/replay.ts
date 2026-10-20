import { readFile } from 'node:fs/promises';

import { ReplayFixtureSchema, runReplay } from './replay/fixture.js';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined) throw new Error('Usage: node dist/replay.js <fixture.json>');
  const fixture = ReplayFixtureSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const report = await runReplay(fixture);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.mismatches.length > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
