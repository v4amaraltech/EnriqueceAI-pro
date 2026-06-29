import { TEMPLATE_VARIABLE_REGEX } from '../cadence.schemas';

/**
 * Extracts variable names from a template string.
 * Variables use {{variable_name}} syntax.
 */
export function extractVariables(template: string): string[] {
  const matches = [...template.matchAll(TEMPLATE_VARIABLE_REGEX)].map((m) => m[1]).filter((v): v is string => v != null);
  return [...new Set(matches)];
}

/** Escape HTML-significant characters so interpolated values can't inject markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders a template by replacing {{variable}} placeholders with values.
 * Unknown variables are left as-is.
 *
 * M2: pass `{ escapeHtml: true }` when rendering into an HTML context (the email
 * body) so lead-sourced values (CSV/API imports) can't break the HTML structure
 * or inject markup/links. Leave it off for plain-text contexts like the subject.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string | null | undefined>,
  options?: { escapeHtml?: boolean },
): string {
  return template.replace(TEMPLATE_VARIABLE_REGEX, (match, varName: string) => {
    const value = variables[varName];
    if (value == null) return match;
    return options?.escapeHtml ? escapeHtml(value) : value;
  });
}
