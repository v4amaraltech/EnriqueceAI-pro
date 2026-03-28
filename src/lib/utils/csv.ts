/**
 * Escape a CSV field value, wrapping in quotes if it contains commas, quotes, or newlines.
 */
export function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
