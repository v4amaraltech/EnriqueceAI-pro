'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';

import { DateRangePicker } from '@/shared/components/DateRangePicker';
import { useDateRange } from '@/shared/hooks/useDateRange';
import { Button } from '@/shared/components/ui/button';

import type { ReportData, ReportView } from '../reports.contract';
import { cadenceMetricsToCsv, downloadCsv, sdrMetricsToCsv } from '../utils/csv-export';
import { CadenceReport } from './CadenceReport';
import { OverallReport } from './OverallReport';
import { SdrReport } from './SdrReport';

interface ReportsViewProps {
  data: ReportData;
}

const tabs: { value: ReportView; label: string }[] = [
  { value: 'overall', label: 'Geral' },
  { value: 'cadence', label: 'Por Cadência' },
  { value: 'sdr', label: 'Por SDR' },
];

export function ReportsView({ data }: ReportsViewProps) {
  const searchParams = useSearchParams();
  const { from, to, setRange } = useDateRange('/reports');
  const [activeTab, setActiveTab] = useState<ReportView>(
    (searchParams.get('view') as ReportView) ?? 'overall',
  );

  function handleExport() {
    const dateStr = new Date().toISOString().split('T')[0];
    if (activeTab === 'cadence') {
      const csv = cadenceMetricsToCsv(data.cadenceMetrics);
      downloadCsv(csv, `relatorio-cadencias-${dateStr}.csv`);
    } else if (activeTab === 'sdr') {
      const csv = sdrMetricsToCsv(data.sdrMetrics);
      downloadCsv(csv, `relatorio-sdrs-${dateStr}.csv`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Relatórios</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Analise o desempenho das campanhas, SDRs e funil de conversão.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker from={from} to={to} onChange={setRange} />
          {activeTab !== 'overall' && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? 'border-b-2 border-[var(--foreground)] text-[var(--foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overall' && <OverallReport metrics={data.overallMetrics} />}
      {activeTab === 'cadence' && <CadenceReport metrics={data.cadenceMetrics} />}
      {activeTab === 'sdr' && <SdrReport metrics={data.sdrMetrics} />}
    </div>
  );
}
