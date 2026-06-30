import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'me-1', email: 'sdr@test.com' }),
}));

const voice = {
  createVoiceSession: vi.fn(),
  getVoiceSession: vi.fn(),
  deleteVoiceSession: vi.fn(),
};
vi.mock('../services/voice-service-client', () => ({
  VoiceServiceError: class extends Error {},
  createVoiceSession: (...a: unknown[]) => voice.createVoiceSession(...a),
  getVoiceSession: (...a: unknown[]) => voice.getVoiceSession(...a),
  deleteVoiceSession: (...a: unknown[]) => voice.deleteVoiceSession(...a),
}));

// Stores das operações capturadas no client de service role.
let serviceQueues: Record<string, unknown[]>;
let ops: Array<{ table: string; op: string; payload?: unknown; eqs: Array<[string, unknown]> }>;

function makeChain(table: string, queues: Record<string, unknown[]>) {
  const eqs: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqs.push([col, val]);
    return chain;
  });
  chain.neq = vi.fn(() => chain);
  chain.insert = vi.fn((payload: unknown) => {
    ops.push({ table, op: 'insert', payload, eqs });
    return chain;
  });
  chain.update = vi.fn((payload: unknown) => {
    ops.push({ table, op: 'update', payload, eqs });
    return chain;
  });
  chain.delete = vi.fn(() => {
    ops.push({ table, op: 'delete', eqs });
    return chain;
  });
  const shift = () => (queues[table]?.shift() ?? { data: null, error: null });
  chain.single = vi.fn(() => Promise.resolve(shift()));
  chain.maybeSingle = vi.fn(() => Promise.resolve(shift()));
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
  return chain;
}

let serverQueues: Record<string, unknown[]>;
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() =>
    Promise.resolve({ from: (table: string) => makeChain(table, serverQueues) }),
  ),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({ from: (table: string) => makeChain(table, serviceQueues) })),
}));

import {
  cancelMyPairingSession,
  createMyPairingSession,
  getMyPairingStatus,
} from './pairing-self';

beforeEach(() => {
  vi.clearAllMocks();
  serverQueues = { organization_members: [{ data: { org_id: 'org-1' } }] };
  serviceQueues = {};
  ops = [];
  voice.createVoiceSession.mockResolvedValue({ sid: 'svc-1', status: 'pairing', qr: 'wa.me/x', phoneNumber: null });
  voice.getVoiceSession.mockResolvedValue({ sid: 'svc-1', status: 'connected', qr: null, phoneNumber: '5511999990000' });
  voice.deleteVoiceSession.mockResolvedValue(undefined);
});

describe('createMyPairingSession', () => {
  it('creates a voice session for the OWN user and inserts a scoped row', async () => {
    serviceQueues.whatsapp_call_sessions = [{ data: null }]; // no existing session
    const r = await createMyPairingSession();
    expect(r.success).toBe(true);
    // O alvo do serviço de voz é sempre o usuário logado, nunca input do cliente.
    expect(voice.createVoiceSession).toHaveBeenCalledWith('me-1');
    const insert = ops.find((o) => o.op === 'insert');
    expect(insert?.payload).toMatchObject({ org_id: 'org-1', user_id: 'me-1', status: 'pairing' });
  });
});

describe('getMyPairingStatus', () => {
  it('rejects a sid that does not belong to the logged-in user', async () => {
    serviceQueues.whatsapp_call_sessions = [{ data: null }]; // ownership check fails
    const r = await getMyPairingStatus('svc-someone-else');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe('Sessão não pertence a você');
    // Nunca consulta o serviço de voz para uma sessão que não é do usuário.
    expect(voice.getVoiceSession).not.toHaveBeenCalled();
  });

  it('persists connected + phone when the session is the users own', async () => {
    serviceQueues.whatsapp_call_sessions = [{ data: { id: 'row-1' } }]; // ownership ok
    const r = await getMyPairingStatus('svc-1');
    expect(r.success).toBe(true);
    const update = ops.find((o) => o.op === 'update');
    expect(update?.payload).toMatchObject({ status: 'connected', phone_number: '5511999990000' });
    // O update é escopado por user_id (defesa em profundidade).
    expect(update?.eqs).toContainEqual(['user_id', 'me-1']);
  });
});

describe('cancelMyPairingSession', () => {
  it('deletes scoped by the own user_id', async () => {
    const r = await cancelMyPairingSession('svc-1');
    expect(r.success).toBe(true);
    expect(voice.deleteVoiceSession).toHaveBeenCalledWith('svc-1');
    const del = ops.find((o) => o.op === 'delete');
    expect(del?.eqs).toContainEqual(['user_id', 'me-1']);
  });
});
