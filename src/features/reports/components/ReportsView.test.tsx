import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CadenceMetrics, OverallMetrics, ReportData, SdrMetrics } from '../reports.contract';

import { ReportsView } from './ReportsView';

const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock('./OverallReport', () => ({
  OverallReport: ({ metrics }: any) => (
    <div data-testid="overall-report">{JSON.stringify(metrics)}</div>
  ),
}));

vi.mock('./CadenceReport', () => ({
  CadenceReport: ({ metrics }: any) => (
    <div data-testid="cadence-report">{JSON.stringify(metrics)}</div>
  ),
}));

vi.mock('./SdrReport', () => ({
  SdrReport: ({ metrics }: any) => (
    <div data-testid="sdr-report">{JSON.stringify(metrics)}</div>
  ),
}));

vi.mock('../utils/csv-export', () => ({
  cadenceMetricsToCsv: vi.fn(() => 'csv-data'),
  sdrMetricsToCsv: vi.fn(() => 'csv-data'),
  downloadCsv: vi.fn(),
}));

function makeCadenceMetric(overrides: Partial<CadenceMetrics> = {}): CadenceMetrics {
  return {
    cadenceId: 'c1',
    cadenceName: 'Outbound Q1',
    totalEnrollments: 100,
    sent: 90,
    delivered: 85,
    opened: 45,
    replied: 10,
    bounced: 5,
    meetings: 3,
    openRate: 50,
    replyRate: 11.1,
    bounceRate: 5.6,
    conversionRate: 10,
    ...overrides,
  };
}

function makeSdrMetric(overrides: Partial<SdrMetrics> = {}): SdrMetrics {
  return {
    userId: 'u1',
    userName: 'sdr@enriqueceai.com',
    leadsWorked: 50,
    messagesSent: 120,
    replies: 15,
    meetings: 5,
    conversionRate: 30,
    ...overrides,
  };
}

function makeOverallMetrics(overrides: Partial<OverallMetrics> = {}): OverallMetrics {
  return {
    totalLeads: 200,
    contacted: 120,
    replied: 40,
    meetings: 15,
    qualified: 10,
    funnelSteps: [
      { label: 'Total de Leads', count: 200, percentage: 100, color: '#6366f1' },
      { label: 'Contactados', count: 120, percentage: 60, color: '#8b5cf6' },
      { label: 'Responderam', count: 40, percentage: 20, color: '#a78bfa' },
      { label: 'Reuniões', count: 15, percentage: 7.5, color: '#c4b5fd' },
      { label: 'Qualificados', count: 10, percentage: 5, color: '#ddd6fe' },
    ],
    ...overrides,
  };
}

function makeReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    cadenceMetrics: [makeCadenceMetric()],
    sdrMetrics: [makeSdrMetric()],
    overallMetrics: makeOverallMetrics(),
    ...overrides,
  };
}

