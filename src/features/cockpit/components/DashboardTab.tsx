'use client';

import { SdrPaceSection } from '@/features/dashboard/components/SdrPaceSection';
import type { SdrPaceData } from '@/features/dashboard/types';

import { MonthNav } from './MonthNav';

interface DashboardTabProps {
  month: string;
  maxMonth: string;
  sdrPace: SdrPaceData | null;
}

/**
 * Números do SDR exibido no mês: a seção "SDR selecionado" do /dashboard
 * (realizado × meta do próprio SDR). Os cards de KPI do time ficam de fora
 * porque mostram a meta da organização, não a do SDR.
 */
export function DashboardTab({ month, maxMonth, sdrPace }: DashboardTabProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Dashboard</h2>
        <MonthNav month={month} maxMonth={maxMonth} />
      </div>

      {sdrPace ? (
        <SdrPaceSection data={sdrPace} hideSelector />
      ) : (
        <p className="text-muted-foreground text-sm">Não foi possível carregar os números do SDR.</p>
      )}
    </div>
  );
}
