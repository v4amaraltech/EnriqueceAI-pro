/**
 * Feriados nacionais (Brasil) em que o time não tem expediente.
 *
 * Fonte única no app para "dia útil": régua de atraso (`activities/utils/overdue.ts`),
 * janela de envio do motor de cadência e resumo diário do SDR. O banco tem a mesma
 * lista em `public.business_holidays` (usada por `effective_due_brt` e
 * `skip_weekend_brt`) — o teste `br-holidays.test.ts` confere que as duas batem.
 *
 * Para incluir um feriado: adicione aqui E numa migration nova
 * (`INSERT INTO public.business_holidays ... ON CONFLICT DO NOTHING`).
 *
 * Só feriados nacionais obrigatórios. Pontos facultativos (Carnaval, Corpus
 * Christi) ficam de fora até o gestor decidir.
 */
export const BR_NATIONAL_HOLIDAYS: Readonly<Record<string, string>> = {
  '2026-01-01': 'Confraternização Universal',
  '2026-04-03': 'Paixão de Cristo',
  '2026-04-21': 'Tiradentes',
  '2026-05-01': 'Dia do Trabalho',
  '2026-09-07': 'Independência do Brasil',
  '2026-10-12': 'Nossa Senhora Aparecida',
  '2026-11-02': 'Finados',
  '2026-11-15': 'Proclamação da República',
  '2026-11-20': 'Dia Nacional de Zumbi e da Consciência Negra',
  '2026-12-25': 'Natal',
  '2027-01-01': 'Confraternização Universal',
  '2027-03-26': 'Paixão de Cristo',
  '2027-04-21': 'Tiradentes',
  '2027-05-01': 'Dia do Trabalho',
  '2027-09-07': 'Independência do Brasil',
  '2027-10-12': 'Nossa Senhora Aparecida',
  '2027-11-02': 'Finados',
  '2027-11-15': 'Proclamação da República',
  '2027-11-20': 'Dia Nacional de Zumbi e da Consciência Negra',
  '2027-12-25': 'Natal',
  '2028-01-01': 'Confraternização Universal',
  '2028-04-14': 'Paixão de Cristo',
  '2028-04-21': 'Tiradentes',
  '2028-05-01': 'Dia do Trabalho',
  '2028-09-07': 'Independência do Brasil',
  '2028-10-12': 'Nossa Senhora Aparecida',
  '2028-11-02': 'Finados',
  '2028-11-15': 'Proclamação da República',
  '2028-11-20': 'Dia Nacional de Zumbi e da Consciência Negra',
  '2028-12-25': 'Natal',
};

const BRT_OFFSET_MS = 3 * 3600 * 1000; // BRT = UTC-3 fixo (sem horário de verão desde 2019)

/** Data BRT (YYYY-MM-DD) de um instante. */
export function brtDateKey(date: Date): string {
  return new Date(date.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

/** O dia (YYYY-MM-DD, calendário BRT) é feriado nacional? */
export function isBrHoliday(dateKey: string): boolean {
  return dateKey in BR_NATIONAL_HOLIDAYS;
}

/** O dia (YYYY-MM-DD, calendário BRT) é útil: seg–sex e não feriado. */
export function isBrBusinessDay(dateKey: string): boolean {
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !isBrHoliday(dateKey);
}
