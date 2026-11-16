import { AUTO_DIAL_RULES } from './auto-dial-rules';

const BRT_OFFSET_MS = 3 * 3600 * 1000; // BRT = UTC-3 fixo
const two = (n: number) => String(n).padStart(2, '0');

/**
 * Nota padrão automática do "não atendeu" (A-D9, FR-25): "DD/MM HHhMM: não atendeu (tentativa n/3)." em horário de Brasília.
 * Só se grava na tentativa em que o motor grava `no_answer` (a 3ª do dia). PURA.
 */
export function buildNoAnswerNote(at: Date | string | number, attemptNo: number, max: number = AUTO_DIAL_RULES.maxAttemptsPerDay): string {
  const d = new Date(new Date(at).getTime() - BRT_OFFSET_MS);
  const when = `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)} ${two(d.getUTCHours())}h${two(d.getUTCMinutes())}`;
  return `${when}: não atendeu (tentativa ${attemptNo}/${max}).`;
}
