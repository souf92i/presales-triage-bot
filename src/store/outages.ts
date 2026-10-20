import type { DatabaseSync } from 'node:sqlite';
import type { Dependency } from '../errors.js';

export function createOutages(database: DatabaseSync) {
  const open = database.prepare('INSERT INTO outages(dependency, started_at, last_error) VALUES($dependency, $atIso, $error) ON CONFLICT(dependency) DO NOTHING');
  const close = database.prepare('DELETE FROM outages WHERE dependency = $dependency');
  return {
    open(dependency: Dependency, atIso: string, error: string): boolean {
      return open.run({ $dependency: dependency, $atIso: atIso, $error: error }).changes > 0;
    },
    close(dependency: Dependency): boolean {
      return close.run({ $dependency: dependency }).changes > 0;
    },
  };
}
