import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';
const mockFrom = mockSupabaseFrom as any;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

// Service role client (usado por endActiveEnrollments) — stub chainable/thenable
// independente do mockFrom, para a baixa de enrollments não afetar a contagem
// de chamadas roteada por fromCallCount nos testes.
vi.mock('@/lib/supabase/service', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'neq', 'in', 'is']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve);
  return { createServiceRoleClient: vi.fn(() => ({ from: () => chain })) };
});

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'test@test.com' })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { bulkArchiveLeads, bulkDeleteLeads, exportLeadsCsv } from './bulk-actions';

// Helper to build a chainable mock for: .from().select().eq().eq().single()
function makeOrgMemberChain(orgId: string | null) {
  const singleMock = vi.fn().mockResolvedValue({ data: orgId ? { org_id: orgId } : null });
  const eqStatusMock = vi.fn().mockReturnValue({ single: singleMock });
  const eqUserMock = vi.fn().mockReturnValue({ eq: eqStatusMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqUserMock });
  return { select: selectMock };
}

// Helper to build a chainable mock for: .from('leads').update().eq().in().select('id')
// O .select('id') devolve os ids confirmados como da org (base da contagem).
function makeUpdateChain(
  rows: Array<{ id: string }> | null = [],
  error: { message: string } | null = null,
) {
  const selectMock = vi.fn().mockResolvedValue({ data: rows, error });
  const inMock = vi.fn().mockReturnValue({ select: selectMock });
  const eqMock = vi.fn().mockReturnValue({ in: inMock });
  const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
  return { update: updateMock };
}

// Helper to build a chainable mock for: .from('leads').select().eq().in()
function makeLeadsExportChain(
  data: Record<string, unknown>[] | null,
  error: { message: string } | null = null,
) {
  const inMock = vi.fn().mockResolvedValue({ data, error });
  const eqMock = vi.fn().mockReturnValue({ in: inMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
  return { select: selectMock };
}

describe('bulkDeleteLeads', () => {
  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers();
  });

  it('should soft-delete leads and return count on success', async () => {
    let fromCallCount = 0;
    mockFrom.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        return makeOrgMemberChain('org-1');
      }
      return makeUpdateChain([{ id: 'lead-1' }, { id: 'lead-2' }]);
    });

    const result = await bulkDeleteLeads(['lead-1', 'lead-2']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.count).toBe(2);
    }
    expect(revalidatePath).toHaveBeenCalledWith('/leads');
  });

  it('should return error when org is not found', async () => {
    mockFrom.mockImplementation(() => makeOrgMemberChain(null));

    const result = await bulkDeleteLeads(['lead-1']);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return error when leadIds is empty', async () => {
    mockFrom.mockImplementation(() => makeOrgMemberChain('org-1'));

    const result = await bulkDeleteLeads([]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Nenhum lead selecionado');
    }
  });

  it('should return error when DB update fails', async () => {
    let fromCallCount = 0;
    mockFrom.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        return makeOrgMemberChain('org-1');
      }
      return makeUpdateChain(null, { message: 'Update failed' });
    });

    const result = await bulkDeleteLeads(['lead-1']);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao excluir leads');
    }
  });
});

describe('bulkArchiveLeads', () => {
  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers();
  });

  it('should archive leads and return count on success', async () => {
    let fromCallCount = 0;
    mockFrom.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        // getOrgId: organization_members
        return makeOrgMemberChain('org-1');
      }
      // Archive: leads update → returns the org-confirmed ids
      return makeUpdateChain([{ id: 'lead-1' }, { id: 'lead-2' }, { id: 'lead-3' }]);
    });

    const result = await bulkArchiveLeads(['lead-1', 'lead-2', 'lead-3']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.count).toBe(3);
    }
    expect(revalidatePath).toHaveBeenCalledWith('/leads');
  });

  it('counts only org-confirmed ids (foreign-org id is ignored — S6)', async () => {
    let fromCallCount = 0;
    mockFrom.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) return makeOrgMemberChain('org-1');
      // Two ids requested, but only one belongs to the org → update returns one.
      return makeUpdateChain([{ id: 'lead-1' }]);
    });

    const result = await bulkArchiveLeads(['lead-1', 'foreign-lead']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.count).toBe(1);
    }
  });

  it('should return error when org is not found', async () => {
    mockFrom.mockImplementation(() => makeOrgMemberChain(null));

    const result = await bulkArchiveLeads(['lead-1']);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return error when leadIds is empty', async () => {
    mockFrom.mockImplementation(() => makeOrgMemberChain('org-1'));

    const result = await bulkArchiveLeads([]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Nenhum lead selecionado');
    }
  });

  it('should return error when DB update fails', async () => {
    let fromCallCount = 0;
    mockFrom.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        return makeOrgMemberChain('org-1');
      }
      return makeUpdateChain(null, { message: 'Update failed' });
    });

    const result = await bulkArchiveLeads(['lead-1', 'lead-2']);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao arquivar leads');
    }
  });
});

