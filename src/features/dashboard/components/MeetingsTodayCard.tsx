'use client';

import { useEffect, useState, useTransition } from 'react';

import { ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { Skeleton } from '@/shared/components/ui/skeleton';

import type { ActionResult } from '@/lib/actions/action-result';

import { getUpcomingMeetings, type GetUpcomingMeetingsInput } from '../actions/get-upcoming-meetings';
import type { MeetingDaySeries, UpcomingMeetingsData, UpcomingMeetingsDay } from '../types';
import { addDays, shortDate, todayBrt, UPCOMING_WINDOW_DAYS, weekdayLabel } from '../utils/upcoming-days';
import { RM_COLOR, RR_COLOR } from './MeetingsByDayChart';
import { LeadRows } from './MeetingsByDayDrawer';

const HELP =
  'RM hoje: reuniões marcadas hoje pelos SDRs (mesma barra de hoje no gráfico ao lado).\n' +
  'RR hoje: reuniões confirmadas como realizadas hoje.\n' +
  'Os dois só aparecem com o mês atual selecionado.\n\n' +
  'Reuniões futuras: reuniões que COMEÇAM em cada dia (data da reunião, não de quando foi marcada). ' +
  'Fica de fora lead arquivado ou Perdido. Segue o filtro de vendedor; não depende do mês.\n\n' +
  'Clique num número ou num ponto da curva para ver os leads.';

interface MeetingsTodayCardProps {
  /** RM do dia de hoje; `null` quando o filtro não é o mês atual. */
  todayScheduled: number | null;
  /** RR do dia de hoje; `null` quando o filtro não é o mês atual. */
  todayHeld: number | null;
  /** Clique em RM/RR hoje — a página abre o painel do dia (mesmo do gráfico). */
  onTodayClick?: (series: MeetingDaySeries) => void;
  /** Filtro de vendedor da página. */
  userIds: string[];
  /** userId → nome, vindo dos rankings. */
  sdrNames: Map<string, string>;
  /** Fonte dos dados — só pra teste; em produção é a server action. */
  load?: (input: GetUpcomingMeetingsInput) => Promise<ActionResult<UpcomingMeetingsData>>;
  /** Hoje (YYYY-MM-DD BRT) — só pra teste. */
  today?: string;
}

interface ChartPoint {
  date: string;
  count: number;
}

function TodayNumber({
  label,
  value,
  color,
  onClick,
}: {
  label: string;
  value: number | null;
  color: string;
  onClick?: () => void;
}) {
  const clickable = value !== null && Boolean(onClick);
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      title={value === null ? 'Selecione o mês atual' : clickable ? 'Ver os leads' : undefined}
      className="flex flex-col items-start rounded-md px-1 text-left transition-colors enabled:hover:bg-[var(--accent)] disabled:cursor-default"
      data-slot={`today-${label === 'RM hoje' ? 'scheduled' : 'held'}`}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="text-5xl font-bold tabular-nums leading-tight" style={{ color }}>
        {value ?? '—'}
      </span>
    </button>
  );
}

/** Rótulo do eixo X: total do dia em negrito + `DOM 08/11`. */
function DayTick({ x, y, payload, data }: { x?: number; y?: number; payload?: { value?: string }; data: ChartPoint[] }) {
  const date = payload?.value ?? '';
  const count = data.find((p) => p.date === date)?.count ?? 0;
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text dy={14} textAnchor="middle" className="fill-[var(--foreground)]" fontSize={16} fontWeight={700}>
        {count}
      </text>
      <text dy={32} textAnchor="middle" className="fill-[var(--muted-foreground)]" fontSize={11}>
        {weekdayLabel(date)}
      </text>
    </g>
  );
}

