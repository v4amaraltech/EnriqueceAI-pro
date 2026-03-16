import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';
const mockFrom = mockSupabaseFrom as any;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'test@test.com' })),
}));

import { fetchLeads } from './fetch-leads';

// ---------------------------------------------------------------------------
// Chain mock factory
// ---------------------------------------------------------------------------

function createChainMock(finalResult: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockImplementation(() => Promise.resolve(finalResult)),
    single: vi.fn().mockImplementation(() =>
      Promise.resolve({ data: { org_id: 'org-1' } }),
    ),
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const mockLeads = [
  {
    id: 'lead-1',
    org_id: 'org-1',
    cnpj: '11222333000181',
    status: 'new',
    enrichment_status: 'pending',
    razao_social: 'Company One Ltda',
    nome_fantasia: null,
    endereco: null,
    porte: null,
    cnae: null,
    situacao_cadastral: null,
    email: null,
    telefone: null,
    socios: null,
    faturamento_estimado: null,
    enriched_at: null,
    created_by: 'user-1',
    import_id: null,
    deleted_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'lead-2',
    org_id: 'org-1',
    cnpj: '22333444000195',
    status: 'contacted',
    enrichment_status: 'enriched',
    razao_social: 'Company Two S.A.',
    nome_fantasia: 'CompTwo',
    endereco: { uf: 'SP', cidade: 'São Paulo' },
    porte: 'ME',
    cnae: '6201-5',
    situacao_cadastral: 'ATIVA',
    email: 'contact@comptwo.com',
    telefone: null,
    socios: null,
    faturamento_estimado: null,
    enriched_at: '2024-01-02T00:00:00Z',
    created_by: 'user-1',
    import_id: null,
    deleted_at: null,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchLeads', () => {
  beforeEach(() => {
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // Success: returns leads with pagination
  // -------------------------------------------------------------------------

  it('should return leads with pagination metadata on success', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: mockLeads,
      count: 2,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    const result = await fetchLeads({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(2);
      expect(result.data.total).toBe(2);
      expect(result.data.page).toBe(1);
      expect(result.data.per_page).toBe(25);
    }
  });

  // -------------------------------------------------------------------------
  // No org: returns error
  // -------------------------------------------------------------------------

  it('should return error when user has no organization', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: null });

    mockFrom.mockImplementation(() => memberChain);

    const result = await fetchLeads({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  // -------------------------------------------------------------------------
  // Invalid filters: returns 'Filtros inválidos'
  // -------------------------------------------------------------------------

  it('should return validation error for invalid filters', async () => {
    const result = await fetchLeads({ status: 'invalid_status_value' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Filtros inválidos');
    }
  });

  it('should return validation error when per_page exceeds maximum', async () => {
    const result = await fetchLeads({ per_page: 999 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Filtros inválidos');
    }
  });

  // -------------------------------------------------------------------------
  // With status filter: builds query correctly
  // -------------------------------------------------------------------------

  it('should apply status filter to the query', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: [mockLeads[0]],
      count: 1,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    const result = await fetchLeads({ status: 'new' });

    expect(result.success).toBe(true);
    // Verify .eq was called with the status filter
    expect(leadsChain.eq).toHaveBeenCalledWith('status', 'new');
  });

  it('should apply enrichment_status filter to the query', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: [mockLeads[1]],
      count: 1,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    const result = await fetchLeads({ enrichment_status: 'enriched' });

    expect(result.success).toBe(true);
    expect(leadsChain.eq).toHaveBeenCalledWith('enrichment_status', 'enriched');
  });

  // -------------------------------------------------------------------------
  // With search filter: uses .or() for text search
  // -------------------------------------------------------------------------

  it('should use .or() for full-text search across multiple fields', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: mockLeads,
      count: 2,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    const result = await fetchLeads({ search: 'Company' });

    expect(result.success).toBe(true);
    expect(leadsChain.or).toHaveBeenCalledWith(
      'razao_social.ilike.%Company%,nome_fantasia.ilike.%Company%,cnpj.ilike.%Company%,first_name.ilike.%Company%,last_name.ilike.%Company%,email.ilike.%Company%',
    );
  });

  it('should strip SQL wildcard characters from search term', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: [],
      count: 0,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    await fetchLeads({ search: 'test%_hack' });

    // The search term should have % and _ stripped before being used in .or()
    expect(leadsChain.or).toHaveBeenCalledWith(
      'razao_social.ilike.%testhack%,nome_fantasia.ilike.%testhack%,cnpj.ilike.%testhack%,first_name.ilike.%testhack%,last_name.ilike.%testhack%,email.ilike.%testhack%',
    );
  });

  // -------------------------------------------------------------------------
  // With pagination (page 2): calculates correct range
  // -------------------------------------------------------------------------

  it('should calculate correct range for page 2 with default per_page', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: [],
      count: 25,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    const result = await fetchLeads({ page: 2, per_page: 20 });

    expect(result.success).toBe(true);
    // page=2, per_page=20 → from=20, to=39
    expect(leadsChain.range).toHaveBeenCalledWith(20, 39);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.per_page).toBe(20);
    }
  });

  it('should calculate correct range for page 3 with custom per_page', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: [],
      count: 100,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    await fetchLeads({ page: 3, per_page: 10 });

    // page=3, per_page=10 → from=20, to=29
    expect(leadsChain.range).toHaveBeenCalledWith(20, 29);
  });

  // -------------------------------------------------------------------------
  // DB error: returns error message
  // -------------------------------------------------------------------------

  it('should return error when database query fails', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: null,
      count: null,
      error: { message: 'relation "leads" does not exist' },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    const result = await fetchLeads({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao buscar leads');
    }
  });

  // -------------------------------------------------------------------------
  // Additional: ordering and shared query structure
  // -------------------------------------------------------------------------

  it('should always order results by created_at descending', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: mockLeads,
      count: 2,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    await fetchLeads({});

    expect(leadsChain.order).toHaveBeenCalledWith('created_at', { ascending: false, nullsFirst: false });
  });

  it('should filter leads by org_id and exclude soft-deleted records', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: mockLeads,
      count: 2,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    await fetchLeads({});

    expect(leadsChain.eq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(leadsChain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('should return empty data array and zero total when no leads exist', async () => {
    const memberChain = createChainMock(null);
    memberChain.single.mockResolvedValue({ data: { org_id: 'org-1' } });

    const leadsChain = createChainMock({
      data: null,
      count: null,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      if (table === 'leads') return leadsChain;
      return createChainMock(null);
    });

    const result = await fetchLeads({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toEqual([]);
      expect(result.data.total).toBe(0);
    }
  });
});
