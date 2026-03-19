import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DrilldownState } from './drilldown.types';

import { DrilldownDrawer } from './DrilldownDrawer';

const baseColumns = [
  { key: 'razaoSocial', label: 'Empresa' },
  { key: 'email', label: 'Email' },
];

function makeState(overrides: Partial<DrilldownState> = {}): DrilldownState {
  return {
    isOpen: false,
    metric: null,
    filters: null,
    data: [],
    total: 0,
    page: 1,
    isLoading: false,
    title: 'Leads Trabalhados',
    columns: baseColumns,
    open: vi.fn(),
    close: vi.fn(),
    goToPage: vi.fn(),
    ...overrides,
  };
}

describe('DrilldownDrawer', () => {
  it('renders nothing when isOpen is false', () => {
    render(<DrilldownDrawer {...makeState({ isOpen: false })} />);
    expect(screen.queryByText('Leads Trabalhados')).not.toBeInTheDocument();
  });

  it('renders title and data when isOpen is true', () => {
    const data = [
      { id: '1', leadId: 'l1', razaoSocial: 'Acme Corp', email: 'a@a.com' },
      { id: '2', leadId: 'l2', razaoSocial: 'Beta Inc', email: 'b@b.com' },
    ];
    render(<DrilldownDrawer {...makeState({ isOpen: true, data, total: 2 })} />);

    expect(screen.getByText('Leads Trabalhados')).toBeInTheDocument();
    expect(screen.getByText('2 resultados')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Beta Inc')).toBeInTheDocument();
  });

  it('renders skeleton when loading', () => {
    render(<DrilldownDrawer {...makeState({ isOpen: true, isLoading: true })} />);

    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders empty state when no data', () => {
    render(<DrilldownDrawer {...makeState({ isOpen: true, data: [], total: 0 })} />);

    expect(screen.getByText('Nenhum resultado encontrado.')).toBeInTheDocument();
  });

  it('renders lead link with correct href', () => {
    const data = [
      { id: '1', leadId: 'lead-123', razaoSocial: 'Acme Corp', email: 'a@a.com' },
    ];
    render(<DrilldownDrawer {...makeState({ isOpen: true, data, total: 1 })} />);

    const link = screen.getByRole('link', { name: 'Acme Corp' });
    expect(link).toHaveAttribute('href', '/leads/lead-123');
  });

  it('renders pagination and calls goToPage', async () => {
    const goToPage = vi.fn();
    const data = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      razaoSocial: `Lead ${i}`,
      email: `e${i}@t.com`,
    }));
    render(
      <DrilldownDrawer
        {...makeState({ isOpen: true, data, total: 50, page: 1, goToPage })}
      />,
    );

    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();

    const nextBtn = screen.getByRole('button', { name: /Próximo/ });
    await userEvent.click(nextBtn);
    expect(goToPage).toHaveBeenCalledWith(2);
  });

  it('disables Anterior button on first page', () => {
    const data = [{ id: '1', razaoSocial: 'Acme', email: 'a@a.com' }];
    render(
      <DrilldownDrawer
        {...makeState({ isOpen: true, data, total: 50, page: 1 })}
      />,
    );

    const prevBtn = screen.getByRole('button', { name: /Anterior/ });
    expect(prevBtn).toBeDisabled();
  });

  it('disables Próximo button on last page', () => {
    const data = [{ id: '1', razaoSocial: 'Acme', email: 'a@a.com' }];
    render(
      <DrilldownDrawer
        {...makeState({ isOpen: true, data, total: 25, page: 1 })}
      />,
    );

    const nextBtn = screen.getByRole('button', { name: /Próximo/ });
    expect(nextBtn).toBeDisabled();
  });
});
