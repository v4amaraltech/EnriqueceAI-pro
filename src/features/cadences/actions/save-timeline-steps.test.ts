import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
}));

type Resolved = { data?: unknown; error?: unknown; count?: number | null };

/**
 * Cadeia PostgREST fake: todo método devolve a própria cadeia e `await` resolve
 * no valor configurado. Cada chamada a `from(table)` consome a próxima cadeia
 * da fila daquela tabela, na ordem em que a action executa as queries.
 */
const CHAIN_METHODS = ['select', 'eq', 'is', 'in', 'order', 'single', 'maybeSingle', 'insert', 'delete', 'update', 'upsert'] as const;
type Chain = Record<(typeof CHAIN_METHODS)[number], ReturnType<typeof vi.fn>> & { then: unknown };

function chain(resolved: Resolved = { data: null, error: null }): Chain {
  const c: Record<string, unknown> = {};
  for (const m of CHAIN_METHODS) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.then = (onFulfilled: (v: Resolved) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolved).then(onFulfilled, onRejected);
  return c as unknown as Chain;
}
let queues: Record<string, Chain[]>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() =>
    Promise.resolve({
      from: (table: string) => queues[table]?.shift() ?? chain(),
    }),
  ),
}));

import { ACTIVE_ENROLLMENTS_CODE } from '../types';
import { saveTimelineSteps } from './save-timeline-steps';

const member = () => chain({ data: { org_id: 'org-1', role: 'manager' } });
const draftCadence = () => chain({ data: { id: 'cad-1', status: 'draft' } });
const pausedCadence = () => chain({ data: { id: 'cad-1', status: 'paused' } });

