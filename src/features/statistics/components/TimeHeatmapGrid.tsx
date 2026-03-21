'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import type { HeatmapCell } from '../types/call-statistics.types';

interface TimeHeatmapGridProps {
  data: HeatmapCell[];
}

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOUR_LABELS = [
  '00-02h', '02-04h', '04-06h', '06-08h', '08-10h', '10-12h',
  '12-14h', '14-16h', '16-18h', '18-20h', '20-22h', '22-00h',
];

function getIntensityClass(count: number, maxCount: number): string {
  if (count === 0) return 'bg-[var(--muted)]';
  const ratio = count / maxCount;
  if (ratio >= 0.75) return 'bg-primary/90';
  if (ratio >= 0.5) return 'bg-primary/60';
  if (ratio >= 0.25) return 'bg-primary/35';
  return 'bg-primary/15';
}

export function TimeHeatmapGrid({ data }: TimeHeatmapGridProps) {
  const maxCount = Math.max(...data.map((c) => c.count), 1);
  const hasData = data.some((c) => c.count > 0);

  if (!hasData) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhuma ligação no período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Header row */}
        <div className="mb-1 flex">
          <div className="w-10 shrink-0" />
          {HOUR_LABELS.map((label) => (
            <div
              key={label}
              className="flex-1 text-center text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Grid rows */}
        {DAY_LABELS.map((dayLabel, dayIdx) => (
          <div key={dayLabel} className="mb-1 flex items-center">
            <div className="w-10 shrink-0 text-right text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)] pr-2">
              {dayLabel}
            </div>
            {HOUR_LABELS.map((_, blockIdx) => {
              const cell = data.find(
                (c) => c.dayOfWeek === dayIdx && c.hourBlock === blockIdx,
              );
              const count = cell?.count ?? 0;
              return (
                <Tooltip key={`${dayIdx}-${blockIdx}`}>
                  <TooltipTrigger asChild>
                    <div
                      className={`mx-0.5 h-7 flex-1 rounded-sm transition-colors ${getIntensityClass(count, maxCount)}`}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      {dayLabel} {HOUR_LABELS[blockIdx]}: {count} ligações
                    </p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          <span>Menos</span>
          <div className="h-3 w-3 rounded-sm bg-[var(--muted)]" />
          <div className="h-3 w-3 rounded-sm bg-primary/15" />
          <div className="h-3 w-3 rounded-sm bg-primary/35" />
          <div className="h-3 w-3 rounded-sm bg-primary/60" />
          <div className="h-3 w-3 rounded-sm bg-primary/90" />
          <span>Mais</span>
        </div>
      </div>
    </div>
  );
}