export function MeetingsTodayCard({
  todayScheduled,
  todayHeld,
  onTodayClick,
  userIds,
  sdrNames,
  load = getUpcomingMeetings,
  today,
}: MeetingsTodayCardProps) {
  const [baseToday] = useState(() => today ?? todayBrt());
  const [start, setStart] = useState(baseToday);
  const [data, setData] = useState<UpcomingMeetingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [openDay, setOpenDay] = useState<UpcomingMeetingsDay | null>(null);

  const usersKey = userIds.join(',');
  useEffect(() => {
    setError(null);
    startTransition(async () => {
      const res = await load({ userIds, startDate: start });
      if (res.success) setData(res.data);
      else setError(res.error);
    });
    // `userIds` é recriado a cada render; a chave estável é `usersKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, usersKey]);

  const end = addDays(start, UPCOMING_WINDOW_DAYS - 1);
  const points: ChartPoint[] = (data?.days ?? []).map((d) => ({ date: d.date, count: d.leads.length }));
  const maxCount = points.reduce((m, p) => Math.max(m, p.count), 0);
  const gradientId = 'upcoming-meetings-fill';

  const openByDate = (date: string | undefined) => {
    const day = data?.days.find((d) => d.date === date);
    if (day) setOpenDay(day);
  };

  return (
    <>
      <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4" data-slot="meetings-today-card">
        <div className="flex items-start justify-between">
          <div className="flex gap-10">
            <TodayNumber
              label="RM hoje"
              value={todayScheduled}
              color={RM_COLOR}
              onClick={onTodayClick ? () => onTodayClick('scheduled') : undefined}
            />
            <TodayNumber
              label="RR hoje"
              value={todayHeld}
              color={RR_COLOR}
              onClick={onTodayClick ? () => onTodayClick('held') : undefined}
            />
          </div>
          <span title={HELP}>
            <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground" />
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: RM_COLOR }} />
            Reuniões futuras
          </span>
          <div className="flex items-center gap-1 text-sm tabular-nums">
            <button
              type="button"
              aria-label="Dias anteriores"
              disabled={start <= baseToday}
              onClick={() => setStart((s) => addDays(s, -UPCOMING_WINDOW_DAYS))}
              className="rounded p-1 text-muted-foreground transition-colors enabled:hover:bg-[var(--accent)] enabled:hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span data-slot="upcoming-range">
              {shortDate(start)}–{shortDate(end)}
            </span>
            <button
              type="button"
              aria-label="Próximos dias"
              onClick={() => setStart((s) => addDays(s, UPCOMING_WINDOW_DAYS))}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-[var(--accent)] hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-2 min-h-[220px] flex-1">
          {error ? (
            <p className="py-10 text-center text-sm text-[var(--destructive)]">{error}</p>
          ) : isPending || !data ? (
            <Skeleton className="h-full min-h-[220px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%" minHeight={220}>
              <AreaChart data={points} margin={{ top: 16, right: 36, bottom: 8, left: 36 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={RM_COLOR} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={RM_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  height={44}
                  tick={<DayTick data={points} />}
                />
                <YAxis hide domain={[0, Math.max(1, Math.ceil(maxCount * 1.15))]} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={RM_COLOR}
                  strokeWidth={2.5}
                  fill={`url(#${gradientId})`}
                  isAnimationActive={false}
                  dot={(props: { cx?: number; cy?: number; payload?: ChartPoint; index?: number }) => (
                    <circle
                      key={props.payload?.date ?? props.index}
                      cx={props.cx}
                      cy={props.cy}
                      r={7}
                      fill="var(--card)"
                      stroke={RM_COLOR}
                      strokeWidth={3}
                      style={{ cursor: 'pointer' }}
                      data-slot="upcoming-dot"
                      onClick={() => openByDate(props.payload?.date)}
                    >
                      <title>{`${props.payload?.count ?? 0} reunião(ões) — ver leads`}</title>
                    </circle>
                  )}
                  activeDot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <Sheet open={openDay !== null} onOpenChange={(o) => { if (!o) setOpenDay(null); }}>
        <SheetContent side="right" className="sm:max-w-2xl w-full flex flex-col" data-slot="upcoming-meetings-drawer">
          <SheetHeader>
            <SheetTitle>Reuniões em {openDay ? weekdayLabel(openDay.date) : ''}</SheetTitle>
            <SheetDescription asChild>
              <span className="text-sm text-muted-foreground">
                {openDay?.leads.length ?? 0} {openDay?.leads.length === 1 ? 'reunião' : 'reuniões'} começando neste dia
              </span>
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-auto px-4 pb-4">
            {openDay && openDay.leads.length > 0 ? (
              <LeadRows leads={openDay.leads} sdrNames={sdrNames} />
            ) : (
              <p className="py-3 text-sm text-[var(--muted-foreground)]">Nenhuma reunião neste dia</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
