import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ActivityFilters, defaultFilters } from './ActivityFilters';

describe('ActivityFilters — SDR filter', () => {
  it('hides the SDR dropdown when no options are provided (SDR view)', () => {
    render(
      <ActivityFilters filters={defaultFilters} onFiltersChange={vi.fn()} cadenceOptions={[]} />,
    );
    expect(screen.queryByText('Todos SDRs')).not.toBeInTheDocument();
  });

  it('shows the SDR dropdown when options are provided (manager view)', () => {
    render(
      <ActivityFilters
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        cadenceOptions={[]}
        sdrOptions={[
          { id: 'u1', name: 'João Silva' },
          { id: 'u2', name: 'Maria Souza' },
        ]}
      />,
    );
    // The trigger reflects the selected value ('all' → "Todos SDRs").
    expect(screen.getByText('Todos SDRs')).toBeInTheDocument();
  });
});
