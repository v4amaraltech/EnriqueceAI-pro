import type { ActionResult } from './action-result';

/**
 * Wraps a server action function with try/catch error handling.
 * Returns ActionResult<T> — never throws to the client.
 *
 * @example
 * export const myAction = safeAction('myAction', async (id: string) => {
 *   const data = await fetchSomething(id);
 *   return { success: true, data };
 * });
 */
export function safeAction<TArgs extends unknown[], TData>(
  name: string,
  fn: (...args: TArgs) => Promise<ActionResult<TData>>,
): (...args: TArgs) => Promise<ActionResult<TData>> {
  return async (...args: TArgs): Promise<ActionResult<TData>> => {
    try {
      return await fn(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${name}] Unhandled error:`, message);
      return { success: false, error: `Erro inesperado em ${name}` };
    }
  };
}
