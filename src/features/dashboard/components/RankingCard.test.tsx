import { render, screen } from '@testing-library/react';
import { Activity, TrendingUp, Users } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import type { RankingCardData } from '../types';
import { RankingCard } from './RankingCard';

function createCardData(overrides: Partial<RankingCardData> = {}): RankingCardData {
  return {
    total: 25,
    monthTarget: 50,
    percentOfTarget: -20,
    averagePerSdr: 12.5,
    sdrBreakdown: [
      { userId: 'aaaa1111-0000-0000-0000-000000000001', userName: 'João Silva', value: 15, secondaryValue: 3 },
      { userId: 'bbbb2222-0000-0000-0000-000000000002', userName: 'Maria Santos', value: 10 },
    ],
    ...overrides,
  };
}

describe('RankingCard', () => {
  it('should render title and total', () => {
    render(
      <RankingCard
        title="Leads Finalizados"
        icon={Users}
        data={createCardData()}
        primaryColumnLabel="finalizados"
      />,
    );
    expect(screen.getByText('Leads Finalizados')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('should render target info', () => {
    render(
      <RankingCard
        title="Atividades"
        icon={Activity}
        data={createCardData()}
        primaryColumnLabel="atividades"
      />,
    );
    expect(screen.getByText(/Meta mês:/)).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('should render percent below indicator', () => {
    render(
      <RankingCard title="Test" icon={Users} data={createCardData()} />,
    );
    expect(screen.getByText(/20% do previsto/)).toBeInTheDocument();
  });

  it('should render percent above indicator', () => {
    render(
      <RankingCard
        title="Test"
        icon={Users}
        data={createCardData({ percentOfTarget: 15 })}
      />,
    );
    expect(screen.getByText(/15% do previsto/)).toBeInTheDocument();
  });

  it('should show "Sem meta" when no target', () => {
    render(
      <RankingCard
        title="Test"
        icon={Users}
        data={createCardData({ monthTarget: 0 })}
      />,
    );
    expect(screen.getByText('Sem meta definida')).toBeInTheDocument();
  });

  it('should render SDR breakdown with avatars', () => {
    render(
      <RankingCard
        title="Test"
        icon={Users}
        data={createCardData()}
        primaryColumnLabel="finalizados"
      />,
    );
    expect(screen.getByText('João Silva')).toBeInTheDocument();
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
    // Avatars show initials
    expect(screen.getByText('JS')).toBeInTheDocument();
    expect(screen.getByText('MS')).toBeInTheDocument();
  });

  it('should render column headers when labels provided', () => {
    render(
      <RankingCard
        title="Leads"
        icon={Users}
        data={createCardData()}
        primaryColumnLabel="finalizados"
        secondaryColumnLabel="prospectando"
      />,
    );
    expect(screen.getByText('finalizados')).toBeInTheDocument();
    expect(screen.getByText('prospectando')).toBeInTheDocument();
  });

  it('should render average when averageLabel provided', () => {
    render(
      <RankingCard
        title="Test"
        icon={Users}
        data={createCardData()}
        averageLabel="média finalizados/vendedor"
      />,
    );
    expect(screen.getByText('média finalizados/vendedor')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
  });

  it('should render with unit suffix', () => {
    render(
      <RankingCard
        title="Conversão"
        icon={TrendingUp}
        unit="%"
        data={createCardData({ total: 42 })}
        primaryColumnLabel="oportunidades"
      />,
    );
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('should hide breakdown when no SDRs', () => {
    render(
      <RankingCard
        title="Test"
        icon={Users}
        data={createCardData({ sdrBreakdown: [] })}
      />,
    );
    expect(screen.queryByText('JS')).not.toBeInTheDocument();
  });
});
