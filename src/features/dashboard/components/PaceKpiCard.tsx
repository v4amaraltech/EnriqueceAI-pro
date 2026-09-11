'use client';

import { HelpCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

import type { PaceStatus } from '../utils/sdr-pace';

const STATUS_STYLE: Record<PaceStatus, { border: string; text: string; bar: string }> = {
  above: { border: 'border-emerald-500/50', text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  'on-track': { border: 'border-emerald-500/40', text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  attention: { border: 'border-amber-500/50', text: 'text-amber-500', bar: 'bg-amber-400' },
  critical: { border: 'border-red-500/50', text: 'text-red-500', bar: 'bg-red-500' },
  neutral: { border: 'border-border', text: 'text-muted-foreground', bar: 'bg-muted-foreground/40' },
};

/** Rodapé dos cards de taxa — "no ritmo" não se aplica a taxa. */
const RATE_FOOTER: Record<PaceStatus, string> = {
  above: 'acima da meta',
  'on-track': 'na meta',
  attention: 'abaixo da meta',
  critical: 'abaixo da meta',
  neutral: '',
};

export interface PaceKpiCardProps {
  label: string;
  /** Valor já formatado ("91", "9%"). */
  value: string;
  /** Meta já formatada; ausente quando não há meta. */
  target?: string;
  /** real ÷ meta (0..1+); `null` sem meta. */
  pct: number | null;
  status: PaceStatus;
  help: string;
  /** Métrica de razão: sem barra, sem "hoje", rodapé "na/abaixo da meta". */
  isRate?: boolean;
  /** Posição do ideal na barra (0..1); `null` = sem marcador. */
  markerFraction?: number | null;
  /** O que falta hoje para fechar o dia no ritmo (ou a cota do dia, se no ritmo). */
  today?: { text: string; onTrack: boolean } | null;
  /** "faltam X" já formatado. */
  remainingText?: string | null;
  /** Ritmo necessário por dia útil até o fim do mês, já formatado. */
  perDayText?: string | null;
  /** real − ideal até ontem, já formatado com sinal (vai no tooltip). */
  paceDelta?: { text: string; positive: boolean } | null;
}

export function PaceKpiCard({
  label,
  value,
  target,
  pct,
  status,
  help,
  isRate = false,
  markerFraction = null,
  today = null,
  remainingText = null,
  perDayText = null,
  paceDelta = null,
}: PaceKpiCardProps) {
  const style = STATUS_STYLE[status];
  const showBar = !isRate && pct !== null;
  const fillPct = Math.max(0, Math.min(1, pct ?? 0)) * 100;

  return (
    <div className={cn('flex flex-col rounded-lg border bg-card p-4', style.border)} data-slot="pace-kpi-card">
      <div className="mb-2 flex min-h-[28px] items-start justify-between gap-2">
        <span className="min-w-0 flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {pct !== null && (
            <span className={cn('text-sm font-bold leading-none', style.text)}>{Math.round(pct * 100)}%</span>
          )}
          <TooltipProvider>
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Sobre ${label}`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
                <div>{help}</div>
                {paceDelta && (
                  <div className="mt-1.5 border-t border-background/20 pt-1.5">
                    <span className="font-semibold">{paceDelta.text} vs ritmo</span>
                    <span className="opacity-80"> (ideal acumulado até ontem, em dias úteis)</span>
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="whitespace-nowrap text-2xl font-bold leading-none text-foreground">{value}</span>
        {target && <span className="whitespace-nowrap text-xs text-muted-foreground">/ {target}</span>}
      </div>

      {showBar && (
        <div className="relative mt-3 h-2 w-full rounded-full bg-muted">
          <div
            className={cn('absolute left-0 top-0 h-full rounded-full transition-all duration-700', style.bar)}
            style={{ width: `${fillPct}%` }}
          />
          {markerFraction !== null && (
            <div
              className="absolute -top-[3px] h-[14px] w-[2px] rounded bg-foreground/70"
              style={{ left: `calc(${markerFraction * 100}% - 1px)` }}
              title={`Ideal até ontem: ${Math.round(markerFraction * 100)}% da meta`}
            />
          )}
        </div>
      )}

      <div className="mt-auto flex min-h-[14px] flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 pt-2 text-[11px] leading-tight">
        {isRate ? (
          <span className={cn('whitespace-nowrap font-semibold', style.text)}>
            {pct !== null ? RATE_FOOTER[status] : 'sem meta'}
          </span>
        ) : today ? (
          <span className={cn('whitespace-nowrap font-semibold', style.text)}>
            {today.onTrack && 'no ritmo · '}hoje: {today.text}
          </span>
        ) : (
          <span className="text-muted-foreground">{pct === null ? 'sem meta' : ''}</span>
        )}
        {remainingText && (
          <span className="whitespace-nowrap text-muted-foreground">
            faltam <span className="font-semibold text-foreground">{remainingText}</span>
            {perDayText && (
              <span title="Ritmo necessário por dia útil daqui até o fim do mês">
                {' · '}
                <span className="font-semibold text-foreground">{perDayText}</span>/dia
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
