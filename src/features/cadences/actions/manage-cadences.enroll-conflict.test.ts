import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/leads/actions/log-lead-event', () => ({ logLeadEvent: vi.fn(), logLeadEventBulk: vi.fn() }));
vi.mock('@/lib/actions/handle-error', () => ({
  handleQueryError: (err: unknown) => (err ? { success: false, error: 'db error' } : null),
}));

import { enrollLeads, switchLeadsCadence } from './manage-cadences';

type Cad = { name: string; type?: string; executor?: string; deleted_at?: string | null };
type Open = { lead_id: string; cadence_id: string; status: string; cadence: Cad };

const TARGET = 'cad-target';
let target: Cad & { id: string; status: string };
let openEnrollments: Open[];
let conflictError: unknown = null;
let leadsCount = 3;
const conflictCalls: Array<{ method: string; args: unknown[] }> = [];
const inserts: Array<Record<string, unknown>> = [];
const updates: Array<Record<string, unknown>> = [];

function makeSupabase() {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let isSelect = false;
      chain.select = () => {
        isSelect = true;
        return chain;
      };
      chain.eq = (...args: unknown[]) => {
        if (table === 'cadence_enrollments' && isSelect) conflictCalls.push({ method: 'eq', args });
        return chain;
      };
      chain.is = () => chain;
      chain.in = (...args: unknown[]) => {
        if (table === 'cadence_enrollments' && isSelect) conflictCalls.push({ method: 'in', args });
        return chain;
      };
      chain.update = (p: Record<string, unknown>) => {
        updates.push(p);
        isSelect = false;
        return chain;
      };
      chain.insert = (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      };
      chain.single = () => Promise.resolve({ data: target, error: null });
      chain.then = (resolve: (v: unknown) => unknown) => {
        let data: unknown = null;
        if (table === 'leads') data = Array.from({ length: leadsCount }, (_, i) => ({ id: `L${i + 1}` }));
        else if (table === 'cadence_enrollments' && isSelect) {
          return Promise.resolve({ data: conflictError ? null : openEnrollments, error: conflictError }).then(resolve);
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    },
  };
}

function open(lead: string, cadence: Cad, status = 'active'): Open {
  return { lead_id: lead, cadence_id: `cad-${cadence.name}`, status, cadence };
}

const STD_A: Cad = { name: 'Standard A', type: 'standard', executor: 'sdr' };

