import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardData, DashboardFilters, InsightsData, RankingData } from '../types';
import { DashboardView } from './DashboardView';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/dashboard',
}));

// Mock useOrganization
vi.mock('@/features/auth/hooks/useOrganization', () => ({
  useOrganization: () => ({
    members: [
      { user_id: 'u-1', role: 'admin', status: 'active' },
      { user_id: 'u-2', role: 'member', status: 'active' },
    ],
    org: { id: 'org-1', name: 'Test Org' },
    isManager: true,
  }),
}));

// Mock recharts — jsdom can't render SVG charts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  Line: () => <div data-testid="line" />,
  Bar: () => <div data-testid="bar" />,
  Area: () => <div data-testid="area" />,
  Scatter: () => <div data-testid="scatter" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
  ReferenceLine: () => <div />,
}));

// Mock GoalsModal to avoid action imports in DashboardView tests
vi.mock('./GoalsModal', () => ({
  GoalsModal: () => <div data-testid="goals-modal" />,
}));

const defaultFilters: DashboardFilters = {
  month: '2026-02',
  cadenceIds: [],
  userIds: [],
};

function createData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    kpi: {
      totalOpportunities: 42,
      monthTarget: 100,
      conversionTarget: 15,
      percentOfTarget: -20,
      currentDay: 15,
      daysInMonth: 28,
      dailyData: [
        { date: '2026-02-01', day: 1, actual: 2, target: 4 },
        { date: '2026-02-02', day: 2, actual: 5, target: 7 },
      ],
    },
    availableCadences: [
      { id: 'cad-1', name: 'Cadência Inbound' },
      { id: 'cad-2', name: 'Cadência Outbound' },
    ],
    ...overrides,
  };
}

describe('DashboardView', () => {
  it('should render KPI card with total opportunities', () => {
    render(<DashboardView data={createData()} filters={defaultFilters} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(/Oportunidades em Fevereiro/)).toBeInTheDocument();
  });

  it('should render target info when target > 0', () => {
    render(<DashboardView data={createData()} filters={defaultFilters} />);
    expect(screen.getByText(/Meta de oportunidades/)).toBeInTheDocument();
  });

  it('should render percent below indicator', () => {
    render(<DashboardView data={createData()} filters={defaultFilters} />);
    expect(screen.getByText(/20% abaixo do previsto até hoje/)).toBeInTheDocument();
  });

  it('should render percent above indicator when positive', () => {
    const data = createData({
      kpi: {
        ...createData().kpi,
        percentOfTarget: 15,
      },
    });
    render(<DashboardView data={data} filters={defaultFilters} />);
    expect(screen.getByText(/15% acima do previsto até hoje/)).toBeInTheDocument();
  });

  it('should render no target message when monthTarget is 0', () => {
    const data = createData({
      kpi: {
        ...createData().kpi,
        monthTarget: 0,
        percentOfTarget: 0,
      },
    });
    render(<DashboardView data={data} filters={defaultFilters} />);
    expect(screen.getByText(/Nenhuma meta definida/)).toBeInTheDocument();
  });

  it('should render "Editar metas" button (enabled)', () => {
    render(<DashboardView data={createData()} filters={defaultFilters} />);
    const btn = screen.getByRole('button', { name: 'Editar metas' });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('should render chart section', () => {
    render(<DashboardView data={createData()} filters={defaultFilters} />);
    expect(screen.getByTestId('composed-chart')).toBeInTheDocument();
  });

  it('should render month selector with current month', () => {
    render(<DashboardView data={createData()} filters={defaultFilters} />);
    expect(screen.getByText('fevereiro 2026')).toBeInTheDocument();
  });

  it('should render cadence filter dropdown', () => {
    render(<DashboardView data={createData()} filters={defaultFilters} />);
    expect(screen.getByText('2 cadências')).toBeInTheDocument();
  });

  it('should render user filter dropdown when multiple members', () => {
    render(<DashboardView data={createData()} filters={defaultFilters} />);
    expect(screen.getByText('2 vendedores')).toBeInTheDocument();
  });

  it('should render empty chart state when no data points', () => {
    const data = createData({
      kpi: {
        ...createData().kpi,
        dailyData: [],
      },
    });
    render(<DashboardView data={data} filters={defaultFilters} />);
    expect(
      screen.getByText('Sem dados para exibir'),
    ).toBeInTheDocument();
  });

  it('should render insights charts when insights prop is provided', () => {
    const insights: InsightsData = {
      lossReasons: [{ reason: 'Sem orçamento', count: 5, percent: 100 }],
      conversionByOrigin: [{ origin: 'Inbound', converted: 3, lost: 1 }],
    };
    const { container } = render(
      <DashboardView
        data={createData()}
        filters={defaultFilters}
        insights={insights}
      />,
    );
    expect(
      container.querySelector('[data-slot="insights-charts"]'),
    ).toBeInTheDocument();
    expect(screen.getByText('Motivos de Perda')).toBeInTheDocument();
    expect(screen.getByText('Conversão por Origem')).toBeInTheDocument();
  });

  it('should not render insights section when insights prop is absent', () => {
    const { container } = render(
      <DashboardView data={createData()} filters={defaultFilters} />,
    );
    expect(
      container.querySelector('[data-slot="insights-charts"]'),
    ).not.toBeInTheDocument();
  });

  it('should render ranking cards when ranking prop is provided', () => {
    const ranking: RankingData = {
      leadsFinished: {
        total: 10,
        monthTarget: 20,
        percentOfTarget: -25,
        averagePerSdr: 5,
        sdrBreakdown: [],
      },
      activitiesDone: {
        total: 50,
        monthTarget: 100,
        percentOfTarget: -10,
        averagePerSdr: 25,
        sdrBreakdown: [],
      },
      conversionRate: {
        total: 30,
        monthTarget: 40,
        percentOfTarget: -5,
        averagePerSdr: 30,
        sdrBreakdown: [],
      },
      leadsOpened: {
        total: 0,
        monthTarget: 0,
        percentOfTarget: 0,
        averagePerSdr: 0,
        sdrBreakdown: [],
      },
      meetingsScheduled: {
        total: 0,
        monthTarget: 0,
        percentOfTarget: 0,
        averagePerSdr: 0,
        sdrBreakdown: [],
      },
      meetingsHeld: {
        total: 0,
        monthTarget: 0,
        percentOfTarget: 0,
        averagePerSdr: 0,
        sdrBreakdown: [],
      },
      hitRate: {
        total: 0,
        monthTarget: 0,
        percentOfTarget: 0,
        averagePerSdr: 0,
        sdrBreakdown: [],
      },
      leadsToOpen: {
        total: 0,
        monthTarget: 0,
        percentOfTarget: 0,
        averagePerSdr: 0,
        sdrBreakdown: [],
      },
    };
    const { container } = render(
      <DashboardView
        data={createData()}
        filters={defaultFilters}
        ranking={ranking}
      />,
    );
    expect(
      container.querySelector('[data-slot="ranking-cards"]'),
    ).toBeInTheDocument();
    expect(screen.getByText('Leads Finalizados')).toBeInTheDocument();
    expect(screen.getByText('Atividades Realizadas')).toBeInTheDocument();
    expect(screen.getByText('Taxa de Conversão')).toBeInTheDocument();
  });

  it('should not render ranking section when ranking prop is absent', () => {
    const { container } = render(
      <DashboardView data={createData()} filters={defaultFilters} />,
    );
    expect(
      container.querySelector('[data-slot="ranking-cards"]'),
    ).not.toBeInTheDocument();
  });
});
