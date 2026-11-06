/**
 * Conversão entre o "Dia N" da tela de cadência e o `cadence_steps.delay_days`.
 *
 * O motor (trigger `calculate_next_step_due`, fila de atividades, admissão BDR)
 * trata `delay_days` como ATRASO RELATIVO: o passo vence `delay_days` dias
 * depois de o passo anterior ser concluído (o primeiro, depois da inscrição).
 *
 * A tela mostra os passos agrupados por "Dia N" desde o início da cadência.
 * Esse dia é só exibição: é o acumulado dos atrasos (Dia 1 = dia da inscrição).
 * Ao salvar, cada passo grava a diferença para o passo anterior — o primeiro
 * passo de cada dia leva o salto de dias, os demais do mesmo dia gravam 0.
 *
 * Fim de semana (o motor joga para segunda) e atraso na execução do passo
 * anterior empurram as datas reais; o "Dia N" é o plano em dias corridos.
 */

/** Dia de exibição de cada passo (1 = dia da inscrição), na ordem recebida. */
export function cumulativeDays(steps: ReadonlyArray<{ delay_days: number }>): number[] {
  let day = 1;
  return steps.map((s) => {
    day += Math.max(0, s.delay_days);
    return day;
  });
}

/**
 * Agrupa passos (já em `step_order`) por dia acumulado. Passos consecutivos no
 * mesmo dia ficam juntos; a ordem dos passos nunca muda.
 */
export function groupStepsByDay<T extends { delay_days: number }>(steps: readonly T[]): Array<{ day: number; steps: T[] }> {
  const days = cumulativeDays(steps);
  const groups: Array<{ day: number; steps: T[] }> = [];
  steps.forEach((step, i) => {
    const day = days[i]!;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.steps.push(step);
    else groups.push({ day, steps: [step] });
  });
  return groups;
}

/**
 * Atraso relativo a gravar para cada passo, a partir dos dias da tela (em ordem
 * crescente). Devolve uma lista por dia, um valor por passo.
 */
export function relativeDelaysForDays(days: ReadonlyArray<{ day: number; stepCount: number }>): number[][] {
  let previousDay = 1;
  return days.map(({ day, stepCount }) => {
    const delays = Array.from({ length: stepCount }, (_, i) => (i === 0 ? Math.max(0, day - previousDay) : 0));
    if (stepCount > 0) previousDay = day;
    return delays;
  });
}