describe('exportLeadsCsv', () => {
  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers();
  });

  it('should export leads as CSV with correct headers and rows', async () => {
    const mockLeads = [
      {
        cnpj: '11222333000181',
        razao_social: 'Empresa Teste Ltda',
        nome_fantasia: 'Empresa Teste',
        porte: 'ME',
        cnae: '6201-5/01',
        email: 'contato@empresa.com',
        telefone: '11999999999',
        status: 'active',
        enrichment_status: 'enriched',
        endereco: { uf: 'SP', cidade: 'São Paulo' },
        created_at: '2024-01-15T10:00:00.000Z',
      },
    ];

    let fromCallCount = 0;
    mockFrom.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        return makeOrgMemberChain('org-1');
      }
      return makeLeadsExportChain(mockLeads);
    });

    const result = await exportLeadsCsv(['lead-1']);

    expect(result.success).toBe(true);
    if (result.success) {
      const { csv, filename } = result.data;

      // Verify CSV headers
      const lines = csv.split('\n');
      expect(lines[0]).toBe(
        'CNPJ,Razão Social,Nome Fantasia,Porte,CNAE,Email,Telefone,UF,Cidade,Status,Enriquecimento,Criado em',
      );

      // Verify data row contains correct values
      expect(lines[1]).toContain('"11222333000181"');
      expect(lines[1]).toContain('"Empresa Teste Ltda"');
      expect(lines[1]).toContain('"Empresa Teste"');
      expect(lines[1]).toContain('"ME"');
      expect(lines[1]).toContain('"6201-5/01"');
      expect(lines[1]).toContain('"contato@empresa.com"');
      expect(lines[1]).toContain('"11999999999"');
      expect(lines[1]).toContain('"SP"');
      expect(lines[1]).toContain('"São Paulo"');
      expect(lines[1]).toContain('"active"');
      expect(lines[1]).toContain('"enriched"');

      // Verify filename format
      expect(filename).toMatch(/^leads-export-\d{4}-\d{2}-\d{2}\.csv$/);
    }
  });

  it('should handle leads without endereco gracefully', async () => {
    const mockLeads = [
      {
        cnpj: '11222333000181',
        razao_social: 'Empresa Sem Endereco',
        nome_fantasia: null,
        porte: null,
        cnae: null,
        email: null,
        telefone: null,
        status: 'active',
        enrichment_status: 'pending',
        endereco: null,
        created_at: '2024-01-15T10:00:00.000Z',
      },
    ];

    let fromCallCount = 0;
    mockFrom.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        return makeOrgMemberChain('org-1');
      }
      return makeLeadsExportChain(mockLeads);
    });

    const result = await exportLeadsCsv(['lead-1']);

    expect(result.success).toBe(true);
    if (result.success) {
      const lines = result.data.csv.split('\n');
      // UF and Cidade should be empty strings
      expect(lines[1]).toContain('""');
    }
  });

  it('should return error when org is not found', async () => {
    mockFrom.mockImplementation(() => makeOrgMemberChain(null));

    const result = await exportLeadsCsv(['lead-1']);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return error when leadIds is empty', async () => {
    mockFrom.mockImplementation(() => makeOrgMemberChain('org-1'));

    const result = await exportLeadsCsv([]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Nenhum lead selecionado');
    }
  });

  it('should return error when DB query fails', async () => {
    let fromCallCount = 0;
    mockFrom.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        return makeOrgMemberChain('org-1');
      }
      return makeLeadsExportChain(null, { message: 'Query failed' });
    });

    const result = await exportLeadsCsv(['lead-1']);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao exportar leads');
    }
  });
});
