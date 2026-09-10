/**
 * Resolve o carimbo de "reunião aconteceu" (`leads.meeting_held_at`).
 *
 * O SDR quase nunca dá o ganho no instante em que a reunião termina — ele marca
 * no fim do dia, ou na manhã seguinte. Carimbar `now()` fazia o registro herdar
 * a data do CLIQUE em vez da data da REUNIÃO: reunião do dia 9 às 16h, ganho no
 * dia 10 às 9h, e o sistema registrava dia 10. Quando o clique caía do outro
 * lado da virada do mês, a reunião era contada no mês errado.
 *
 * Como o sistema já sabe quando a reunião foi — `meeting_starts_at`, derivado da
 * interaction `meeting_scheduled` mais recente do lead —, o carimbo herda essa
 * data. Nada é pedido ao SDR: preencher data à mão é fonte de erro.
 *
 * Fallback em `now()` só quando o lead não tem reunião marcada (ganho sem
 * agendamento no sistema) — aí não há data de evento para herdar.
 *
 * ⚠️ Se a reunião foi remarcada POR FORA (WhatsApp/telefone) e ninguém remarcou
 * no app, `meeting_starts_at` fica no horário antigo e o carimbo herda essa data.
 * Remarcar dentro do app já corrige os dois (trigger `trg_meeting_starts_at`).
 */
export function resolveMeetingHeldAt(
  meetingStartsAt: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!meetingStartsAt) return now.toISOString();

  const startsAt = new Date(meetingStartsAt);
  if (Number.isNaN(startsAt.getTime())) return now.toISOString();

  // Reunião agendada para o futuro: o ganho veio antes da hora do evento (SDR
  // adiantou o registro, ou a reunião foi antecipada por fora). Herdar uma data
  // futura jogaria a reunião para um mês que ainda não aconteceu, então nesse
  // caso o instante do clique é a informação mais confiável que temos.
  if (startsAt.getTime() > now.getTime()) return now.toISOString();

  return startsAt.toISOString();
}
