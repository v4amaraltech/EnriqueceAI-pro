import type { ActionResult } from './action-result';

/**
 * Returns an ActionResult error if a Supabase query failed.
 * Returns null if no error (caller should continue).
 *
 * @example
 * const { data, error } = await from(supabase, 'leads').select('*')...;
 * const qErr = handleQueryError(error, 'Erro ao buscar leads', 'leads');
 * if (qErr) return qErr;
 */
export function handleQueryError<T = never>(
  error: { message: string } | null | unknown,
  userMessage: string,
  logContext?: string,
): ActionResult<T> | null {
  if (!error) return null;
  if (logContext) {
    const msg =
      error && typeof error === 'object' && 'message' in error
        ? (error as { message: string }).message
        : String(error);
    console.error(`[${logContext}] ${userMessage}:`, msg);
  }
  return { success: false, error: userMessage };
}
