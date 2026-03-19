'use client';

import { BarChart3, Mail, MessageSquare, Target, Users } from 'lucide-react';

import { DeltaIndicator } from '@/shared/components/DeltaIndicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { calculateDelta } from '@/shared/utils/comparison';

import type { DrilldownMetric } from '@/shared/components/drilldown/drilldown.types';

import type { OverallMetrics } from '../reports.contract';

interface OverallReportProps {
  metrics: OverallMetrics;
  previousMetrics?: OverallMetrics;
  onMetricClick?: (metric: DrilldownMetric) => void;
}

const metricIcons = [Users, Mail, MessageSquare, Target, BarChart3];

const FUNNEL_METRICS: DrilldownMetric[] = [
  'overall_leads',
  'overall_contacted',
  'overall_replied',
  'overall_meetings',
  'overall_qualified',
];

export function OverallReport({ metrics, previousMetrics, onMetricClick }: OverallReportProps) {
  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {metrics.funnelSteps.map((step, i) => {
          const Icon = metricIcons[i] ?? Users;
          const prevStep = previousMetrics?.funnelSteps[i];
          const delta = prevStep ? calculateDelta(step.count, prevStep.count) : null;
          const drilldownMetric = FUNNEL_METRICS[i];
          return (
            <Card
              key={step.label}
              className={onMetricClick && drilldownMetric ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}
              onClick={() => onMetricClick && drilldownMetric && onMetricClick(drilldownMetric)}
            >
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
            {metrics.funnelSteps.map((step, i) => {
              const drilldownMetric = FUNNEL_METRICS[i];
              return (
                <div
                  key={step.label}
                  className={`space-y-1 ${onMetricClick && drilldownMetric ? 'cursor-pointer rounded-md px-1 -mx-1 transition-colors hover:bg-[var(--accent)]' : ''}`}
                  onClick={() => onMetricClick && drilldownMetric && onMetricClick(drilldownMetric)}
                >
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
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
