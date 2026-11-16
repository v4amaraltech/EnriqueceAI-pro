import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardTab } from './DashboardTab';

vi.mock('./MonthNav', () => ({ MonthNav: () => <div data-testid="month-nav" /> }));
vi.mock('@/features/dashboard/components/SdrPaceSection', () => ({ SdrPaceSection: () => <div data-testid="pace" /> }));

describe('DashboardTab', () => {
  it('gestor no próprio Cockpit: estado vazio claro, sem seção de ritmo', () => {
    render(<DashboardTab month="2026-11" maxMonth="2026-11" sdrPace={null} managerOwn />);
    expect(screen.getByText('Dashboard de ritmo é por SDR')).toBeTruthy();
    expect(screen.getByText('Escolha um SDR no seletor para ver os números dele.')).toBeTruthy();
    expect(screen.queryByTestId('pace')).toBeNull();
  });

  it('caminho normal (SDR ou gestor vendo um SDR): mostra a seção de ritmo', () => {
    const pace = { month: '2026-11', sdrs: [], selectedUserId: 's1', metrics: null } as never;
    render(<DashboardTab month="2026-11" maxMonth="2026-11" sdrPace={pace} />);
    expect(screen.getByTestId('pace')).toBeTruthy();
    expect(screen.queryByText('Dashboard de ritmo é por SDR')).toBeNull();
  });

  it('sem dados e sem ser gestor próprio: mantém a mensagem de falha de antes', () => {
    render(<DashboardTab month="2026-11" maxMonth="2026-11" sdrPace={null} />);
    expect(screen.getByText('Não foi possível carregar os números do SDR.')).toBeTruthy();
  });
});
