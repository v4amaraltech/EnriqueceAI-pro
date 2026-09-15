import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MeetingsByDayPoint } from '../utils/meetings-by-day';
import { MeetingsByDayChart } from './MeetingsByDayChart';

// Mock recharts — jsdom can't render SVG charts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  // Bar clicável: simula o Recharts entregando o ponto da série no onClick.
  Bar: ({
    children,
    name,
    onClick,
  }: {
    children?: React.ReactNode;
    name?: string;
    onClick?: (item: { payload: { day: number } }) => void;
  }) => (
    <div data-testid="bar" data-name={name} onClick={() => onClick?.({ payload: { day: 14 } })}>
      {children}
    </div>
  ),
  Line: () => <div data-testid="line" />,
  LabelList: () => <div data-testid="label-list" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
}));

function point(day: number, scheduled: number | null, held: number | null): MeetingsByDayPoint {
  return {
    day,
    label: `${String(day).padStart(2, '0')}/09`,
    scheduled,
    held,
    trendScheduled: scheduled,
    trendHeld: held,
  };
}

describe('MeetingsByDayChart', () => {
  it('renderiza o título', () => {
    render(<MeetingsByDayChart data={[point(1, 2, 1)]} />);
    expect(
      screen.getByText('Reuniões marcadas (RM) e realizadas (RR) por dia'),
    ).toBeInTheDocument();
  });

  it('renderiza duas barras e duas linhas de tendência', () => {
    render(<MeetingsByDayChart data={[point(1, 2, 1), point(2, 0, 3)]} />);
    expect(screen.getAllByTestId('bar')).toHaveLength(2);
    expect(screen.getAllByTestId('line')).toHaveLength(2);
    expect(screen.getAllByTestId('label-list')).toHaveLength(2);
  });

  it('renderiza a legenda com os 4 itens', () => {
    render(<MeetingsByDayChart data={[point(1, 2, 1)]} />);
    expect(screen.getByText('Marcadas (RM)')).toBeInTheDocument();
    expect(screen.getByText('Realizadas (RR)')).toBeInTheDocument();
    expect(screen.getByText('Tend. RM')).toBeInTheDocument();
    expect(screen.getByText('Tend. RR')).toBeInTheDocument();
  });

  it('mostra estado vazio quando não há reuniões', () => {
    render(<MeetingsByDayChart data={[point(1, 0, 0), point(2, null, null)]} />);
    expect(screen.getByText('Sem reuniões no período')).toBeInTheDocument();
    expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Expandir')).not.toBeInTheDocument();
  });

  it('tem o botão de expandir quando há dados', () => {
    render(<MeetingsByDayChart data={[point(1, 1, 0)]} />);
    expect(screen.getByTitle('Expandir')).toBeInTheDocument();
  });

  it('clicar numa barra chama onBarClick com o dia e a série', () => {
    const onBarClick = vi.fn();
    render(<MeetingsByDayChart data={[point(14, 9, 6)]} onBarClick={onBarClick} />);
    const [rm, rr] = screen.getAllByTestId('bar');
    fireEvent.click(rm!);
    expect(onBarClick).toHaveBeenCalledWith(14, 'scheduled');
    fireEvent.click(rr!);
    expect(onBarClick).toHaveBeenCalledWith(14, 'held');
  });

  it('sem onBarClick o clique não quebra', () => {
    render(<MeetingsByDayChart data={[point(14, 9, 6)]} />);
    expect(() => fireEvent.click(screen.getAllByTestId('bar')[0]!)).not.toThrow();
  });
});
