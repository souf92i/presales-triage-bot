import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config.js';
import { hasPocQuote, isPocLine } from '../../src/facts/poc-quote.js';
import type { Quote, QuoteLine } from '../../src/domain/types.js';

const line = (name: string, description = '', productId: string | null = null): QuoteLine => ({ name, description, productId });
const quote = (status: Quote['status'], lines: readonly QuoteLine[]): Quote => ({ id: status, status, lines });

describe('PoC quotes', () => {
  it('matches the real PoC line names', () => {
    const config = defaultConfig();
    for (const name of ['PS-POC', 'EVT-POC', 'Proof of Concept (PoC)', 'Provision pour POC']) expect(isPocLine(line(name), config)).toBe(true);
    expect(isPocLine(line('EVT-PS-COR', 'Proof of Concept (PoC)'), config)).toBe(true);
    expect(isPocLine(line('Pocket license'), config)).toBe(false);
  });

  it('matches a configured product id', () => expect(isPocLine(line('other', '', 'product-1'), { ...defaultConfig(), pocProducts: ['product-1'] })).toBe(true));
  it('ignores EXPIRED and REJECTED quotes and counts DRAFT', () => {
    const config = defaultConfig();
    expect(hasPocQuote([quote('EXPIRED', [line('PS-POC')]), quote('REJECTED', [line('PS-POC')]), quote('DRAFT', [line('PS-POC')])], config)).toBe(true);
  });
  it('requires a PoC line', () => expect(hasPocQuote([quote('SENT', [line('CLM license')])], defaultConfig())).toBe(false));
});
