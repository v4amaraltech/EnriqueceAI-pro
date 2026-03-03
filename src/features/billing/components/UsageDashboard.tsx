'use client';

import { AlertTriangle, Bot, Database, MessageSquare, Users } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Progress } from '@/shared/components/ui/progress';

import { isNearLimit } from '../services/feature-flags';
import type { UsageDashboardData } from '../types';
import { AiUsageChart } from './AiUsageChart';

interface UsageDashboardProps {
  data: UsageDashboardData;
}

interface UsageBarProps {
  label: string;
  current: number;
  max: number;
  unlimited?: boolean;
  overageLabel?: string;
}

function UsageBar({ label, current, max, unlimited, overageLabel }: UsageBarProps) {
  const percentage = unlimited ? 0 : max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const nearLimit = !unlimited && isNearLimit(current, max);
  const exceeded = !unlimited && max > 0 && current >= max;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-[var(--muted-foreground)]">
          {unlimited ? (
            `${current} (ilimitado)`
          ) : (
            <>
              {current} / {max}
              {overageLabel && <span className="ml-1 text-amber-600">({overageLabel})</span>}
            </>
          )}
        </span>
      </div>
      {!unlimited && (
        <div className="flex items-center gap-2">
          <Progress
            value={percentage}
            className={exceeded ? '[&>[data-slot=progress-indicator]]:bg-red-500' : nearLimit ? '[&>[data-slot=progress-indicator]]:bg-amber-500' : ''}
          />
          {(nearLimit || exceeded) && (
            <AlertTriangle className="size-4 shrink-0 text-amber-500" />
          )}
        </div>
      )}
    </div>
  );
}

export function UsageDashboard({ data }: UsageDashboardProps) {
  const { limits, plan, aiHistory } = data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consumo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Leads */}
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" />
            <div className="flex-1">
              <UsageBar
                label="Leads"
                current={limits.leads.current}
                max={limits.leads.max}
              />
            </div>
          </div>

          {/* AI */}
          <div className="flex items-start gap-3">
            <Bot className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" />
            <div className="flex-1">
              <UsageBar
                label="IA (hoje)"
                current={limits.aiPerDay.current}
                max={limits.aiPerDay.max}
                unlimited={limits.aiPerDay.unlimited}
              />
            </div>
          </div>

          {/* WhatsApp */}
          <div className="flex items-start gap-3">
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" />
            <div className="flex-1">
              <UsageBar
                label="WhatsApp (mês)"
                current={limits.whatsappPerMonth.current}
                max={limits.whatsappPerMonth.max}
              />
            </div>
          </div>

          {/* Members */}
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" />
            <div className="flex-1">
              <UsageBar
                label="Membros"
                current={limits.users.current}
                max={limits.users.included}
                overageLabel={limits.users.additional > 0 ? `+${limits.users.additional} adicional` : undefined}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Usage Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uso de IA — Últimos 30 dias</CardTitle>
        </CardHeader>
        <CardContent>
          <AiUsageChart data={aiHistory} dailyLimit={plan.max_ai_per_day} />
        </CardContent>
      </Card>
    </div>
  );
}