describe('ReportsView', () => {
  describe('title and period selector', () => {
    it('renders the page title', () => {
      render(<ReportsView data={makeReportData()} />);

      expect(screen.getByText('Relatórios')).toBeInTheDocument();
    });

    it('renders date range picker trigger with formatted range', () => {
      render(<ReportsView data={makeReportData()} />);

      // DateRangePicker trigger button shows the formatted date range
      const buttons = screen.getAllByRole('button');
      const dateButton = buttons.find((btn) => btn.textContent?.includes('—'));
      expect(dateButton).toBeDefined();
    });
  });

  describe('tab navigation', () => {
    it('renders Geral tab', () => {
      render(<ReportsView data={makeReportData()} />);

      expect(screen.getByRole('button', { name: 'Geral' })).toBeInTheDocument();
    });

    it('renders Por Cadência tab', () => {
      render(<ReportsView data={makeReportData()} />);

      expect(screen.getByRole('button', { name: 'Por Cadência' })).toBeInTheDocument();
    });

    it('renders Por SDR tab', () => {
      render(<ReportsView data={makeReportData()} />);

      expect(screen.getByRole('button', { name: 'Por SDR' })).toBeInTheDocument();
    });
  });

  describe('default tab content', () => {
    it('shows overall report by default', () => {
      render(<ReportsView data={makeReportData()} />);

      expect(screen.getByTestId('overall-report')).toBeInTheDocument();
      expect(screen.queryByTestId('cadence-report')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sdr-report')).not.toBeInTheDocument();
    });

    it('passes overallMetrics to OverallReport', () => {
      const overallMetrics = makeOverallMetrics({ totalLeads: 999 });
      const data = makeReportData({ overallMetrics });
      render(<ReportsView data={data} />);

      const overallReport = screen.getByTestId('overall-report');
      expect(overallReport.textContent).toContain('999');
    });
  });

  describe('tab switching', () => {
    it('switches to cadence report on Por Cadência tab click', () => {
      render(<ReportsView data={makeReportData()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Por Cadência' }));

      expect(screen.getByTestId('cadence-report')).toBeInTheDocument();
      expect(screen.queryByTestId('overall-report')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sdr-report')).not.toBeInTheDocument();
    });

    it('passes cadenceMetrics to CadenceReport', () => {
      const cadenceMetrics = [makeCadenceMetric({ cadenceName: 'Minha Cadência' })];
      const data = makeReportData({ cadenceMetrics });
      render(<ReportsView data={data} />);

      fireEvent.click(screen.getByRole('button', { name: 'Por Cadência' }));

      const cadenceReport = screen.getByTestId('cadence-report');
      expect(cadenceReport.textContent).toContain('Minha Cadência');
    });

    it('switches to sdr report on Por SDR tab click', () => {
      render(<ReportsView data={makeReportData()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Por SDR' }));

      expect(screen.getByTestId('sdr-report')).toBeInTheDocument();
      expect(screen.queryByTestId('overall-report')).not.toBeInTheDocument();
      expect(screen.queryByTestId('cadence-report')).not.toBeInTheDocument();
    });

    it('passes sdrMetrics to SdrReport', () => {
      const sdrMetrics = [makeSdrMetric({ userName: 'vendedor@enriqueceai.com' })];
      const data = makeReportData({ sdrMetrics });
      render(<ReportsView data={data} />);

      fireEvent.click(screen.getByRole('button', { name: 'Por SDR' }));

      const sdrReport = screen.getByTestId('sdr-report');
      expect(sdrReport.textContent).toContain('vendedor@enriqueceai.com');
    });

    it('can switch back to Geral tab after switching away', () => {
      render(<ReportsView data={makeReportData()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Por Cadência' }));
      fireEvent.click(screen.getByRole('button', { name: 'Geral' }));

      expect(screen.getByTestId('overall-report')).toBeInTheDocument();
      expect(screen.queryByTestId('cadence-report')).not.toBeInTheDocument();
    });
  });

  describe('export CSV button', () => {
    it('does not show export button on Geral tab', () => {
      render(<ReportsView data={makeReportData()} />);

      expect(screen.queryByRole('button', { name: /Exportar CSV/ })).not.toBeInTheDocument();
    });

    it('shows export button when on Por Cadência tab', () => {
      render(<ReportsView data={makeReportData()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Por Cadência' }));

      expect(screen.getByRole('button', { name: /Exportar CSV/ })).toBeInTheDocument();
    });

    it('shows export button when on Por SDR tab', () => {
      render(<ReportsView data={makeReportData()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Por SDR' }));

      expect(screen.getByRole('button', { name: /Exportar CSV/ })).toBeInTheDocument();
    });

    it('hides export button after switching back to Geral from cadence tab', () => {
      render(<ReportsView data={makeReportData()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Por Cadência' }));
      fireEvent.click(screen.getByRole('button', { name: 'Geral' }));

      expect(screen.queryByRole('button', { name: /Exportar CSV/ })).not.toBeInTheDocument();
    });

    it('calls cadenceMetricsToCsv and downloadCsv when exporting from cadence tab', async () => {
      const { cadenceMetricsToCsv, downloadCsv } = await import('../utils/csv-export');
      render(<ReportsView data={makeReportData()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Por Cadência' }));
      fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));

      expect(cadenceMetricsToCsv).toHaveBeenCalled();
      expect(downloadCsv).toHaveBeenCalledWith('csv-data', expect.stringContaining('relatorio-cadencias-'));
    });

    it('calls sdrMetricsToCsv and downloadCsv when exporting from sdr tab', async () => {
      const { sdrMetricsToCsv, downloadCsv } = await import('../utils/csv-export');
      render(<ReportsView data={makeReportData()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Por SDR' }));
      fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));

      expect(sdrMetricsToCsv).toHaveBeenCalled();
      expect(downloadCsv).toHaveBeenCalledWith('csv-data', expect.stringContaining('relatorio-sdrs-'));
    });
  });

  describe('date range picker', () => {
    it('renders date range picker with from/to display', () => {
      render(<ReportsView data={makeReportData()} />);

      // The DateRangePicker trigger shows a formatted date range with "—"
      const buttons = screen.getAllByRole('button');
      const dateButton = buttons.find((btn) => btn.textContent?.includes('—'));
      expect(dateButton).toBeDefined();
    });
  });
});
