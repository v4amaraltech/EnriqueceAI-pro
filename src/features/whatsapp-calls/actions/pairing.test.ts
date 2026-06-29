import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-manager', () => ({
  requireManager: vi.fn().mockResolvedValue({ id: 'mgr-1', email: 'mgr@test.com' }),
}));

const voice = vi.hoisted(() => ({
  createVoiceSession: vi.fn(),
  getVoiceSession: vi.fn(),
  pairVoiceSession: vi.fn(),
}));

vi.mock('../services/voice-service-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/voice-service-client')>();
  return { ...actual, ...voice };
});

// Per-table result queues consumed in call order by terminal methods.
let queues: Record<string, unknown[]>;

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'update', 'insert', 'delete', 'in', 'not', 'lte', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  const shift = () => (queues[table]?.shift() ?? { data: null, error: null });
  chain.single = vi.fn(() => Promise.resolve(shift()));
  chain.maybeSingle = vi.fn(() => Promise.resolve(shift()));
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve, reject);
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() =>
    Promise.resolve({ from: (table: string) => makeChain(table) }),
  ),
}));

import { VoiceServiceError } from '../services/voice-service-client';
import { createPairingSession, getPairingStatus } from './pairing';

describe('pairing actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queues = {};
  });

  it('creates a pairing session and persists it (manager + valid target)', async () => {
    queues.organization_members = [
      { data: { org_id: 'org-1' } }, // managerOrgId()
      { data: { user_id: 'sdr-1' } }, // target membership check
    ];
    queues.whatsapp_call_sessions = [
      { data: null }, // no existing row → insert path
    ];
    voice.createVoiceSession.mockResolvedValue({
      sid: 'sess-1',
      status: 'pairing',
      qr: 'data:image/png;base64,AAAA',
      phoneNumber: null,
    });

    const result = await createPairingSession('11111111-1111-1111-1111-111111111111');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sid).toBe('sess-1');
      expect(result.data.qr).toContain('data:image');
      expect(result.data.status).toBe('pairing');
    }
    expect(voice.createVoiceSession).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });

  it('rejects an invalid target uuid', async () => {
    queues.organization_members = [{ data: { org_id: 'org-1' } }];
    const result = await createPairingSession('not-a-uuid');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('SDR inválido');
    expect(voice.createVoiceSession).not.toHaveBeenCalled();
  });

  it('returns a friendly error when the voice service is not configured', async () => {
    queues.organization_members = [
      { data: { org_id: 'org-1' } },
      { data: { user_id: 'sdr-1' } },
    ];
    voice.createVoiceSession.mockRejectedValue(
      new VoiceServiceError('no config', 'not_configured'),
    );

    const result = await createPairingSession('11111111-1111-1111-1111-111111111111');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('não configurado');
  });

  it('marks the session connected and returns the phone number on poll', async () => {
    queues.organization_members = [{ data: { org_id: 'org-1' } }];
    voice.getVoiceSession.mockResolvedValue({
      sid: 'sess-1',
      status: 'connected',
      qr: null,
      phoneNumber: '5511999990000',
    });

    const result = await getPairingStatus('sess-1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('connected');
      expect(result.data.phoneNumber).toBe('5511999990000');
    }
  });
});
