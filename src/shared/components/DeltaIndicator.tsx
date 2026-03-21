import { TrendingDown, TrendingUp } from 'lucide-react';

import type { DeltaValue } from '@/shared/utils/comparison';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

interface DeltaIndicatorProps {
  delta: DeltaValue | null;
  /** When true, inverts colors (down = green, up = red). Useful for bounce rate. */
  invertDelta?: boolean;
  previousPeriodLabel?: string;
}

export function DeltaIndicator({
  delta,
  invertDelta = false,
  previousPeriodLabel,
}: DeltaIndicatorProps) {
  if (!delta) return null;

  const isUp = delta.direction === 'up';
  const isDown = delta.direction === 'down';
  const isNeutral = delta.direction === 'neutral';

  const isPositive = invertDelta ? isDown : isUp;
  const isNegative = invertDelta ? isUp : isDown;

  const colorClass = isPositive
    ? 'text-green-600'
    : isNegative
      ? 'text-red-600'
      : 'text-[var(--muted-foreground)] dark:text-[var(--foreground)]';

  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : null;

  const percentageText =
    delta.percentage !== null
      ? `${delta.percentage > 0 ? '+' : ''}${delta.percentage}%`
      : isUp
        ? 'Novo'
        : '0%';

  const tooltipText = previousPeriodLabel
    ? `${previousPeriodLabel}: ${delta.previousValue}`
    : `Período anterior: ${delta.previousValue}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-0.5 text-xs ${colorClass}`}
            data-testid="delta-indicator"
          >
            {Icon && <Icon className="h-3 w-3" />}
            {isNeutral ? '—' : percentageText}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