describe('saveTimelineSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queues = {};
  });

  it('should return error when user has no org', async () => {
    queues = { organization_members: [chain({ data: null })] };

    const result = await saveTimelineSteps('cad-1', []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return error when cadence not found', async () => {
    queues = { organization_members: [member()], cadences: [chain({ data: null })] };

    const result = await saveTimelineSteps('cad-999', []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Cadência não encontrada');
    }
  });

  it('should return error when cadence is active', async () => {
    queues = { organization_members: [member()], cadences: [chain({ data: { id: 'cad-1', status: 'active' } })] };

    const result = await saveTimelineSteps('cad-1', [{ channel: 'email', delay_days: 0, step_order: 1 }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('rascunho ou pausada');
    }
  });

  it('should create steps for a draft cadence without existing steps', async () => {
    const existing = chain({ data: [], error: null });
    const enrollmentsCount = chain({ count: 0 });
    const upsert = chain({ error: null });
    const totalSteps = chain();
    queues = {
      organization_members: [member()],
      cadences: [draftCadence(), totalSteps],
      cadence_steps: [existing, upsert],
      cadence_enrollments: [enrollmentsCount],
    };

    const result = await saveTimelineSteps('cad-1', [
      { channel: 'phone', delay_days: 0, step_order: 1, call_provider: 'whatsapp' },
      { channel: 'phone', delay_days: 1, step_order: 2 },
    ]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ saved: 2, preserved: 0, created: 2, removed: 0 });
    }
    const rows = upsert.upsert.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toEqual(expect.any(String));
    expect(rows[0]?.step_order).toBe(1);
    expect(rows[0]?.call_provider).toBe('whatsapp');
    expect(rows[1]?.step_order).toBe(2);
    expect(rows[1]?.call_provider).toBeNull();
    expect(upsert.upsert.mock.calls[0]?.[1]).toEqual({ onConflict: 'id' });
    expect(totalSteps.update).toHaveBeenCalledWith({ total_steps: 2 });
  });

  it('should preserve IDs and skip the enrollment guard when only content changes (same structure)', async () => {
    const existing = chain({ data: [{ id: 's1', step_order: 1 }, { id: 's2', step_order: 2 }], error: null });
    const upsert = chain({ error: null });
    const enrollmentsCount = chain({ count: 300 });
    queues = {
      organization_members: [member()],
      cadences: [pausedCadence(), chain()],
      cadence_steps: [existing, upsert],
      cadence_enrollments: [enrollmentsCount],
    };

    const result = await saveTimelineSteps('cad-1', [
      { id: 's1', channel: 'phone', delay_days: 0, step_order: 1, instructions: 'Ligar 2x' },
      { id: 's2', channel: 'whatsapp', delay_days: 2, step_order: 2 },
    ]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ saved: 2, preserved: 2, created: 0, removed: 0 });
    }
    // Sem mudança estrutural não consulta inscrições nem passa pela ordem temporária.
    expect(enrollmentsCount.select).not.toHaveBeenCalled();
    expect(upsert.delete).not.toHaveBeenCalled();
    expect(upsert.upsert).toHaveBeenCalledTimes(1);
    const rows = upsert.upsert.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual(['s1', 's2']);
    expect(rows[0]?.instructions).toBe('Ligar 2x');
    expect(rows[1]?.delay_days).toBe(2);
  });

  it('mantém o envio automático salvo quando o construtor não manda o campo (WhatsApp automático)', async () => {
    const existing = chain({
      data: [{ id: 's1', step_order: 1, auto_send: true }, { id: 's2', step_order: 2, auto_send: true }],
      error: null,
    });
    const upsert = chain({ error: null });
    queues = {
      organization_members: [member()],
      cadences: [pausedCadence(), chain()],
      cadence_steps: [existing, upsert],
    };

    const result = await saveTimelineSteps('cad-1', [
      { id: 's1', channel: 'whatsapp', delay_days: 0, step_order: 1, template_id: '11111111-1111-1111-1111-111111111111' },
      // sem template não pode ficar automático
      { id: 's2', channel: 'whatsapp', delay_days: 1, step_order: 2, template_id: null },
    ]);

    expect(result.success).toBe(true);
    const rows = upsert.upsert.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(rows[0]?.auto_send).toBe(true);
    expect(rows[1]?.auto_send).toBe(false);
  });

  it('liga e desliga o envio automático só em passo de WhatsApp', async () => {
    const existing = chain({ data: [{ id: 's1', step_order: 1, auto_send: true }], error: null });
    const upsert = chain({ error: null });
    queues = {
      organization_members: [member()],
      cadences: [pausedCadence(), chain()],
      cadence_steps: [existing, upsert],
    };

    await saveTimelineSteps('cad-1', [
      { id: 's1', channel: 'whatsapp', delay_days: 0, step_order: 1, template_id: '11111111-1111-1111-1111-111111111111', auto_send: false },
      { channel: 'email', delay_days: 0, step_order: 2, template_id: '11111111-1111-1111-1111-111111111111', auto_send: true },
    ]);

    const rows = upsert.upsert.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.id === 's1')?.auto_send).toBe(false);
    expect(rows.find((r) => r.channel === 'email')?.auto_send).toBe(false);
  });

  it('should refuse a structural change with leads in progress until confirmed', async () => {
    const existing = chain({ data: [{ id: 's1', step_order: 1 }, { id: 's2', step_order: 2 }], error: null });
    const enrollmentsCount = chain({ count: 42 });
    const neverUsed = chain({ error: null });
    queues = {
      organization_members: [member()],
      cadences: [pausedCadence()],
      cadence_steps: [existing, neverUsed],
      cadence_enrollments: [enrollmentsCount],
    };

    const result = await saveTimelineSteps('cad-1', [
      { id: 's1', channel: 'phone', delay_days: 0, step_order: 1 },
      { channel: 'email', delay_days: 0, step_order: 2 }, // novo no meio
      { id: 's2', channel: 'whatsapp', delay_days: 1, step_order: 3 },
    ]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ACTIVE_ENROLLMENTS_CODE);
      expect(result.error).toContain('42 leads em andamento');
    }
    expect(neverUsed.upsert).not.toHaveBeenCalled();
    expect(neverUsed.delete).not.toHaveBeenCalled();
  });

  it('should apply a confirmed structural change preserving kept IDs and deleting only removed steps', async () => {
    const existing = chain({
      data: [{ id: 's1', step_order: 1 }, { id: 's2', step_order: 2 }, { id: 's3', step_order: 3 }],
      error: null,
    });
    const enrollmentsCount = chain({ count: 42 });
    const del = chain({ error: null });
    const tempUpsert = chain({ error: null });
    const finalUpsert = chain({ error: null });
    queues = {
      organization_members: [member()],
      cadences: [pausedCadence(), chain()],
      cadence_steps: [existing, del, tempUpsert, finalUpsert],
      cadence_enrollments: [enrollmentsCount],
    };

    // s2 removido, novo passo no meio e s1/s3 trocados de lugar (reordenação real).
    const result = await saveTimelineSteps(
      'cad-1',
      [
        { id: 's3', channel: 'whatsapp', delay_days: 0, step_order: 1 },
        { channel: 'email', delay_days: 0, step_order: 2 },
        { id: 's1', channel: 'phone', delay_days: 1, step_order: 3 },
      ],
      { confirmActiveEnrollments: true },
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ saved: 3, preserved: 2, created: 1, removed: 1 });
    }
    expect(del.delete).toHaveBeenCalled();
    expect(del.in).toHaveBeenCalledWith('id', ['s2']);

    // Fase temporária: só os mantidos, fora do intervalo real de ordens.
    const tempRows = tempUpsert.upsert.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(tempRows.map((r) => r.id)).toEqual(['s3', 's1']);
    expect(tempRows.map((r) => r.step_order)).toEqual([10001, 10003]);

    const finalRows = finalUpsert.upsert.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(finalRows.map((r) => r.step_order)).toEqual([1, 2, 3]);
    expect(finalRows[0]?.id).toBe('s3');
    expect(finalRows[1]?.id).not.toBe('s2');
    expect(finalRows[2]?.id).toBe('s1');
  });

  it('should skip the temporary reorder phase when kept steps keep their positions', async () => {
    const existing = chain({ data: [{ id: 's1', step_order: 1 }, { id: 's2', step_order: 2 }], error: null });
    const enrollmentsCount = chain({ count: 0 });
    const finalUpsert = chain({ error: null });
    queues = {
      organization_members: [member()],
      cadences: [draftCadence(), chain()],
      cadence_steps: [existing, finalUpsert],
      cadence_enrollments: [enrollmentsCount],
    };

    // Só acrescenta um passo no fim: s1 e s2 não mudam de posição.
    const result = await saveTimelineSteps('cad-1', [
      { id: 's1', channel: 'phone', delay_days: 0, step_order: 1 },
      { id: 's2', channel: 'whatsapp', delay_days: 0, step_order: 2 },
      { channel: 'email', delay_days: 3, step_order: 3 },
    ]);

    expect(result.success).toBe(true);
    expect(finalUpsert.upsert).toHaveBeenCalledTimes(1);
    const rows = finalUpsert.upsert.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.step_order)).toEqual([1, 2, 3]);
    expect(rows.slice(0, 2).map((r) => r.id)).toEqual(['s1', 's2']);
  });

  it('should save empty steps (clear all) for draft cadence', async () => {
    const existing = chain({ data: [{ id: 's1', step_order: 1 }], error: null });
    const enrollmentsCount = chain({ count: 0 });
    const del = chain({ error: null });
    const totalSteps = chain();
    queues = {
      organization_members: [member()],
      cadences: [draftCadence(), totalSteps],
      cadence_steps: [existing, del],
      cadence_enrollments: [enrollmentsCount],
    };

    const result = await saveTimelineSteps('cad-1', []);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ saved: 0, preserved: 0, created: 0, removed: 1 });
    }
    expect(del.in).toHaveBeenCalledWith('id', ['s1']);
    expect(del.upsert).not.toHaveBeenCalled();
    expect(totalSteps.update).toHaveBeenCalledWith({ total_steps: 0 });
  });
});
