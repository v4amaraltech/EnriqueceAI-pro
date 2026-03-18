'use client';

import { ArrowRight } from 'lucide-react';

import { DeltaIndicator } from '@/shared/components/DeltaIndicator';
import { Card, CardContent } from '@/shared/components/ui/card';
import { calculateDelta } from '@/shared/utils/comparison';

import type { StageConversion } from '../types/conversion-analytics.types';

interface StageToStageCardsProps {
  conversions: StageConversion[];
  previousConversions?: StageConversion[];
}

export function StageToStageCards({ conversions, previousConversions }: StageToStageCardsProps) {
  if (conversions.length === 0) {
    return null;
  }

  const prevMap = new Map(
    previousConversions?.map((c) => [`${c.from}-${c.to}`, c]),
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {conversions.map((conv) => {
        const prev = prevMap.get(`${conv.from}-${conv.to}`);
        const delta = prev ? calculateDelta(conv.rate, prev.rate) : null;
        return (
          <Card key={`${conv.from}-${conv.to}`}>
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                <span className="truncate">{conv.from}</span>
                <ArrowRight className="h-3 w-3 shrink-0" />
                <span className="truncate">{conv.to}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold">{conv.rate}%</p>
                <DeltaIndicator delta={delta} />
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                {conv.numerator} de {conv.denominator}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
