import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CadenceRow } from '../types';
import { CadenceListView } from './CadenceListView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('../actions/manage-cadences', () => ({
  activateCadence: vi.fn(),
  createCadence: vi.fn(),
  deleteCadence: vi.fn(),
  updateCadence: vi.fn(),
}));

const defaultTabCounts = { standard: 5, auto_email: 2 };

function createCadence(overrides: Partial<CadenceRow> = {}): CadenceRow {
  return {
    id: 'cad-1',
    org_id: 'org-1',
    name: 'Follow Up Inicial',
    description: 'Cadência de primeiro contato',
    status: 'draft',
    priority: 'medium',
    origin: 'outbound',
    type: 'standard',
    total_steps: 3,
    auto_loss_after_days: null,
    auto_loss_reason_id: null,
    created_by: 'user-1',
    created_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-02-15T10:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('CadenceListView', () => {
  it('should render header with title', () => {
    render(
      <CadenceListView
        cadences={[createCadence()]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText(/Exibindo 1 cadência/)).toBeInTheDocument();
  });

  it('should show plural count for multiple cadences', () => {
    render(
      <CadenceListView
        cadences={[createCadence(), createCadence({ id: 'cad-2', name: 'Reengajamento' })]}
        total={2}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText(/Exibindo todas as 2 cadências/)).toBeInTheDocument();
  });

  it('should render cadence card with name', () => {
    render(
      <CadenceListView
        cadences={[createCadence()]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText('Follow Up Inicial')).toBeInTheDocument();
  });

  it('should show cadence description', () => {
    render(
      <CadenceListView
        cadences={[createCadence()]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText('Cadência de primeiro contato')).toBeInTheDocument();
  });

  it('should show step count', () => {
    render(
      <CadenceListView
        cadences={[createCadence()]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText('3 passos')).toBeInTheDocument();
  });

  it('should show singular step count', () => {
    render(
      <CadenceListView
        cadences={[createCadence({ total_steps: 1 })]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText('1 passo')).toBeInTheDocument();
  });

  it('should show status badge for draft', () => {
    render(
      <CadenceListView
        cadences={[createCadence({ status: 'draft' })]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText('Rascunho')).toBeInTheDocument();
  });

  it('should show status badge for active', () => {
    render(
      <CadenceListView
        cadences={[createCadence({ status: 'active' })]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText('Ativa')).toBeInTheDocument();
  });

  it('should show empty state when no cadences', () => {
    render(
      <CadenceListView
        cadences={[]}
        total={0}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText('Nenhuma cadência encontrada')).toBeInTheDocument();
  });

  it('should show "Criar nova" button', () => {
    render(
      <CadenceListView
        cadences={[createCadence()]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText('Criar nova')).toBeInTheDocument();
  });

  it('should render tabs with badge counts', () => {
    render(
      <CadenceListView
        cadences={[createCadence()]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={{ standard: 10, auto_email: 3 }}
      />,
    );
    expect(screen.getByText('Padrão')).toBeInTheDocument();
    expect(screen.getByText('E-mail Automático')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should render priority icon on cadence card', () => {
    render(
      <CadenceListView
        cadences={[createCadence({ priority: 'high' })]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByLabelText('Prioridade Alta')).toBeInTheDocument();
  });

  it('should render priority filter select', () => {
    render(
      <CadenceListView
        cadences={[createCadence()]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    // Priority filter select renders with compact "Todas" default
    expect(screen.getAllByText('Todas').length).toBeGreaterThanOrEqual(1);
  });

  it('should render origin filter select', () => {
    render(
      <CadenceListView
        cadences={[createCadence()]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    // Origin filter select also renders with compact "Todas" default
    expect(screen.getAllByText('Todas').length).toBeGreaterThanOrEqual(2);
  });

  it('should render search input with search icon', () => {
    render(
      <CadenceListView
        cadences={[createCadence()]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByPlaceholderText('Buscar por nome...')).toBeInTheDocument();
  });

  it('should render action menu button for each cadence', () => {
    render(
      <CadenceListView
        cadences={[createCadence()]}
        total={1}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByLabelText('Ações para Follow Up Inicial')).toBeInTheDocument();
  });

  it('should show dynamic count text', () => {
    render(
      <CadenceListView
        cadences={[createCadence(), createCadence({ id: 'cad-2', name: 'Outbound V2' }), createCadence({ id: 'cad-3', name: 'Inbound' })]}
        total={3}
        page={1}
        perPage={20}
        tabCounts={defaultTabCounts}
      />,
    );
    expect(screen.getByText(/Exibindo todas as 3 cadências/)).toBeInTheDocument();
  });
});
