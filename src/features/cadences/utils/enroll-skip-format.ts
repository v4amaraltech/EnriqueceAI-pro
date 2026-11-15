/**
 * Formato da mensagem de lead pulado por já estar em outra cadência.
 * Módulo puro (sem sonner/React): o servidor monta a mensagem e o aviso da UI
 * a lê com a MESMA definição.
 */
export const SKIPPED_ENROLL_PATTERN = /já está na cadência "(.+)"$/;

export function skippedEnrollError(leadId: string, cadenceName: string): string {
  return `Lead ${leadId}: já está na cadência "${cadenceName}"`;
}

/** Nome da cadência de uma mensagem de pulado, ou null se a mensagem for de outro tipo. */
export function parseSkippedCadenceName(message: string): string | null {
  return SKIPPED_ENROLL_PATTERN.exec(message)?.[1] ?? null;
}
