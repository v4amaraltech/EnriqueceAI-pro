import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PendingActivity } from '../types';
import { ActivityLogView } from './ActivityLogView';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock skip-activity (dynamically imported)
vi.mock('../actions/skip-activity', () => ({
  skipActivity: vi.fn(),
}));

function createMockActivity(overrides: Partial<PendingActivity> = {}): PendingActivity {
  return {
    enrollmentId: 'enr-1',
    cadenceId: 'cad-1',
    cadenceName: 'Cadência de demonstração',
    cadenceCreatedBy: 'user-1',
    stepId: 'step-1',
    stepOrder: 1,
    totalSteps: 5,
    channel: 'email',
    templateId: null,
    templateSubject: null,
    templateBody: null,
    aiPersonalization: false,
    nextStepDue: new Date(Date.now() - 3600000 * 2).toISOString(), // 2h ago
    isCurrentStep: true,
    lead: {
      id: 'lead-1',
      org_id: 'org-1',
      nome_fantasia: 'Alpha Corp',
      razao_social: 'Alpha Corporation LTDA',
      cnpj: '11222333000181',
      email: 'alpha@test.com',
      telefone: null,
      municipio: null,
      uf: null,
      porte: null,
      first_name: null,
      last_name: null,
      primeiro_nome: null,
      socios: null,
      endereco: null,
      instagram: null,
      linkedin: null,
      website: null,
      status: null,
      meeting_scheduled_at: null,
      enrichment_status: null,
      notes: null,
      fit_score: null,
      engagement_score: null,
      is_inbound: false,
      created_at: '2026-01-15T10:00:00Z',
      phones: null,
      emails: null,
      job_title: null,
      lead_source: null,
      canal: null,
      segmento: null,
      assigned_to: null,
      custom_field_values: null,
    },
    activityName: null,
    callScript: null,
    callProvider: null,
    ...overrides,
  };
}

describe('ActivityLogView', () => {
  it('should render header with activity count', () => {
    render(<ActivityLogView activities={[]} total={10} hasFilters={false} />);

    expect(screen.getByText('Atividades')).toBeInTheDocument();
    expect(screen.getByText('10 atividades encontradas')).toBeInTheDocument();
  });

  it('should show "Limpar filtros" when filters are active', () => {
    render(<ActivityLogView activities={[]} total={0} hasFilters={true} />);

    expect(screen.getByText('Limpar filtros')).toBeInTheDocument();
  });

  it('should not show "Limpar filtros" when no filters active', () => {
    render(<ActivityLogView activities={[]} total={0} hasFilters={false} />);

    expect(screen.queryByText('Limpar filtros')).not.toBeInTheDocument();
  });

  it('should render filter dropdowns', () => {
    render(<ActivityLogView activities={[]} total={0} hasFilters={false} />);

    expect(screen.getByPlaceholderText('Nome, email ou telefone')).toBeInTheDocument();
  });

  it('should render activities in the list', () => {
    const activities = [
      createMockActivity({ enrollmentId: 'enr-1', lead: { ...createMockActivity().lead, nome_fantasia: 'Alpha Corp' } }),
      createMockActivity({ enrollmentId: 'enr-2', cadenceName: 'Pesquisa', lead: { ...createMockActivity().lead, id: 'lead-2', nome_fantasia: 'Beta Inc' } }),
    ];

    render(<ActivityLogView activities={activities} total={2} hasFilters={false} />);

    expect(screen.getByText('Alpha Corp')).toBeInTheDocument();
    expect(screen.getByText('Beta Inc')).toBeInTheDocument();
  });

  it('should show section label with count', () => {
    const activities = [createMockActivity()];

    render(<ActivityLogView activities={activities} total={1} hasFilters={false} />);

    expect(screen.getByText('Atividades das Cadências (1)')).toBeInTheDocument();
  });

  it('should show empty state when no activities match filters', () => {
    render(<ActivityLogView activities={[]} total={0} hasFilters={true} />);

    expect(screen.getByText('Nenhuma atividade encontrada')).toBeInTheDocument();
  });

  it('should render Executar button for each activity', () => {
    const activities = [createMockActivity()];

    render(<ActivityLogView activities={activities} total={1} hasFilters={false} />);

    expect(screen.getByText('Executar')).toBeInTheDocument();
  });

  it('should render table column headers', () => {
    const activities = [createMockActivity()];
    render(<ActivityLogView activities={activities} total={1} hasFilters={false} />);

    expect(screen.getByText('Atividade')).toBeInTheDocument();
    expect(screen.getByText('Cadência')).toBeInTheDocument();
    expect(screen.getByText('Lead')).toBeInTheDocument();
  });

  it('should not show progress cards or pending calls (Execução-only features)', () => {
    const activities = [createMockActivity()];

    render(<ActivityLogView activities={activities} total={1} hasFilters={false} />);

    // These should NOT be present (they're Execução-only)
    expect(screen.queryByText('Modo Execução rápida')).not.toBeInTheDocument();
    expect(screen.queryByText('Power Dialer')).not.toBeInTheDocument();
    expect(screen.queryByText('LEADS AGUARDANDO A PRIMEIRA LIGAÇÃO')).not.toBeInTheDocument();
  });
});
