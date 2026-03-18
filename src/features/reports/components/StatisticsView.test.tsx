import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StatisticsData } from '../services/statistics.service';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const emptyData: StatisticsData = {
  lossReasons: [],
  conversionByOrigin: [],
  responseTime: {
    thresholdMinutes: 60,
    overallPct: 0,
    overallCount: 0,
    totalLeads: 0,
    byCadence: [],
  },
};

const populatedData: StatisticsData = {
  lossReasons: [
    { reasonId: 'r1', reasonName: 'Sem budget', count: 10, percentage: 50 },
    { reasonId: 'r2', reasonName: 'Concorrente', count: 10, percentage: 50 },
  ],
  conversionByOrigin: [
    { origin: 'u1', qualified: 5, unqualified: 3, total: 8, conversionRate: 63 },
  ],
  responseTime: {
    thresholdMinutes: 60,
    overallPct: 75,
    overallCount: 15,
    totalLeads: 20,
    byCadence: [
      {
        cadenceId: 'c1',
        cadenceName: 'Cadência A',
        leadsApproached: 10,
        withinThreshold: 8,
        withinThresholdPct: 80,
      },
    ],
  },
};

const members = [
  { userId: 'u1', email: 'joao@test.com' },
  { userId: 'u2', email: 'maria@test.com' },
];

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  CartesianGrid: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
}));

describe('StatisticsView', () => {
  // Lazy import to ensure mocks are set up
  async function renderView(data: StatisticsData) {
    const { StatisticsView } = await import('./StatisticsView');
    return render(<StatisticsView data={data} members={members} />);
  }

  it('renders page title and subtitle', async () => {
    await renderView(emptyData);
    expect(screen.getByText('Estatísticas')).toBeInTheDocument();
    expect(screen.getByText(/Insights de motivos de perda/)).toBeInTheDocument();
  });

  it('renders date range picker', async () => {
    await renderView(emptyData);
    // DateRangePicker trigger shows formatted range with "—"
    const buttons = screen.getAllByRole('button');
    const dateButton = buttons.find((btn) => btn.textContent?.includes('—'));
    expect(dateButton).toBeDefined();
  });

  it('renders user filter dropdown', async () => {
    await renderView(emptyData);
    expect(screen.getByText('Todos os vendedores')).toBeInTheDocument();
  });

  it('renders section headings', async () => {
    await renderView(emptyData);
    expect(screen.getByText('Motivos de Perda')).toBeInTheDocument();
    expect(screen.getByText('Conversão por Origem')).toBeInTheDocument();
    expect(screen.getByText('Tempo de Resposta')).toBeInTheDocument();
  });

  it('renders empty states when no data', async () => {
    await renderView(emptyData);
    expect(screen.getByText(/Nenhum motivo de perda/)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum dado de conversão/)).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma interação registrada/)).toBeInTheDocument();
  });

  it('renders KPI when data is populated', async () => {
    await renderView(populatedData);
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText(/abordados em até 1h/)).toBeInTheDocument();
  });

  it('renders cadence table with data', async () => {
    await renderView(populatedData);
    expect(screen.getByText('Cadência A')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });
});
