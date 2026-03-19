import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnalyticsFilters } from '../AnalyticsFilters';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

const mockMembers = [
  { userId: 'u1', email: 'alice@test.com' },
  { userId: 'u2', email: 'bob@test.com' },
];

const mockCadences = [
  { id: 'c1', name: 'Outbound Q1' },
  { id: 'c2', name: 'Inbound' },
];

describe('AnalyticsFilters', () => {
  it('renders SDR select with all members', () => {
    render(<AnalyticsFilters basePath="/reports" members={mockMembers} />);

    const sdrSelect = screen.getByDisplayValue('Todos os vendedores');
    expect(sdrSelect).toBeInTheDocument();

    const options = sdrSelect.querySelectorAll('option');
    // "Todos os vendedores" + 2 members
    expect(options).toHaveLength(3);
    expect(options[1]!.textContent).toBe('alice');
    expect(options[2]!.textContent).toBe('bob');
  });

  it('renders cadence select when cadences provided', () => {
    render(
      <AnalyticsFilters basePath="/reports" members={mockMembers} cadences={mockCadences} />,
    );

    const cadenceSelect = screen.getByDisplayValue('Todas as cadências');
    expect(cadenceSelect).toBeInTheDocument();

    const options = cadenceSelect.querySelectorAll('option');
    expect(options).toHaveLength(3);
    expect(options[1]!.textContent).toBe('Outbound Q1');
  });

  it('does not render cadence select when cadences not provided', () => {
    render(<AnalyticsFilters basePath="/reports" members={mockMembers} />);

    expect(screen.queryByDisplayValue('Todas as cadências')).not.toBeInTheDocument();
  });

  it('updates URL with sdr param on SDR selection', () => {
    render(<AnalyticsFilters basePath="/reports" members={mockMembers} />);

    const sdrSelect = screen.getByDisplayValue('Todos os vendedores');
    fireEvent.change(sdrSelect, { target: { value: 'u1' } });

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('sdr=u1'));
  });

  it('updates URL with cadence param on cadence selection', () => {
    render(
      <AnalyticsFilters basePath="/reports" members={mockMembers} cadences={mockCadences} />,
    );

    const cadenceSelect = screen.getByDisplayValue('Todas as cadências');
    fireEvent.change(cadenceSelect, { target: { value: 'c1' } });

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('cadence=c1'));
  });

  it('renders children slot', () => {
    render(
      <AnalyticsFilters basePath="/reports" members={mockMembers}>
        <button>Export PDF</button>
      </AnalyticsFilters>,
    );

    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeInTheDocument();
  });
});
