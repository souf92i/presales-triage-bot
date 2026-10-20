import type { DatabaseSync } from 'node:sqlite';

export type CursorName = 'index_updated_at' | 'comments_created_at' | 'backfill_complete';

export function createCursors(database: DatabaseSync) {
  const get = database.prepare('SELECT value FROM cursors WHERE name = $name');
  const set = database.prepare('INSERT INTO cursors(name, value) VALUES($name, $value) ON CONFLICT(name) DO UPDATE SET value = excluded.value');
  return {
    get(name: CursorName): string | null {
      const row = get.get({ $name: name }) as { value: string } | undefined;
      return row?.value ?? null;
    },
    set(name: CursorName, value: string): void {
      set.run({ $name: name, $value: value });
    },
  };
}
