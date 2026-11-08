import { cloneElement, isValidElement, type ReactElement, type ReactNode, Children } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MeetingDayLead, UpcomingMeetingsData } from '../types';
import { MeetingsTodayCard } from './MeetingsTodayCard';

// jsdom não desenha SVG do Recharts: o AreaChart repassa `data` e o Area
// renderiza um `dot` por ponto, que é o que o card usa para o clique.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => (
    <svg data-testid="area-chart">
      {Children.map(children, (c) =>
        isValidElement(c) ? cloneElement(c as ReactElement<{ __data?: unknown[] }>, { __data: data }) : c,
      )}
    </svg>
  ),
  Area: ({ __data, dot }: { __data?: unknown[]; dot: (p: unknown) => ReactNode }) => (
    <g>{(__data ?? []).map((payload, index) => dot({ cx: 0, cy: 0, payload, index }))}</g>
  ),
  XAxis: () => null,
  YAxis: () => null,
}));

vi.mock('../actions/get-upcoming-meetings', () => ({ getUpcomingMeetings: vi.fn() }));

function lead(id: string, name: string): MeetingDayLead {
  return { leadId: id, razaoSocial: null, nomeFantasia: name, sdrId: 's1', at: '2026-11-01T12:00:00Z', meetingAt: '2026-11-09T13:00:00Z' };
}

function windowFrom(start: string, counts: number[]): UpcomingMeetingsData {
  const base = new Date(`${start}T00:00:00Z`);
  return {
    days: counts.map((n, i) => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      return { date, leads: Array.from({ length: n }, (_, k) => lead(`${date}-${k}`, `Empresa ${date} ${k}`)) };
    }),
  };
}

const sdrNames = new Map([['s1', 'Giovanni']]);

describe('MeetingsTodayCard', () => {
  it('mostra RM/RR de hoje e "—" quando vem null', async () => {
    const load = vi.fn().mockResolvedValue({ success: true, data: windowFrom('2026-11-08', [0, 4, 2]) });
    const { rerender } = render(
      <MeetingsTodayCard todayScheduled={3} todayHeld={1} userIds={[]} sdrNames={sdrNames} load={load} today="2026-11-08" />,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    rerender(
      <MeetingsTodayCard todayScheduled={null} todayHeld={null} userIds={[]} sdrNames={sdrNames} load={load} today="2026-11-08" />,
    );
    expect(screen.getAllByText('—')).toHaveLength(2);
    await waitFor(() => expect(load).toHaveBeenCalled());
  });

  it('clique em RM/RR hoje avisa a página com a série', () => {
    const onTodayClick = vi.fn();
    const load = vi.fn().mockResolvedValue({ success: true, data: windowFrom('2026-11-08', [0, 0, 0]) });
    const { container } = render(
      <MeetingsTodayCard todayScheduled={3} todayHeld={1} onTodayClick={onTodayClick} userIds={[]} sdrNames={sdrNames} load={load} today="2026-11-08" />,
    );
    fireEvent.click(container.querySelector('[data-slot="today-held"]')!);
    expect(onTodayClick).toHaveBeenCalledWith('held');
  });

  it('carrega a janela de hoje e as setas andam 3 dias (sem voltar ao passado)', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: windowFrom('2026-11-08', [0, 4, 2]) })
      .mockResolvedValueOnce({ success: true, data: windowFrom('2026-11-11', [1, 0, 0]) })
      .mockResolvedValueOnce({ success: true, data: windowFrom('2026-11-08', [0, 4, 2]) });
    const { container } = render(
      <MeetingsTodayCard todayScheduled={0} todayHeld={0} userIds={['u1']} sdrNames={sdrNames} load={load} today="2026-11-08" />,
    );

    await waitFor(() => expect(load).toHaveBeenCalledWith({ userIds: ['u1'], startDate: '2026-11-08' }));
    const range = () => container.querySelector('[data-slot="upcoming-range"]')!.textContent;
    expect(range()).toBe('08/11–10/11');
    expect(screen.getByLabelText('Dias anteriores')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Próximos dias'));
    expect(range()).toBe('11/11–13/11');
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ userIds: ['u1'], startDate: '2026-11-11' }));

    fireEvent.click(screen.getByLabelText('Dias anteriores'));
    expect(range()).toBe('08/11–10/11');
  });

  it('clique num ponto abre o painel com os leads daquele dia', async () => {
    const load = vi.fn().mockResolvedValue({ success: true, data: windowFrom('2026-11-08', [0, 2, 1]) });
    const { container } = render(
      <MeetingsTodayCard todayScheduled={0} todayHeld={0} userIds={[]} sdrNames={sdrNames} load={load} today="2026-11-08" />,
    );

    await waitFor(() => expect(container.querySelectorAll('[data-slot="upcoming-dot"]')).toHaveLength(3));
    fireEvent.click(container.querySelectorAll('[data-slot="upcoming-dot"]')[1]!);

    expect(await screen.findByText('Reuniões em SEG 09/11')).toBeInTheDocument();
    expect(screen.getByText('Empresa 2026-11-09 0')).toBeInTheDocument();
    expect(screen.getByText('Empresa 2026-11-09 1')).toBeInTheDocument();
    expect(screen.getAllByText('Giovanni')).toHaveLength(2);
  });

  it('mostra o erro da action', async () => {
    const load = vi.fn().mockResolvedValue({ success: false, error: 'Erro ao buscar as reuniões futuras' });
    render(<MeetingsTodayCard todayScheduled={0} todayHeld={0} userIds={[]} sdrNames={sdrNames} load={load} today="2026-11-08" />);
    expect(await screen.findByText('Erro ao buscar as reuniões futuras')).toBeInTheDocument();
  });
});
