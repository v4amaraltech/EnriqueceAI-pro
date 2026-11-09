const PREFIX = 'cockpit.callNote.v1:';

export function callNoteKey(enrollmentId: string, stepId: string): string {
  return `${enrollmentId}:${stepId}`;
}

/** Nota da ligação nesta aba. Fechar o painel não apaga. */
export function readCallNote(key: string): string {
  if (typeof sessionStorage === 'undefined') return '';
  try {
    return sessionStorage.getItem(PREFIX + key) ?? '';
  } catch {
    return '';
  }
}

export function writeCallNote(key: string, value: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (!value) sessionStorage.removeItem(PREFIX + key);
    else sessionStorage.setItem(PREFIX + key, value);
  } catch {
    // Quota ou modo privado: a nota continua no estado do painel.
  }
}
