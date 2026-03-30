'use client';

import { useState } from 'react';

import type { LucideIcon } from 'lucide-react';
import { Maximize2, TrendingDown, TrendingUp } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

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
  icon: LucideIcon;
  iconColor?: string;
  iconTextColor?: string;
  unit?: string;
  data: RankingCardData;
  primaryColumnLabel?: string;
  secondaryColumnLabel?: string;
  averageLabel?: string;
}

interface RankingContentProps {
  icon: LucideIcon;
  iconColor: string;
  iconTextColor: string;
  unit: string;
  data: RankingCardData;
  primaryColumnLabel?: string;
  secondaryColumnLabel?: string;
  averageLabel?: string;
}

function RankingContent({
  icon: Icon,
  iconColor,
  iconTextColor,
  unit,
  data,
  primaryColumnLabel,
  secondaryColumnLabel,
  averageLabel,
}: RankingContentProps) {
  const isAbove = data.percentOfTarget >= 0;
  const absPercent = Math.abs(data.percentOfTarget);

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
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">Sem meta definida</p>
        )}
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
              {primaryColumnLabel && (
                <span className="w-20 text-center">{primaryColumnLabel}</span>
              )}
            </div>

            {/* SDR List */}
            <div className="space-y-3">
              {data.sdrBreakdown.map((sdr, index) => (
                <div key={sdr.userId} className="flex items-center">
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
                  {primaryColumnLabel && (
                    <span className="w-20 text-center text-sm font-medium">
                      {sdr.value}
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
  icon: Icon,
  iconColor = 'bg-primary/10',
  iconTextColor = 'text-primary',
  unit = '',
  data,
  primaryColumnLabel,
  secondaryColumnLabel,
  averageLabel,
}: RankingCardProps) {
  const [expanded, setExpanded] = useState(false);

  const contentProps: RankingContentProps = {
    icon: Icon,
    iconColor,
    iconTextColor,
    unit,
    data,
    primaryColumnLabel,
    secondaryColumnLabel,
    averageLabel,
  };

  return (
    <>
      <div className="flex flex-col rounded-lg border bg-card">
        {/* Title */}
        <div className="flex items-center justify-between px-6 pt-6">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
            title="Expandir"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>

        <RankingContent {...contentProps} />
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <RankingContent {...contentProps} />
        </DialogContent>
      </Dialog>
    </>
  );
}
