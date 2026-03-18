import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DateRangePicker } from './DateRangePicker';

const mockOnChange = vi.fn();

function today(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
function daysAgo(n: number): string {
  return format(subDays(new Date(), n), 'yyyy-MM-dd');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DateRangePicker', () => {
  it('renders trigger button with formatted date range', () => {
    render(
      <DateRangePicker from="2026-03-01" to="2026-03-15" onChange={mockOnChange} />,
    );

    const from = format(new Date('2026-03-01T00:00:00'), 'dd MMM yyyy', { locale: ptBR });
    const to = format(new Date('2026-03-15T00:00:00'), 'dd MMM yyyy', { locale: ptBR });

    expect(screen.getByRole('button')).toHaveTextContent(`${from} — ${to}`);
  });

  it('shows presets and calendar when opened', async () => {
    const user = userEvent.setup();
    render(
      <DateRangePicker from={daysAgo(30)} to={today()} onChange={mockOnChange} />,
    );

    await user.click(screen.getByRole('button'));

    expect(screen.getByText('Hoje')).toBeInTheDocument();
    expect(screen.getByText('7 dias')).toBeInTheDocument();
    expect(screen.getByText('30 dias')).toBeInTheDocument();
    expect(screen.getByText('90 dias')).toBeInTheDocument();
  });

  it('calls onChange with preset range when preset clicked', async () => {
    const user = userEvent.setup();
    render(
      <DateRangePicker from={daysAgo(30)} to={today()} onChange={mockOnChange} />,
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('7 dias'));

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    const [fromArg, toArg] = mockOnChange.mock.calls[0] as [string, string];
    expect(fromArg).toBe(daysAgo(7));
    expect(toArg).toBe(today());
  });

  it('calls onChange with today preset (same-day range)', async () => {
    const user = userEvent.setup();
    render(
      <DateRangePicker from={daysAgo(30)} to={today()} onChange={mockOnChange} />,
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('Hoje'));

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    const [fromArg, toArg] = mockOnChange.mock.calls[0] as [string, string];
    expect(fromArg).toBe(today());
    expect(toArg).toBe(today());
  });

  it('renders calendar icon', () => {
    render(
      <DateRangePicker from={daysAgo(7)} to={today()} onChange={mockOnChange} />,
    );

    const button = screen.getByRole('button');
    const svg = button.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
