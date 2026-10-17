/**
 * Quais cadências entram na fila de trabalho dos humanos (Atividades, contador e discador).
 *
 * - auto_email: o motor de e-mail automático envia sozinho.
 * - executor 'bdr_ai': a Ana (IA) executa os passos — ligação pelo V4 Call, e-mail e WhatsApp pelo n8n.
 *   Se o passo aparecesse também na fila do SDR, o humano poderia ligar ou escrever para o mesmo lead
 *   no mesmo passo que a Ana (contato duplicado).
 */
export const EXECUTOR_IA = 'bdr_ai';

export function entraNaFilaHumana(cadencia: { type?: string | null; executor?: string | null }): boolean {
  return cadencia.type !== 'auto_email' && cadencia.executor !== EXECUTOR_IA;
}
