import { sanitizeFilterValue } from '@/lib/supabase/sanitize-filter';

/** Campos de texto da tabela `leads` usados na busca livre da tela /leads. */
export const LEAD_SEARCH_FIELDS = [
  'razao_social',
  'nome_fantasia',
  'cnpj',
  'first_name',
  'last_name',
  'email',
] as const;

/** Mínimo de dígitos para a busca também olhar os telefones do lead. */
export const PHONE_SEARCH_MIN_DIGITS = 6;

/**
 * Dígitos a procurar nos telefones do lead, ou null quando o termo não parece
 * um pedaço de telefone. Um DDI 55 à frente (12–13 dígitos) é descartado: o
 * telefone salvo pode estar com ou sem o 55, e `%<ddd+numero>%` casa os dois.
 */
export function phoneSearchDigits(term: string): string | null {
  let digits = term.replace(/\D/g, '');
  if (digits.length < PHONE_SEARCH_MIN_DIGITS) return null;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  return digits;
}

/**
 * Quebra a busca em termos. Normalmente separa por espaço (cada termo precisa
 * aparecer em algum campo). Quando a busca inteira parece um telefone — só
 * dígitos e pontuação, como "+55 (16) 99986-7577" — vira UM termo só com os
 * dígitos, senão "(16)" e "99986-7577" seriam exigidos separadamente e nunca
 * casariam.
 */
export function splitSearchTerms(search: string): string[] {
  const cleaned = search.replace(/[%_]/g, '').trim();
  if (!cleaned) return [];
  const digits = cleaned.replace(/\D/g, '');
  if (/^[\d\s()+\-.]+$/.test(cleaned) && digits.length >= PHONE_SEARCH_MIN_DIGITS) {
    return [digits];
  }
  return cleaned.split(/\s+/).filter(Boolean);
}

/**
 * Cláusulas PostgREST (`.or(...)`) para um termo. CNPJ é salvo só com dígitos,
 * então um CNPJ formatado também é procurado pelos dígitos; o mesmo vale para
 * telefone via a computed field `phone_digits` (migration
 * 20261019180000_leads_phone_digits_computed_field).
 */
export function searchClausesForTerm(
  rawTerm: string,
  fields: readonly string[] = LEAD_SEARCH_FIELDS,
): string[] {
  // Strip PostgREST filter metacharacters (comma, parens, backslash) so a term
  // like "x,status.eq.won" can't inject an extra OR condition into the clause.
  const term = sanitizeFilterValue(rawTerm);
  const clauses = fields.map((field) => `${field}.ilike.%${term}%`);
  const digits = term.replace(/\D/g, '');
  if (digits.length >= 3 && digits !== term) {
    clauses.push(`cnpj.ilike.%${digits}%`);
  }
  const phoneDigits = phoneSearchDigits(term);
  if (phoneDigits) {
    clauses.push(`phone_digits.ilike.%${phoneDigits}%`);
  }
  return clauses;
}
