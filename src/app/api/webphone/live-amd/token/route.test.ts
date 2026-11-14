import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const flag = vi.hoisted(() => ({ isWebphoneLiveAmdEnabled: vi.fn(), isWebphoneVoicemailAutoHangupEnabled: vi.fn() }));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('@/features/integrations/webphone/live-amd-flag', () => flag);

import { POST } from './route';

describe('POST /api/webphone/live-amd/token', () => {
  beforeEach(() => {
    auth.getAuthOrgIdResult.mockReset();
    flag.isWebphoneLiveAmdEnabled.mockReset();
    flag.isWebphoneVoicemailAutoHangupEnabled.mockReset();
    flag.isWebphoneVoicemailAutoHangupEnabled.mockResolvedValue(true);
    delete process.env.ASSEMBLYAI_API_KEY;
    delete process.env.ASSEMBLYAI_STREAMING_REGION;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sem sessão não emite token', async () => {
    auth.getAuthOrgIdResult.mockResolvedValue({ success: false, error: 'não autenticado' });
    const response = await POST();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ enabled: false });
  });

  it('com a flag desligada não chama a AssemblyAI', async () => {
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', role: 'sdr', supabase: {} } });
    flag.isWebphoneLiveAmdEnabled.mockResolvedValue(false);
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, autoHangup: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sem a flag do desligamento automático não emite token (captura fica desligada)', async () => {
    process.env.ASSEMBLYAI_API_KEY = 'chave-permanente';
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', role: 'sdr', supabase: {} } });
    flag.isWebphoneLiveAmdEnabled.mockResolvedValue(true);
    flag.isWebphoneVoicemailAutoHangupEnabled.mockResolvedValue(false);
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    expect(await POST().then((response) => response.json())).toEqual({ enabled: false, autoHangup: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sem chave responde desligado e não chama a rede', async () => {
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', role: 'sdr', supabase: {} } });
    flag.isWebphoneLiveAmdEnabled.mockResolvedValue(true);
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    expect(await POST().then((response) => response.json())).toEqual({ enabled: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('troca a chave por um token curto e não devolve a chave', async () => {
    process.env.ASSEMBLYAI_API_KEY = 'chave-permanente';
    process.env.ASSEMBLYAI_STREAMING_REGION = 'eu';
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', role: 'sdr', supabase: {} } });
    flag.isWebphoneLiveAmdEnabled.mockResolvedValue(true);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: 'token-curto', expires_in_seconds: 60 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.autoHangup).toBe(true);
    expect(body.token).toBe('token-curto');
    expect(body.websocketUrl).toContain('wss://streaming.eu.assemblyai.com/v3/ws');
    expect(body.websocketUrl).toContain('speech_model=universal-streaming-multilingual');
    expect(JSON.stringify(body)).not.toContain('chave-permanente');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://token.eu.assemblyai.com/v1/token');
    expect((init.headers as Record<string, string>).Authorization).toBe('chave-permanente');
    expect(String(init.body)).toContain('"product":"streaming"');
  });
});
