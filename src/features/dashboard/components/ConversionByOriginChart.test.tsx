import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ConversionByOriginEntry } from '../types';
import { ConversionByOriginChart } from './ConversionByOriginChart';

// Mock recharts — jsdom can't render SVG charts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
}));

describe('ConversionByOriginChart', () => {
  it('should render empty state when no data', () => {
    render(<ConversionByOriginChart data={[]} />);
    expect(
      screen.getByText('Sem dados de conversão por origem'),
    ).toBeInTheDocument();
  });

  it('should render chart title', () => {
    const data: ConversionByOriginEntry[] = [
      { origin: 'Inbound', converted: 5, lost: 2 },
    ];
    render(<ConversionByOriginChart data={data} />);
    expect(screen.getByText('Conversão por Origem')).toBeInTheDocument();
  });

  it('should render bar chart component', () => {
    const data: ConversionByOriginEntry[] = [
      { origin: 'Inbound', converted: 5, lost: 2 },
    ];
    render(<ConversionByOriginChart data={data} />);
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('should render responsive container', () => {
    const data: ConversionByOriginEntry[] = [
      { origin: 'Inbound', converted: 5, lost: 2 },
    ];
    render(<ConversionByOriginChart data={data} />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('should have card styling wrapper', () => {
    const data: ConversionByOriginEntry[] = [
      { origin: 'Inbound', converted: 5, lost: 2 },
    ];
    const { container } = render(<ConversionByOriginChart data={data} />);
    const card = container.querySelector('.rounded-lg.border.bg-card');
    expect(card).toBeInTheDocument();
  });
});
