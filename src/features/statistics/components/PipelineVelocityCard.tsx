'use client';

import { Timer } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

import type { PipelineVelocity } from '../types/conversion-analytics.types';

interface PipelineVelocityCardProps {
  velocity: PipelineVelocity;
}

export function PipelineVelocityCard({ velocity }: PipelineVelocityCardProps) {
  if (velocity.totalQualified === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Velocidade do Pipeline
          </CardTitle>
          <Timer className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Sem dados de qualificação no período.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Velocidade do Pipeline
        </CardTitle>
        <Timer className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-2xl font-bold">{velocity.avgDaysToQualification}</p>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">dias (média)</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{velocity.medianDaysToQualification}</p>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">dias (mediana)</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{velocity.totalQualified}</p>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">qualificados</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
