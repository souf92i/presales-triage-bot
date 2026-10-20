import type { Config } from '../config.js';
import type { Quote, QuoteLine } from '../domain/types.js';

export function isPocLine(line: QuoteLine, config: Pick<Config, 'pocProducts' | 'pocQuoteLinePattern'>): boolean {
  return (line.productId !== null && config.pocProducts.includes(line.productId))
    || new RegExp(config.pocQuoteLinePattern, 'i').test(line.name)
    || new RegExp(config.pocQuoteLinePattern, 'i').test(line.description);
}

export function hasPocQuote(quotes: readonly Quote[], config: Pick<Config, 'pocProducts' | 'pocQuoteLinePattern' | 'pocQuoteExcludedStatuses'>): boolean {
  return quotes.some((quote) => !config.pocQuoteExcludedStatuses.includes(quote.status) && quote.lines.some((line) => isPocLine(line, config)));
}
