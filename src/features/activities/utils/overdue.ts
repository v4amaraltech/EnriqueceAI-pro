/**
 * Shared "atrasada" definition. Tocar aqui muda 4 lugares de uma vez:
 * - Badge vermelho no card da fila (ActivityRow)
 * - Filtro "Atrasadas" na queue (ActivityQueueView)
 * - Filtro "Atrasadas" no log (fetch-activity-log)
 * - Card "Atividades Atrasadas" no dashboard (fetchOverdueActivitiesRanking)
 *
 * Histórico: começou em 1h. Subiu pra 4h em 26/05/2026 a pedido do
 * Vinicius — SDRs estavam vendo o card cheio demais, sem espaço de
 * manobra pra organizar o dia. 4h dá folga de uma manhã/tarde antes do
 * "vermelho" aparecer.
 */
export const OVERDUE_THRESHOLD_HOURS = 4;
export const OVERDUE_THRESHOLD_MS = OVERDUE_THRESHOLD_HOURS * 60 * 60 * 1000;
