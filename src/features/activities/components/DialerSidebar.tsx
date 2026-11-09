'use client';

import { AlertTriangle, Ban, Clock, Phone, Users } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import type { DialerPreferences, DialerStats } from '../schemas/dialer-preferences.schemas';

interface DialerSidebarProps {
  preferences: DialerPreferences;
  stats: DialerStats;
}

export function DialerSidebar({ preferences, stats }: DialerSidebarProps) {
  return (
    <div className="w-full space-y-6 lg:w-[280px]">
      {/* Leads fora da fila */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Ban className="h-4 w-4" />
          Leads fora da fila
        </h3>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex cursor-help items-center gap-1.5 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  <Phone className="h-3 w-3" />
                  Sem telefone
                </span>
              </TooltipTrigger>
              <TooltipContent>Leads com passo de ligacao pendente mas sem telefone cadastrado</TooltipContent>
            </Tooltip>
            <Badge variant="outline" className="border-orange-300 bg-orange-50 text-xs text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-300">
              {stats.leadsWithoutPhone}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex cursor-help items-center gap-1.5 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  <AlertTriangle className="h-3 w-3" />
                  Limite diario atingido
                </span>
              </TooltipTrigger>
              <TooltipContent>Leads que ja foram chamados {preferences.daily_limit_per_lead}x hoje</TooltipContent>
            </Tooltip>
            <Badge variant="secondary" className="text-xs">{stats.leadsAtDailyLimit}</Badge>
          </div>

          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex cursor-help items-center gap-1.5 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  <Clock className="h-3 w-3" />
                  Snooze ativo
                </span>
              </TooltipTrigger>
              <TooltipContent>Leads com snooze ativo (em breve)</TooltipContent>
            </Tooltip>
            <Badge variant="secondary" className="text-xs">{stats.leadsWithSnooze}</Badge>
          </div>
        </div>
      </div>

      {/* Leads na fila */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" />
          Leads na fila
        </h3>

        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Total disponivel</span>
          <Badge className="bg-green-100 text-xs text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-200">
            {stats.totalAvailable}
          </Badge>
        </div>
      </div>
    </div>
  );
}
