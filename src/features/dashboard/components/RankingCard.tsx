'use client';

import type { LucideIcon } from 'lucide-react';
import { HelpCircle, TrendingDown, TrendingUp } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

import type { RankingCardData } from '../types';

const AVATAR_COLORS = [
  'bg-blue-500 text-white',
  'bg-emerald-500 text-white',
  'bg-amber-500 text-white',
  'bg-rose-500 text-white',
  'bg-violet-500 text-white',
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface RankingCardProps {
  title: string;
  titleTooltip?: string;
  icon: LucideIcon;
  iconColor?: string;
  iconTextColor?: string;
  unit?: string;
  data: RankingCardData;
  primaryColumnLabel?: string;
  primaryColumnTooltip?: string;
  primaryValueDivisor?: number;
  secondaryColumnLabel?: string;
  /** Rótulo da coluna "ideal até hoje" (pace por dia útil sem feriados). */
  idealColumnLabel?: string;
  idealColumnTooltip?: string;
  averageLabel?: string;
  onSdrClick?: (userId: string) => void;
}

interface RankingContentProps {
  icon: LucideIcon;
  iconColor: string;
  iconTextColor: string;
  unit: string;
  data: RankingCardData;
  primaryColumnLabel?: string;
  primaryColumnTooltip?: string;
  primaryValueDivisor?: number;
  secondaryColumnLabel?: string;
  idealColumnLabel?: string;
  idealColumnTooltip?: string;
  averageLabel?: string;
  onSdrClick?: (userId: string) => void;
}

function RankingContent({
  icon: Icon,
  iconColor,
  iconTextColor,
  unit,
  data,
  primaryColumnLabel,
  primaryColumnTooltip,
  primaryValueDivisor,
  secondaryColumnLabel,
  idealColumnLabel,
  idealColumnTooltip,
  averageLabel,
  onSdrClick,
}: RankingContentProps) {
  const isAbove = data.percentOfTarget >= 0;
  const absPercent = Math.abs(data.percentOfTarget);
  // Só mostra a coluna "ideal dia" quando há valor calculado — seja o
  // compartilhado (meta org ÷ SDRs) ou um ideal individual por SDR (cards de
  // reuniões, meta em goals_per_user).
  const showIdeal =
    Boolean(idealColumnLabel) &&
    (data.idealToDate != null || data.sdrBreakdown.some((s) => s.idealToDate != null));

  return (
    <>
      {/* Icon Badge + Big Number — centered */}
      <div className="flex flex-col items-center px-6 pb-2 pt-5">
        <div className={cn('flex h-14 w-14 items-center justify-center rounded-full', iconColor)}>
          <Icon className={cn('h-7 w-7', iconTextColor)} />
        </div>

        <p className="mt-4 text-4xl font-bold">
          {data.total}
          {unit}
        </p>

        {/* % + Meta inline */}
        {data.monthTarget > 0 ? (
          <div className="mt-3 flex items-center gap-3">
            <div
              className={cn(
                'flex items-center gap-1 text-xs font-medium',
                isAbove ? 'text-emerald-600' : 'text-red-500',
              )}
            >
              {isAbove ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              <span>
                {absPercent}% do previsto
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              Meta mês: <span className="font-semibold text-foreground">{data.monthTarget}{unit}</span>
            </span>
          </div>
        ) : null}
      </div>

      {/* SDR Breakdown */}
      {data.sdrBreakdown.length > 0 && (
        <>
          {/* Column Headers */}
          <div className="mx-6 mt-4 border-t pb-2 pt-4">
            <div className="mb-3 flex items-center text-[11px] font-medium text-muted-foreground">
              <span className="flex-1" />
              {secondaryColumnLabel && (
                <span className="w-20 text-center">{secondaryColumnLabel}</span>
              )}
              {showIdeal && (
                <span className="w-20 text-center inline-flex items-center justify-center gap-1 whitespace-nowrap">
                  {idealColumnLabel}
                  {idealColumnTooltip && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 opacity-50" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                          {idealColumnTooltip}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </span>
              )}
              {primaryColumnLabel && (
                <span className="w-24 text-center inline-flex items-center justify-center gap-1 whitespace-nowrap">
                  {primaryColumnLabel}
                  {primaryColumnTooltip && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 opacity-50" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[200px] text-xs">
                          {primaryColumnTooltip}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </span>
              )}
            </div>

            {/* SDR List */}
            <div className="space-y-3">
              {data.sdrBreakdown.map((sdr, index) => (
                <div
                  key={sdr.userId}
                  className={cn('flex items-center', onSdrClick && 'cursor-pointer rounded-md px-1 -mx-1 py-0.5 hover:bg-[var(--accent)] transition-colors')}
                  onClick={() => onSdrClick?.(sdr.userId)}
                  role={onSdrClick ? 'button' : undefined}
                  tabIndex={onSdrClick ? 0 : undefined}
                  onKeyDown={onSdrClick ? (e) => { if (e.key === 'Enter') onSdrClick(sdr.userId); } : undefined}
                >
                  <Avatar size="sm" className="mr-3 shrink-0">
                    {sdr.avatarUrl && <AvatarImage src={sdr.avatarUrl} alt={sdr.userName} />}
                    <AvatarFallback
                      className={cn(
                        'text-[10px] font-medium',
                        AVATAR_COLORS[index % AVATAR_COLORS.length],
                      )}
                    >
                      {getInitials(sdr.userName || '?')}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate text-sm">
                    {sdr.userName || sdr.userId.slice(0, 8)}
                  </span>
                  {secondaryColumnLabel && (
                    <span className="w-20 text-center text-sm text-muted-foreground">
                      {sdr.secondaryValue ?? '—'}
                    </span>
                  )}
                  {showIdeal && (
                    <span className="w-20 text-center text-sm text-muted-foreground">
                      {(() => {
                        const ideal = sdr.idealToDate ?? data.idealToDate;
                        return ideal != null ? `${ideal}${unit}` : '—';
                      })()}
                    </span>
                  )}
                  {primaryColumnLabel && (
                    <span className="w-24 text-center text-sm font-medium">
                      {primaryValueDivisor && primaryValueDivisor > 0
                        ? Math.round(sdr.value / primaryValueDivisor)
                        : sdr.value}
                      {unit}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Footer — Average */}
          {averageLabel && (
            <div className="mt-auto border-t border-dashed mx-6 px-0 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-emerald-600">média</p>
                  <p className="text-xs text-muted-foreground">{averageLabel}</p>
                </div>
                <span className="text-lg font-bold text-emerald-600">
                  {data.averagePerSdr}
                  {unit}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Bottom spacing when no breakdown */}
      {data.sdrBreakdown.length === 0 && (
        <div className="mx-6 mb-6 mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed py-6">
          <p className="text-xs text-muted-foreground">Nenhum dado individual disponível</p>
        </div>
      )}
    </>
  );
}

export function RankingCard({
  title,
  titleTooltip,
  icon: Icon,
  iconColor = 'bg-primary/10',
  iconTextColor = 'text-primary',
  unit = '',
  data,
  primaryColumnLabel,
  primaryColumnTooltip,
  primaryValueDivisor,
  secondaryColumnLabel,
  idealColumnLabel,
  idealColumnTooltip,
  averageLabel,
  onSdrClick,
}: RankingCardProps) {
  const contentProps: RankingContentProps = {
    icon: Icon,
    iconColor,
    iconTextColor,
    unit,
    data,
    primaryColumnLabel,
    primaryColumnTooltip,
    primaryValueDivisor,
    secondaryColumnLabel,
    idealColumnLabel,
    idealColumnTooltip,
    averageLabel,
    onSdrClick,
  };

  return (
    <div className="flex flex-col rounded-lg border bg-card">
      {/* Title */}
      <div className="px-6 pt-6">
        <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
          {title}
          {titleTooltip && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[280px] text-xs whitespace-pre-line">
                  {titleTooltip}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </h3>
      </div>

      <RankingContent {...contentProps} />
    </div>
  );
}
