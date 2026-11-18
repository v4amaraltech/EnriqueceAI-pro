'use client';

import { BarChart3 } from 'lucide-react';

import { EmptyState } from '@/shared/components/EmptyState';

import { SdrPaceSection } from '@/features/dashboard/components/SdrPaceSection';
import type { SdrPaceData } from '@/features/dashboard/types';

import { MonthNav } from './MonthNav';

interface DashboardTabProps {
  month: string;
  maxMonth: string;
  sdrPace: SdrPaceData | null;
  /** Gestor no próprio Cockpit: o ritmo é por SDR, então não há números a mostrar. */
  managerOwn?: boolean;
}

/**
 * Números do SDR exibido no mês: a seção "SDR selecionado" do /dashboard
 * (realizado × meta do próprio SDR). Os cards de KPI do time ficam de fora
 * porque mostram a meta da organização, não a do SDR.
 */
export function DashboardTab({ month, maxMonth, sdrPace, managerOwn = false }: DashboardTabProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Dashboard</h2>
        <MonthNav month={month} maxMonth={maxMonth} />
      </div>

      {managerOwn ? (
        <EmptyState
          icon={BarChart3}
          title="Dashboard de ritmo é por SDR"
          description="Escolha um SDR no seletor para ver os números dele."
        />
      ) : sdrPace ? (
        <SdrPaceSection data={sdrPace} hideSelector />
      ) : (
        <p className="text-muted-foreground text-sm">Não foi possível carregar os números do SDR.</p>
      )}
    </div>
  );
}
