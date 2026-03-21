'use client';

import type { FunnelStage } from '../types/conversion-analytics.types';

interface ConversionFunnelChartProps {
  stages: FunnelStage[];
  onStageClick?: (stage: FunnelStage) => void;
}

export function ConversionFunnelChart({ stages, onStageClick }: ConversionFunnelChartProps) {
  if (stages.length === 0 || stages[0]?.count === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhum dado de conversão no período.
      </div>
    );
  }

  const maxCount = stages[0]?.count ?? 1;

  return (
    <div className="space-y-3">
      {stages.map((stage) => {
        const widthPct = Math.max(
          safeWidth(stage.count, maxCount),
          10,
        );
        return (
          <div
            key={stage.label}
            className={`flex items-center gap-3 ${onStageClick ? 'cursor-pointer rounded-md px-1 -mx-1 transition-colors hover:bg-[var(--accent)]' : ''}`}
            onClick={() => onStageClick?.(stage)}
          >
            <div className="w-28 shrink-0 text-right text-sm font-medium">
              {stage.label}
            </div>
            <div className="flex-1">
              <div
                className="flex h-10 items-center justify-between rounded-md px-3 text-sm font-medium text-white transition-all"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: stage.color,
                  minWidth: '80px',
                }}
              >
                <span>{stage.count}</span>
                <span className="text-xs opacity-80">{stage.percentage}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function safeWidth(count: number, max: number): number {
  if (max === 0) return 0;
  return Math.round((count / max) * 100);
}
