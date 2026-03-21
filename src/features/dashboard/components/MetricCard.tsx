import type { LucideIcon } from 'lucide-react';

import { DeltaIndicator } from '@/shared/components/DeltaIndicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import type { DeltaValue } from '@/shared/utils/comparison';

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  delta?: DeltaValue | null;
  invertDelta?: boolean;
  previousPeriodLabel?: string;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  description,
  delta,
  invertDelta,
  previousPeriodLabel,
}: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{title}</CardTitle>
        <Icon className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-bold">{value}</p>
          {delta !== undefined && (
            <DeltaIndicator
              delta={delta ?? null}
              invertDelta={invertDelta}
              previousPeriodLabel={previousPeriodLabel}
            />
          )}
        </div>
        {description && (
          <p className="text-xs text-[var(--muted-foreground)]">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}
