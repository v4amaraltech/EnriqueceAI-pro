import { beforeEach, describe, expect, it, vi } from 'vitest';

const tableData: Record<string, unknown> = {};
const auth = vi.hoisted(() => ({
  role: 'manager' as 'manager' | 'sdr',
  userId: 'user-1',
}));

function chainFor(table: string) {
  const result = () => ({ data: tableData[table] ?? null, error: null });
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(result()));
  chain.single = vi.fn(() => Promise.resolve(result()));
  chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return chain;
}

vi.mock('@/lib/auth/get-org-id', () => ({
  getAuthOrgIdResult: vi.fn(() =>
    Promise.resolve({
      success: true,
      data: { orgId: 'org-1', userId: auth.userId, role: auth.role, supabase: {} },
    }),
  ),
}));

vi.mock('@/lib/supabase/from', () => ({
  from: vi.fn((_supabase: unknown, table: string) => chainFor(table)),
}));

import { fetchDialerLeadCard } from './fetch-dialer-lead-card';

const LEAD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENROLLMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REASON_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('fetchDialerLeadCard', () => {
  beforeEach(() => {
    for (const key of Object.keys(tableData)) delete tableData[key];
    auth.role = 'manager';
    auth.userId = 'user-1';
    tableData.leads = {
      id: LEAD_ID,
      first_name: 'Maria',
      last_name: 'Silva',
      nome_fantasia: 'Silva Ltda',
      razao_social: 'Silva Comercio Ltda',
      telefone: '11999990001',
      phones: null,
      job_title: 'Compradora',
      segmento: 'Varejo',
      cnpj: '12345678000190',
      email: 'maria@silva.com',
      socios: null,
      lead_source: 'Inbound',
      canal: 'Site',
      lost_at: '2026-04-17T10:22:48.000Z',
      loss_notes: 'Cadencia parada',
      loss_reason_id: REASON_ID,
      created_at: '2025-01-10T12:00:00.000Z',
      assigned_to: 'user-1',
    };
    tableData.cadence_enrollments = { loss_notes: 'Nota da inscricao' };
    tableData.loss_reasons = { id: REASON_ID, name: 'Deixou de responder' };
    tableData.interactions = [{ created_at: '2026-11-10T15:00:00.000Z' }];
  });

  it('monta o cartao com temperatura, abertura e dados do lead da vez', async () => {
    const result = await fetchDialerLeadCard({
      leadId: LEAD_ID,
      enrollmentId: ENROLLMENT_ID,
      stepOrder: 2,
      totalSteps: 5,
      callScript: 'Perguntar quem decide.',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.attemptLabel).toBe('TENTATIVA 2/5');
    expect(result.data.name).toBe('Maria Silva');
    expect(result.data.company).toBe('Silva Ltda');
    expect(result.data.fields.some((field) => field.id === 'temperatura')).toBe(true);
    expect(result.data.opening.toLowerCase()).toContain('seria um problema retomarmos em 2 minutos?');
    expect(result.data.fields.find((field) => field.id === 'motivo')?.value).toBe('Deixou de responder');
    expect(result.data.fields.find((field) => field.id === 'notas')?.value).toBe('Cadencia parada');
  });

  it('com campos ausentes ainda devolve cartao e abertura padrao', async () => {
    tableData.leads = {
      id: LEAD_ID,
      first_name: null,
      last_name: null,
      nome_fantasia: null,
      razao_social: null,
      telefone: null,
      phones: null,
      job_title: null,
      segmento: null,
      cnpj: null,
      email: null,
      socios: null,
      lead_source: null,
      canal: null,
      lost_at: null,
      loss_notes: null,
      loss_reason_id: null,
      created_at: null,
      assigned_to: 'user-1',
    };
    tableData.cadence_enrollments = null;
    tableData.loss_reasons = null;
    tableData.interactions = [];
    const result = await fetchDialerLeadCard({
      leadId: LEAD_ID,
      stepOrder: 1,
      totalSteps: 3,
      callScript: null,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBeNull();
    expect(result.data.company).toBeNull();
    expect(result.data.fields.find((field) => field.id === 'cnpj')?.value).toBe('-');
    expect(result.data.fields.find((field) => field.id === 'temperatura')?.value).toBe('Sem dados');
    expect(result.data.opening.toLowerCase()).toContain('tentativa 1 de 3');
  });

  it('recusa lead id invalido sem consultar o banco', async () => {
    const result = await fetchDialerLeadCard({
      leadId: 'l-1',
      stepOrder: 1,
      totalSteps: 1,
      callScript: null,
    });
    expect(result).toEqual({ success: false, error: 'Lead inválido' });
  });
});
