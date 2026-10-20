import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../src/config.js';
import { isPlaceholder, normalizeName, normalizeWhitespace } from '../src/text.js';

describe('text helpers', () => {
  const placeholders = defaultConfig().placeholderValues;

  it('normalizes whitespace and names', () => {
    expect(normalizeWhitespace('  a \n\t b  ')).toBe('a b');
    expect(normalizeName('Hilde  WALDENFELS ')).toBe('hilde waldenfels');
  });

  it('recognizes configured placeholders', () => {
    expect(isPlaceholder(' TBD ', placeholders)).toBe(true);
    expect(isPlaceholder('À définir', placeholders)).toBe(true);
    expect(isPlaceholder('', placeholders)).toBe(true);
    expect(isPlaceholder('CISO', placeholders)).toBe(false);
  });
});
