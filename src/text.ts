export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeName(value: string): string {
  return normalizeWhitespace(value.normalize('NFC')).toLowerCase();
}

export function isPlaceholder(value: string, placeholders: readonly string[]): boolean {
  const normalizedValue = value.trim().toLowerCase();
  return placeholders.some((placeholder) => placeholder.trim().toLowerCase() === normalizedValue);
}
