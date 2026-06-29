import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({ getEnv: vi.fn() }));

import { getEnv } from '@/config/env';
import {
  VoiceServiceError,
  createVoiceSession,
  endVoiceCall,
  exchangeVoiceSdp,
  getVoiceSession,
  isVoiceServiceConfigured,
  startVoiceCall,
} from './voice-service-client';

const mockEnv = getEnv as unknown as ReturnType<typeof vi.fn>;
const CONFIGURED = { WACALLS_BASE_URL: 'https://voice.test', WACALLS_API_KEY: 'secret-key' };

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('voice-service-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.mockReturnValue(CONFIGURED);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports configuration state', () => {
    mockEnv.mockReturnValue(CONFIGURED);
    expect(isVoiceServiceConfigured()).toBe(true);
    mockEnv.mockReturnValue({});
    expect(isVoiceServiceConfigured()).toBe(false);
  });

  it('throws not_configured when env is missing', async () => {
    mockEnv.mockReturnValue({});
    await expect(createVoiceSession('SDR')).rejects.toMatchObject({
      name: 'VoiceServiceError',
      code: 'not_configured',
    });
  });

  it('sends the API key header and normalizes a created session', async () => {
    mockFetchOnce({ id: 's1', paired: false, qr: 'data:image/png;base64,AAA' });
    const session = await createVoiceSession('SDR');

    expect(session).toEqual({ sid: 's1', status: 'pairing', phoneNumber: null, qr: 'data:image/png;base64,AAA' });
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('https://voice.test/api/sessions');
    expect((call[1].headers as Record<string, string>)['X-API-Key']).toBe('secret-key');
  });

  it('maps paired session → connected and jid → phone number', async () => {
    mockFetchOnce([
      { id: 's1', jid: '5511999990000@s.whatsapp.net', paired: true },
      { id: 's2', status: 'disconnected' },
    ]);
    const session = await getVoiceSession('s1');
    expect(session).toEqual({ sid: 's1', status: 'connected', phoneNumber: '5511999990000', qr: null });
  });

  it('maps an explicitly disconnected session', async () => {
    mockFetchOnce([{ id: 's2', status: 'disconnected' }]);
    expect((await getVoiceSession('s2'))?.status).toBe('disconnected');
  });

  it('returns null when the session is not in the list', async () => {
    mockFetchOnce([{ id: 'other' }]);
    expect(await getVoiceSession('s1')).toBeNull();
  });

  it('reads the call id from the { call: { callId } } shape and sends duration_ms', async () => {
    mockFetchOnce({ call: { callId: 'c1' } });
    expect(await startVoiceCall('s1', '5511999990000', true)).toEqual({ callId: 'c1' });
    const body = JSON.parse(
      ((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body) as string,
    );
    expect(body).toMatchObject({ phone: '5511999990000', record: true, duration_ms: 300000 });
  });

  it('exchanges SDP offer for answer', async () => {
    mockFetchOnce({ sdp_answer: 'v=0\r\n(answer)' });
    expect(await exchangeVoiceSdp('s1', 'c1', 'v=0\r\n(offer)')).toBe('v=0\r\n(answer)');
  });

  it('raises request_failed on a non-ok response', async () => {
    mockFetchOnce({}, false, 502);
    await expect(getVoiceSession('s1')).rejects.toBeInstanceOf(VoiceServiceError);
  });

  it('raises request_failed when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    await expect(endVoiceCall('s1', 'c1')).rejects.toMatchObject({ code: 'request_failed' });
  });
});
