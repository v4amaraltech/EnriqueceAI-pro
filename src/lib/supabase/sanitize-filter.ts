/**
 * Sanitize a user-provided value for use in PostgREST filter strings (.or(), .filter()).
 *
 * PostgREST uses commas to separate filter conditions and parentheses for grouping.
 * Unsanitized user input in template literals like `.or(\`col.ilike.%${input}%\`)`
 * can inject additional filter conditions (e.g., input = "test,id.neq.0" would add
 * an extra filter clause).
 *
 * This function escapes characters that have special meaning in PostgREST filter syntax.
 */
export function sanitizeFilterValue(value: string): string {
  // Remove characters that are operators in PostgREST filter syntax:
  // , (condition separator), ( ) (grouping), \ (escape char)
  return value.replace(/[,()\\]/g, '');
}
