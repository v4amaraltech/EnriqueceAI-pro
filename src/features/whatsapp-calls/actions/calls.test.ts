import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'sdr@test.com' }),
}));

const voice = vi.hoisted(() => ({
  startVoiceCall: vi.fn(),
  endVoiceCall: vi.fn(),
}));

vi.mock('../services/voice-service-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/voice-service-client')>();
  return { ...actual, ...voice };
});

let sessionResult: unknown;

function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(sessionResult));
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve({ from: () => makeChain() })),
}));

import { VoiceServiceError } from '../services/voice-service-client';
import { endWhatsAppCall, startWhatsAppCall } from './calls';

describe('startWhatsAppCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionResult = { data: { service_session_id: 'sess-1', status: 'connected' } };
  });

  it('starts a call on the SDR connected session', async () => {
    voice.startVoiceCall.mockResolvedValue({ callId: 'call-1' });
    const result = await startWhatsAppCall({ phone: '5511999990000' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sid).toBe('sess-1');
      expect(result.data.callId).toBe('call-1');
    }
    // Gravação sempre ON (story 7.8) → record=true.
    expect(voice.startVoiceCall).toHaveBeenCalledWith('sess-1', '5511999990000', true);
  });

  it('errors when the SDR has no connected session', async () => {
    sessionResult = { data: null };
    const result = await startWhatsAppCall({ phone: '5511999990000' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('não está pareado');
    expect(voice.startVoiceCall).not.toHaveBeenCalled();
  });

  it('maps a not-configured service error to a friendly message', async () => {
    voice.startVoiceCall.mockRejectedValue(new VoiceServiceError('x', 'not_configured'));
    const result = await startWhatsAppCall({ phone: '5511999990000' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('não configurado');
  });
});

describe('endWhatsAppCall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ends the call via the voice service', async () => {
    voice.endVoiceCall.mockResolvedValue(undefined);
    const result = await endWhatsAppCall({ sid: 'sess-1', callId: 'call-1' });
    expect(result.success).toBe(true);
    expect(voice.endVoiceCall).toHaveBeenCalledWith('sess-1', 'call-1');
  });
});
