'use client';

import { BarChart3, Mail, MessageSquare, Target, Users } from 'lucide-react';

import { DeltaIndicator } from '@/shared/components/DeltaIndicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { calculateDelta } from '@/shared/utils/comparison';

import type { OverallMetrics } from '../reports.contract';

interface OverallReportProps {
  metrics: OverallMetrics;
  previousMetrics?: OverallMetrics;
}

const metricIcons = [Users, Mail, MessageSquare, Target, BarChart3];

export function OverallReport({ metrics, previousMetrics }: OverallReportProps) {
  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {metrics.funnelSteps.map((step, i) => {
          const Icon = metricIcons[i] ?? Users;
          const prevStep = previousMetrics?.funnelSteps[i];
          const delta = prevStep ? calculateDelta(step.count, prevStep.count) : null;
          return (
            <Card key={step.label}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-[var(--muted-foreground)]" />
                  <span className="text-xs text-[var(--muted-foreground)]">{step.label}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <p className="text-2xl font-bold">{step.count}</p>
                  <DeltaIndicator delta={delta} />
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">{step.percentage}%</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Funnel visualization */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funil de Conversão</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {metrics.funnelSteps.map((step) => (
              <div key={step.label} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{step.label}</span>
                  <span className="font-medium">
                    {step.count} ({step.percentage}%)
                  </span>
                </div>
                <div className="h-6 w-full rounded-md bg-[var(--muted)]">
                  <div
                    className={`h-full rounded-md ${step.color} transition-all`}
                    style={{ width: `${Math.max(step.percentage, 1)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
