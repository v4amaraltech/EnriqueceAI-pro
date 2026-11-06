import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException, captureMessage: mocks.captureMessage }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({}) }));
vi.mock('@/lib/supabase/from', () => ({ from: () => ({ upsert: mocks.upsert }) }));

import { runTrackedWorker } from './worker-run';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsert.mockResolvedValue({ error: null });
});

const row = () => mocks.upsert.mock.calls[0]![0] as Record<string, unknown>;

describe('runTrackedWorker', () => {
  it('sucesso: grava last_success_at e o resumo do resultado; nada no Sentry', async () => {
    const res = await runTrackedWorker('check-email-replies', async () => ({ success: true as const, data: { found: 3 } }));

    expect(res).toEqual({ success: true, data: { found: 3 } });
    expect(row()).toMatchObject({ job_name: 'check-email-replies', last_status: 'success', metadata: { found: 3 } });
    expect(row().last_success_at).toBe(row().last_run_at);
    expect(mocks.upsert.mock.calls[0]![1]).toEqual({ onConflict: 'job_name' });
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });

  it('falha ({ success: false }): grava erro SEM mexer em last_success_at e avisa o Sentry agrupado por robô', async () => {
    const res = await runTrackedWorker('execute-cadence-steps', async () => ({ success: false as const, error: 'db down' }));

    expect(res).toEqual({ success: false, error: 'db down' });
    expect(row()).toMatchObject({ last_status: 'error', metadata: { error: 'db down' } });
    expect(row()).not.toHaveProperty('last_success_at');
    expect(mocks.captureMessage).toHaveBeenCalledWith('[worker] execute-cadence-steps failed', {
      level: 'error',
      tags: { worker: 'execute-cadence-steps' },
      fingerprint: ['worker-failed', 'execute-cadence-steps'],
      extra: { error: 'db down' },
    });
  });

  it('exceção: registra e relança (o onRequestError do Next manda ao Sentry — sem evento duplicado)', async () => {
    const boom = new Error('timeout');
    await expect(runTrackedWorker('ingest-email-inbox', async () => { throw boom; })).rejects.toBe(boom);

    expect(row()).toMatchObject({ last_status: 'error', metadata: { error: 'timeout' } });
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it('resultado grande: mantém os contadores e resume as listas', async () => {
    const big = { sent: 3, failed: 25, errors: Array.from({ length: 200 }, (_, i) => `erro longo número ${i} `.repeat(3)) };
    await runTrackedWorker('x', async () => ({ success: true as const, data: big }));
    expect(row().metadata).toEqual({ truncated: true, sent: 3, failed: 25, errors: { count: 200 } });
  });

  it('resultado que não é objeto vira {} (metadata é NOT NULL)', async () => {
    await runTrackedWorker('x', async () => ({ success: true as const, data: undefined }));
    expect(row().metadata).toEqual({});
  });

  it('erro devolvido pelo supabase ao gravar (sem exceção) é reportado ao Sentry e não derruba o robô', async () => {
    mocks.upsert.mockResolvedValue({ error: { message: 'null value in column "metadata"' } });
    await expect(runTrackedWorker('x', async () => ({ success: true as const, data: {} }))).resolves.toEqual({
      success: true,
      data: {},
    });
    expect(mocks.captureMessage).toHaveBeenCalledWith(
      '[worker-run] failed to record run state for x',
      expect.objectContaining({ fingerprint: ['worker-run-state-write', 'x'] }),
    );
  });

  it('exceção ao gravar também não derruba o robô', async () => {
    mocks.upsert.mockRejectedValue(new Error('network'));
    await expect(runTrackedWorker('x', async () => ({ success: true as const, data: {} }))).resolves.toEqual({
      success: true,
      data: {},
    });
  });
});
