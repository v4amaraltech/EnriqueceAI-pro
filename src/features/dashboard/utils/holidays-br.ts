/**
 * Feriados brasileiros para o pacing de dias úteis do dashboard.
 *
 * Cobre os feriados NACIONAIS legais (datas fixas), o feriado religioso nacional
 * Sexta-feira Santa, e os pontos facultativos nacionais amplamente observados
 * (Carnaval segunda+terça e Corpus Christi) — dias em que a operação de vendas
 * normalmente não trabalha e que, portanto, não devem inflar a expectativa de
 * ritmo ("no ritmo") nem o cálculo do "ideal até hoje".
 *
 * NÃO cobre feriados estaduais/municipais — para isso seria preciso um cadastro
 * configurável por organização (não existe hoje).
 *
 * BRT é UTC-3 fixo (sem DST desde 2019); as datas são tratadas no calendário
 * civil, alinhado a `pacing.ts`.
 */

/** Feriados nacionais de data fixa, como `'MM-DD'`. */
const FIXED_MMDD = new Set([
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra (nacional desde 2024, Lei 14.759/2023)
  '12-25', // Natal
]);

/**
 * Domingo de Páscoa via algoritmo de Meeus/Jones/Butcher (calendário gregoriano).
 * Retorna mês 1-12 e dia. Base para os feriados móveis.
 */
function easterSunday(year: number): { month1: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month1 = Math.floor((h + l - 7 * m + 114) / 31); // 3 = março, 4 = abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month1, day };
}

/** `'MM-DD'` de uma data deslocada `offsetDays` a partir da Páscoa do ano. */
function easterOffsetMMDD(year: number, offsetDays: number): string {
  const easter = easterSunday(year);
  const dt = new Date(Date.UTC(year, easter.month1 - 1, easter.day + offsetDays));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

// Memoiza o conjunto de feriados por ano — os móveis exigem o cálculo da Páscoa.
const holidayCache = new Map<number, Set<string>>();

/** Conjunto de `'MM-DD'` com todos os feriados (fixos + móveis) do ano. */
function holidayMMDDSet(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const set = new Set(FIXED_MMDD);
  set.add(easterOffsetMMDD(year, -2)); // Sexta-feira Santa
  set.add(easterOffsetMMDD(year, -48)); // Carnaval (segunda)
  set.add(easterOffsetMMDD(year, -47)); // Carnaval (terça)
  set.add(easterOffsetMMDD(year, 60)); // Corpus Christi
  holidayCache.set(year, set);
  return set;
}

/** É feriado nacional (ou ponto facultativo nacional) na data BRT informada? */
export function isHolidayBr(year: number, month1: number, day: number): boolean {
  const mmdd = `${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return holidayMMDDSet(year).has(mmdd);
}
