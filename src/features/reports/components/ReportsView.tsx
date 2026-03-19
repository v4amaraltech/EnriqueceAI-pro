'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download, FileText } from 'lucide-react';
import { toast } from 'sonner';

import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import type { CadenceOption, OrgMember } from '@/shared/components/AnalyticsFilters';
import { useDateRange } from '@/shared/hooks/useDateRange';
import { Button } from '@/shared/components/ui/button';
import { useOrganization } from '@/features/auth/hooks/useOrganization';

import type { ReportData, ReportView } from '../reports.contract';
import { cadenceMetricsToCsv, downloadCsv, sdrMetricsToCsv } from '../utils/csv-export';
import { CadenceReport } from './CadenceReport';
import { OverallReport } from './OverallReport';
import { SdrReport } from './SdrReport';

interface ReportsViewProps {
  data: ReportData;
  previousData?: ReportData;
  members: OrgMember[];
  cadences: CadenceOption[];
}

const tabs: { value: ReportView; label: string }[] = [
  { value: 'overall', label: 'Geral' },
  { value: 'cadence', label: 'Por Cadência' },
  { value: 'sdr', label: 'Por SDR' },
];

export function ReportsView({ data, previousData, members, cadences }: ReportsViewProps) {
  const searchParams = useSearchParams();
  const { from, to } = useDateRange('/reports');
  const { organization } = useOrganization();
  const [activeTab, setActiveTab] = useState<ReportView>(
    (searchParams.get('view') as ReportView) ?? 'overall',
  );
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  function handleExportCsv() {
    const dateStr = new Date().toISOString().split('T')[0];
    if (activeTab === 'cadence') {
      const csv = cadenceMetricsToCsv(data.cadenceMetrics);
      downloadCsv(csv, `relatorio-cadencias-${dateStr}.csv`);
    } else if (activeTab === 'sdr') {
      const csv = sdrMetricsToCsv(data.sdrMetrics);
      downloadCsv(csv, `relatorio-sdrs-${dateStr}.csv`);
    }
  }

  async function handleExportPdf() {
    setIsExportingPdf(true);
    try {
      const { exportReportPdf } = await import('../utils/pdf-export');
      await exportReportPdf({
        orgName: organization.name,
        from,
        to,
        data,
        previousData,
      });
      toast.success('PDF exportado com sucesso');
    } catch {
      toast.error('Erro ao gerar PDF');
    } finally {
      setIsExportingPdf(false);
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
          <AnalyticsFilters basePath="/reports" members={members} cadences={cadences}>
            <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={isExportingPdf}>
              <FileText className="mr-2 h-4 w-4" />
              {isExportingPdf ? 'Gerando PDF...' : 'Exportar PDF'}
            </Button>
            {activeTab !== 'overall' && (
              <Button variant="outline" size="sm" onClick={handleExportCsv}>
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
            )}
          </AnalyticsFilters>
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
      {activeTab === 'overall' && (
        <OverallReport
          metrics={data.overallMetrics}
          previousMetrics={previousData?.overallMetrics}
        />
      )}
      {activeTab === 'cadence' && (
        <CadenceReport
          metrics={data.cadenceMetrics}
          previousMetrics={previousData?.cadenceMetrics}
        />
      )}
      {activeTab === 'sdr' && (
        <SdrReport
          metrics={data.sdrMetrics}
          previousMetrics={previousData?.sdrMetrics}
        />
      )}
    </div>
  );
}
