const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: string | null | undefined): value is string {
  return !!value && MONTH_RE.test(value);
}

/** Soma `delta` meses a um `YYYY-MM`. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  const year = Math.floor(idx / 12);
  const mon = (idx % 12) + 1;
  return `${year}-${String(mon).padStart(2, '0')}`;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1] ?? ''} ${y}`;
}

/** Último instante do mês em BRT, como Date (para o cronômetro). */
export function monthEndBrt(month: string): Date {
  const next = shiftMonth(month, 1);
  // 00:00 BRT do 1º dia do mês seguinte = 03:00 UTC.
  return new Date(`${next}-01T03:00:00Z`);
}
