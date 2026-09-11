import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions/get-sdr-pace-data', () => ({ getSdrPaceMetrics: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import type { SdrPaceData } from '../types';
import { SdrPaceSection } from './SdrPaceSection';

const DATA: SdrPaceData = {
  month: '2026-09',
  sdrs: [
    { userId: '00000000-0000-0000-0000-000000000001', userName: 'Matheus Martins' },
    { userId: '00000000-0000-0000-0000-000000000002', userName: 'João Fogaça' },
  ],
  selectedUserId: '00000000-0000-0000-0000-000000000001',
  metrics: {
    actual: { leadsOpened: 91, meetingsScheduled: 4, meetingsHeld: 3, calls: 834, callsConnected: 46 },
    target: { leadsOpened: 300, meetingsScheduled: 20, meetingsHeld: 15, calls: 2200, callsConnected: 176 },
  },
};

function card(label: string) {
  const el = screen.getByText(label).closest('[data-slot="pace-kpi-card"]');
  if (!el) throw new Error(`card ${label} não encontrado`);
  return within(el as HTMLElement);
}

describe('SdrPaceSection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('mostra o SDR selecionado e os 7 cards com a leitura do Sales Hub', () => {
    render(<SdrPaceSection data={DATA} />);

    expect(screen.getByText('SDR selecionado')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'SDR selecionado' })).toHaveTextContent('Matheus Martins');
    expect(document.querySelectorAll('[data-slot="pace-kpi-card"]')).toHaveLength(7);

    const leads = card('Leads Abertos');
    expect(leads.getByText('91')).toBeInTheDocument();
    expect(leads.getByText('/ 300')).toBeInTheDocument();
    expect(leads.getByText('30%')).toBeInTheDocument();
    expect(leads.getByText(/hoje: 24/)).toBeInTheDocument();
    expect(leads.getByText('209')).toBeInTheDocument();

    const calls = card('Total de Ligações');
    expect(calls.getByText('834')).toBeInTheDocument();
    expect(calls.getByText('/ 2.200')).toBeInTheDocument();
    expect(calls.getByText('1.366')).toBeInTheDocument();

    const conv = card('Conectada p/ Marcada');
    expect(conv.getByText('9%')).toBeInTheDocument();
    expect(conv.getByText('/ 11%')).toBeInTheDocument();
    expect(conv.getByText('abaixo da meta')).toBeInTheDocument();

    const rate = card('% de Conectadas');
    expect(rate.getByText('6%')).toBeInTheDocument();
    expect(rate.getByText('/ 8%')).toBeInTheDocument();
  });

  it('meta 0 → card sem meta, sem %', () => {
    render(
      <SdrPaceSection
        data={{ ...DATA, metrics: { ...DATA.metrics!, target: { ...DATA.metrics!.target, calls: 0, callsConnected: 0 } } }}
      />,
    );
    const calls = card('Total de Ligações');
    expect(calls.getByText('sem meta')).toBeInTheDocument();
    expect(calls.queryByText('%', { exact: false })).not.toBeInTheDocument();
    expect(card('% de Conectadas').getByText('sem meta')).toBeInTheDocument();
  });

  it('não renderiza nada quando a org não tem SDR', () => {
    const { container } = render(<SdrPaceSection data={{ ...DATA, sdrs: [], selectedUserId: null, metrics: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
