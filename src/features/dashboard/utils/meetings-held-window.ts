/**
 * Janela de "Reuniões realizadas" — fonte ÚNICA para o KPI do painel e para o
 * ranking. Os dois precisam aplicar exatamente a mesma regra, senão voltam a
 * divergir sob filtro de SDR.
 *
 * A reunião conta no mês em que ACONTECEU:
 *  - com evento registrado → pelo horário do evento (`meeting_starts_at`), e só
 *    depois que ele passou. Ganho dado antes da hora (SDR adiantou o registro)
 *    carimba `meeting_held_at` antes do evento; sem o teto em "agora", a reunião
 *    entraria no total antes de acontecer e o número grande deixaria de bater
 *    com o último ponto do gráfico (que só vai até hoje).
 *  - sem evento registrado (ganho sem agendamento pelo app) → pelo carimbo
 *    (`meeting_held_at`). É o mesmo fallback de `resolveMeetingHeldAt`: sem ele
 *    esses ganhos sumiam de todos os meses.
 *
 * `meeting_held_at` não nulo continua sendo a PROVA de que a reunião aconteceu —
 * aplicar `.not('meeting_held_at', 'is', null)` junto com este filtro.
 */
export function meetingsHeldWindowFilter(start: string, end: string, nowIso: string): string {
  return [
    `and(meeting_starts_at.gte.${start},meeting_starts_at.lt.${end},meeting_starts_at.lte.${nowIso})`,
    `and(meeting_starts_at.is.null,meeting_held_at.gte.${start},meeting_held_at.lt.${end})`,
  ].join(',');
}

/** Instante em que a reunião conta na série diária — mesma regra do filtro. */
export function meetingHeldAnchor(lead: {
  meeting_starts_at: string | null;
  meeting_held_at: string;
}): string {
  return lead.meeting_starts_at ?? lead.meeting_held_at;
}
