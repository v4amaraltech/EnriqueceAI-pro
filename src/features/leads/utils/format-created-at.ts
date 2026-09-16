import { addDaysIso, brtDateIso } from '@/lib/utils/brt-date';

const BRT_TZ = 'America/Sao_Paulo';

const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: BRT_TZ, hour: '2-digit', minute: '2-digit' });
const dayMonthFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: BRT_TZ, day: '2-digit', month: '2-digit' });
const fullFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BRT_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export interface CreatedAtLabel {
  /** Texto curto para a célula: "Hoje 14:32", "Ontem", "há 3 dias", "12/09", "12/09/25". */
  label: string;
  /** Data completa para o tooltip: "12/09/2026 14:32". */
  title: string;
  /** Criado no dia BRT atual — a célula destaca. */
  isToday: boolean;
}

/**
 * Rótulo relativo da coluna "Criado em". Dias comparados em BRT, não no fuso
 * do navegador, para bater com o filtro "Hoje" do servidor.
 */
export function formatCreatedAt(iso: string, now: Date = new Date()): CreatedAtLabel {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: '—', title: '', isToday: false };

  const today = brtDateIso(now);
  const day = brtDateIso(date);
  const title = fullFmt.format(date);

  if (day === today) return { label: `Hoje ${timeFmt.format(date)}`, title, isToday: true };
  if (day === addDaysIso(today, -1)) return { label: 'Ontem', title, isToday: false };

  const diffDays = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000,
  );
  if (diffDays > 1 && diffDays < 7) return { label: `há ${diffDays} dias`, title, isToday: false };

  if (day.slice(0, 4) === today.slice(0, 4)) return { label: dayMonthFmt.format(date), title, isToday: false };
  return { label: `${dayMonthFmt.format(date)}/${day.slice(2, 4)}`, title, isToday: false };
}
