import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LeadRow } from '../types';
import { LeadTable } from './LeadTable';

const mockPush = vi.fn();

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock server actions
vi.mock('../actions/bulk-actions', () => ({
  bulkArchiveLeads: vi.fn(),
  bulkDeleteLeads: vi.fn(),
  bulkEnrichLeads: vi.fn(),
  exportLeadsCsv: vi.fn(),
}));

function createMockLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'lead-1',
    org_id: 'org-1',
    cnpj: '11222333000181',
    status: 'new',
    enrichment_status: 'pending',
    razao_social: 'Empresa Teste LTDA',
    nome_fantasia: 'Empresa Teste',
    endereco: { cidade: 'São Paulo', uf: 'SP' },
    porte: 'ME',
    cnae: '6201-5/01',
    situacao_cadastral: 'Ativa',
    email: null,
    telefone: null,
    phones: null,
    socios: null,
    faturamento_estimado: null,
    notes: null,
    instagram: null,
    linkedin: null,
    website: null,
    fit_score: null,
    engagement_score: null,
    enriched_at: null,
    created_by: null,
    import_id: null,
    first_name: null,
    last_name: null,
    job_title: null,
    lead_source: null,
    source_id: null,
    is_inbound: false,
    assigned_to: null,
    custom_field_values: null,
    email_bounced_at: null,
    deleted_at: null,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

const emptyCadenceInfo = {};
const emptyUserMap = {};

describe('LeadTable', () => {
  it('should render leads in the table', () => {
    const leads = [
      createMockLead({ id: 'lead-1', nome_fantasia: 'Alpha Corp' }),
      createMockLead({ id: 'lead-2', nome_fantasia: 'Beta Inc', cnpj: '22333444000100' }),
    ];

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    expect(screen.getByText('Alpha Corp')).toBeInTheDocument();
    expect(screen.getByText('Beta Inc')).toBeInTheDocument();
  });

  it('should display Meetime-style status badge', () => {
    const leads = [createMockLead({ status: 'new' })];

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    expect(screen.getByText('ESPERANDO INÍCIO')).toBeInTheDocument();
  });

  it('should display ATIVO badge for contacted leads', () => {
    const leads = [createMockLead({ status: 'contacted' })];

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    expect(screen.getByText('ATIVO')).toBeInTheDocument();
  });

  it('should render checkboxes for selection', () => {
    const leads = [createMockLead()];

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);
  });

  it('should show first socio name as primary and company as secondary', () => {
    const leads = [
      createMockLead({
        socios: [{ nome: 'João Silva' }],
        nome_fantasia: 'Alpha Corp',
      }),
    ];

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    expect(screen.getByText('João Silva')).toBeInTheDocument();
    expect(screen.getByText('Alpha Corp')).toBeInTheDocument();
  });

  it('should show company name as primary when no socios exist', () => {
    const leads = [
      createMockLead({
        socios: null,
        nome_fantasia: 'Nome Fantasia',
        razao_social: 'Razão Social LTDA',
      }),
    ];

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    expect(screen.getByText('Nome Fantasia')).toBeInTheDocument();
  });

  it('should show formatted CNPJ when no names or socios exist', () => {
    const leads = [createMockLead({ nome_fantasia: null, razao_social: null, socios: null })];

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    expect(screen.getByText('11.222.333/0001-81')).toBeInTheDocument();
  });

  it('should display cadence name from cadenceInfo', () => {
    const leads = [createMockLead({ id: 'lead-1' })];
    const cadenceInfo = {
      'lead-1': { cadence_name: 'Outbound Q1', responsible_email: 'john@test.com', enrollment_status: 'active' as const },
    };

    render(<LeadTable leads={leads} cadenceInfo={cadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    expect(screen.getByText('Outbound Q1')).toBeInTheDocument();
  });

  it('should display responsible from userMap using assigned_to', () => {
    const leads = [createMockLead({ id: 'lead-1', assigned_to: 'user-123', created_by: 'user-456' })];
    const userMap = { 'user-123': 'maria', 'user-456': 'carlos' };

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={userMap} total={leads.length} />);

    expect(screen.getByText('maria')).toBeInTheDocument();
  });

  it('should fallback to created_by when assigned_to is null', () => {
    const leads = [createMockLead({ id: 'lead-1', assigned_to: null, created_by: 'user-456' })];
    const userMap = { 'user-456': 'carlos' };

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={userMap} total={leads.length} />);

    expect(screen.getByText('carlos')).toBeInTheDocument();
  });

  it('should render Responsável column header', () => {
    const leads = [createMockLead()];

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    expect(screen.getByText('Responsável')).toBeInTheDocument();
  });

  it('should render Cadência column header', () => {
    const leads = [createMockLead()];

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    expect(screen.getByText('Cadência')).toBeInTheDocument();
  });

  it('should render action menu button', () => {
    const leads = [createMockLead()];

    render(<LeadTable leads={leads} cadenceInfo={emptyCadenceInfo} userMap={emptyUserMap} total={leads.length} />);

    expect(screen.getByText('Ações')).toBeInTheDocument();
  });
});