describe('enrollLeads — lead já em outra cadência', () => {
  beforeEach(() => {
    inserts.length = 0;
    updates.length = 0;
    openEnrollments = [];
    conflictError = null;
    leadsCount = 3;
    conflictCalls.length = 0;
    target = { id: TARGET, name: 'Standard B', status: 'active', type: 'standard', executor: 'sdr' };
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org', userId: 'u1', role: 'manager', supabase: makeSupabase() },
    });
  });

  it('(a) ativo em standard A + lote na standard B => pulado com motivo', async () => {
    openEnrollments = [open('L1', STD_A)];
    const res = await enrollLeads(TARGET, ['L1']);
    expect(res.success && res.data.enrolled).toBe(0);
    expect(res.success && res.data.errors).toEqual(['Lead L1: já está na cadência "Standard A"']);
    expect(inserts).toHaveLength(0);
  });

  it('(b) pausado em outra standard => pulado', async () => {
    openEnrollments = [open('L1', STD_A, 'paused')];
    const res = await enrollLeads(TARGET, ['L1']);
    expect(res.success && res.data.enrolled).toBe(0);
    expect(res.success && res.data.errors[0]).toContain('já está na cadência');
    expect(inserts).toHaveLength(0);
  });

  it('(c) sem outra inscrição => inscreve normal', async () => {
    const res = await enrollLeads(TARGET, ['L1']);
    expect(res.success && res.data).toEqual({ enrolled: 1, errors: [] });
    expect(inserts.map((i) => i.lead_id)).toEqual(['L1']);
  });

  it('(d) Trocar cadência continua funcionando mesmo com o lead em outra standard', async () => {
    openEnrollments = [open('L1', STD_A)];
    const res = await switchLeadsCadence(TARGET, ['L1']);
    expect(res.success && res.data.enrolled).toBe(1);
    expect(inserts.map((i) => i.lead_id)).toEqual(['L1']);
  });

  it('(e) EXCEÇÃO: lead em standard + inscrição em auto_email => inscreve', async () => {
    target = { ...target, type: 'auto_email' };
    openEnrollments = [open('L1', STD_A)];
    const res = await enrollLeads(TARGET, ['L1']);
    expect(res.success && res.data).toEqual({ enrolled: 1, errors: [] });
  });

  it('(f) EXCEÇÃO: lead em auto_email + inscrição em standard => inscreve', async () => {
    openEnrollments = [open('L1', { name: 'E-mail auto', type: 'auto_email', executor: 'sdr' })];
    const res = await enrollLeads(TARGET, ['L1']);
    expect(res.success && res.data).toEqual({ enrolled: 1, errors: [] });
  });

  it('(g) EXCEÇÃO: bdr_ai de qualquer lado => inscreve', async () => {
    openEnrollments = [open('L1', { name: 'BDR IA', type: 'standard', executor: 'bdr_ai' })];
    const lado1 = await enrollLeads(TARGET, ['L1']);
    expect(lado1.success && lado1.data.enrolled).toBe(1);

    target = { ...target, executor: 'bdr_ai' };
    openEnrollments = [open('L2', STD_A)];
    const lado2 = await enrollLeads(TARGET, ['L2']);
    expect(lado2.success && lado2.data.enrolled).toBe(1);
  });

  it('(h) lote misto devolve a contagem certa e os pulados', async () => {
    openEnrollments = [
      open('L1', STD_A),
      open('L2', { name: 'E-mail auto', type: 'auto_email' }),
    ];
    const res = await enrollLeads(TARGET, ['L1', 'L2', 'L3']);
    expect(res.success && res.data.enrolled).toBe(2);
    expect(res.success && res.data.errors).toEqual(['Lead L1: já está na cadência "Standard A"']);
    expect(inserts.map((i) => i.lead_id)).toEqual(['L2', 'L3']);
  });

  it('falha fechada: erro na consulta de conflito => success false e nada é inscrito nem fechado', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    conflictError = { message: 'boom' };
    const res = await enrollLeads(TARGET, ['L1', 'L2']);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('Não foi possível checar as cadências atuais dos leads. Tente de novo.');
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('mesma cadência: inscreve de novo e fecha a inscrição anterior', async () => {
    openEnrollments = [{ lead_id: 'L1', cadence_id: TARGET, status: 'active', cadence: { name: 'Standard B', type: 'standard' } }];
    const res = await enrollLeads(TARGET, ['L1']);
    expect(res.success && res.data).toEqual({ enrolled: 1, errors: [] });
    expect(updates.some((u) => u.status === 'completed')).toBe(true);
    expect(inserts.map((i) => i.lead_id)).toEqual(['L1']);
  });

  it('consulta de conflito filtra por org_id e status active/paused', async () => {
    await enrollLeads(TARGET, ['L1']);
    expect(conflictCalls).toContainEqual({ method: 'eq', args: ['org_id', 'org'] });
    expect(conflictCalls).toContainEqual({ method: 'in', args: ['status', ['active', 'paused']] });
  });

  it('mais de 200 leads: consulta de conflito em 2 blocos', async () => {
    leadsCount = 250;
    const ids = Array.from({ length: 250 }, (_, i) => `L${i + 1}`);
    await enrollLeads(TARGET, ids);
    const leadChunks = conflictCalls.filter((c) => c.method === 'in' && c.args[0] === 'lead_id');
    expect(leadChunks.map((c) => (c.args[1] as string[]).length)).toEqual([200, 50]);
  });

  it('cadência apagada (deleted_at) com inscrição aberta NÃO conta como conflito', async () => {
    openEnrollments = [open('L1', { ...STD_A, deleted_at: '2026-11-01T00:00:00Z' })];
    const res = await enrollLeads(TARGET, ['L1']);
    expect(res.success && res.data).toEqual({ enrolled: 1, errors: [] });
  });

  it('cadência não apagada (deleted_at null) com inscrição aberta pula como antes', async () => {
    openEnrollments = [open('L1', { ...STD_A, deleted_at: null })];
    const res = await enrollLeads(TARGET, ['L1']);
    expect(res.success && res.data.enrolled).toBe(0);
    expect(res.success && res.data.errors).toEqual(['Lead L1: já está na cadência "Standard A"']);
  });
});
