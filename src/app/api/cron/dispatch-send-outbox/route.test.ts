import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

import { installOutboxWorld, makeWorld, seedOutbox, type World } from '@/features/contact-engine/services/outbox-fake.testkit';

import { POST } from './route';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/features/contact-engine/services/send-decision.service', () => ({ evaluateSend: vi.fn() }));
vi.mock('@/features/contact-engine/services/provider-adapters.service', () => ({
  createDefaultAdapters: vi.fn(() => ({})),
}));

const SECRET = 'test-cron-secret';
const call = (auth?: string) =>
  POST(new Request('http://localhost/api/cron/dispatch-send-outbox', { method: 'POST', headers: auth ? { authorization: auth } : {} }));

let w: World;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CRON_SECRET', SECRET);
  w = makeWorld({ flags: { dispatcher_v1: false, send_outbox_enqueue: true } });
  installOutboxWorld(w);
});

describe('POST /api/cron/dispatch-send-outbox', () => {
  it('sem segredo valido responde 401 e nao toca o banco', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer errado')).status).toBe(401);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it('flag desligada: 200, sem ler a fila nem chamar RPC', async () => {
    const row = seedOutbox(w, { status: 'uncertain', version: 3 });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: false, reason: 'flag_disabled' });
    expect(w.rpcCalls).toEqual([]);
    expect(row).toMatchObject({ status: 'uncertain', version: 3 });
  });

  it('flag ligada mas sem resolvedor de conteudo configurado: nao reserva nada', async () => {
    w.flags.dispatcher_v1 = true;
    const row = seedOutbox(w);
    const res = await call(`Bearer ${SECRET}`);
    expect(await res.json()).toMatchObject({ ok: true, enabled: true, reason: 'payload_resolver_not_configured' });
    expect(w.rpcCalls).toEqual([]);
    expect(row.status).toBe('pending');
  });
});
