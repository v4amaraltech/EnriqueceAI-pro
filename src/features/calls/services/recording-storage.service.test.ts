import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchPublicHttps: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock('@/lib/security/safe-url', () => ({ fetchPublicHttps: mocks.fetchPublicHttps }));
vi.mock('./recover-recording.service', () => ({ lookupRecordingFromApi4Com: mocks.lookup }));
vi.mock('./audio-duration', async () => {
  const { fakeAudioSeconds } = await import('./recording-fake-supabase.testutil');
  return { measureAudioSeconds: (b: Buffer) => Promise.resolve(fakeAudioSeconds(b)) };
});

import { fakeAudio, fakeAudioResponse, makeFakeSupabase, type Row } from './recording-fake-supabase.testutil';
import { persistCallRecording } from './recording-storage.service';

const noSleep = () => Promise.resolve();
const LIVE = 'https://listener.api4com.com/files/listen/live.mp3';
const DURABLE = 'https://fs5.api4com.com/durable.mp3';

function call(over: Row = {}): Row {
  return {
    id: 'call-1',
    org_id: 'org-1',
    recording_url: LIVE,
    recording_storage_path: null,
    metadata: {},
    destination: '5511999999999',
    started_at: null,
    created_at: '2026-11-11T10:00:00Z',
    user_id: 'u1',
    origin: '1001',
    duration_seconds: 365,
    ...over,
  };
}

function respondWith(map: Record<string, Array<ReturnType<typeof fakeAudioResponse> | null>>) {
  const idx: Record<string, number> = {};
  mocks.fetchPublicHttps.mockImplementation((url: string) => {
    const seq = map[url] ?? [];
    const i = idx[url] ?? 0;
    idx[url] = i + 1;
    return Promise.resolve(seq[Math.min(i, seq.length - 1)] ?? null);
  });
}

beforeEach(() => {
  mocks.fetchPublicHttps.mockReset();
  mocks.lookup.mockReset().mockResolvedValue(null);
});

describe('persistCallRecording', () => {
  it('recusa áudio truncado (12 s contra 365 s) e marca mismatch sem subir', async () => {
    const fake = makeFakeSupabase([call()]);
    respondWith({ [LIVE]: [fakeAudioResponse(12)] });

    const result = await persistCallRecording(fake.client, 'call-1', { retryDelaysMs: [1, 1], sleep: noSleep });

    expect(result).toMatchObject({ ok: false, reason: 'duration_mismatch' });
    expect(fake.uploads).toHaveLength(0);
    expect(fake.calls[0]!.recording_storage_path).toBeNull();
    expect((fake.calls[0]!.metadata as Row).recording_persist_status).toBe('mismatch');
  });

  it('tenta de novo e sobe quando um download posterior bate', async () => {
    const fake = makeFakeSupabase([call()]);
    respondWith({ [LIVE]: [fakeAudioResponse(6), fakeAudioResponse(200), fakeAudioResponse(364)] });
    const sleep = vi.fn(noSleep);

    const result = await persistCallRecording(fake.client, 'call-1', { retryDelaysMs: [1, 1, 1], sleep });

    expect(result).toMatchObject({ ok: true, status: 'ok', path: 'org-1/call-1.mp3' });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fake.uploads).toHaveLength(1);
    expect((fake.calls[0]!.metadata as Row).recording_persist_status).toBe('ok');
  });

  it('duração estável e errada pula as esperas e vai ao link durável', async () => {
    const fake = makeFakeSupabase([call()]);
    mocks.lookup.mockResolvedValue(DURABLE);
    respondWith({ [LIVE]: [fakeAudioResponse(30)], [DURABLE]: [fakeAudioResponse(365)] });
    const sleep = vi.fn(noSleep);

    const result = await persistCallRecording(fake.client, 'call-1', { retryDelaysMs: [1, 1, 1], sleep });

    expect(result.ok).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fake.calls[0]!.recording_url).toBe(DURABLE);
  });

  it('sobrescreve cópia existente que não bate, após download validado', async () => {
    const fake = makeFakeSupabase(
      [call({ recording_storage_path: 'org-1/call-1.mp3' })],
      { 'org-1/call-1.mp3': fakeAudio(12) },
    );
    respondWith({ [LIVE]: [fakeAudioResponse(365)] });

    const result = await persistCallRecording(fake.client, 'call-1', { retryDelaysMs: [], sleep: noSleep });

    expect(result.alreadyStored).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.storage.get('org-1/call-1.mp3')!.toString()).toBe('dur:365');
  });

  it('cópia existente que bate continua alreadyStored e não baixa nada', async () => {
    const fake = makeFakeSupabase(
      [call({ recording_storage_path: 'org-1/call-1.mp3' })],
      { 'org-1/call-1.mp3': fakeAudio(360) },
    );

    const result = await persistCallRecording(fake.client, 'call-1', { retryDelaysMs: [], sleep: noSleep });

    expect(result).toMatchObject({ ok: true, alreadyStored: true });
    expect(mocks.fetchPublicHttps).not.toHaveBeenCalled();
  });

  it('não baixa recordUrl já ligada a outra ligação do mesmo ramal e usa o link durável', async () => {
    const fake = makeFakeSupabase([
      call(),
      call({ id: 'call-0', created_at: '2026-11-11T09:00:00Z' }), // anterior, mesmo ramal e mesma URL
    ]);
    mocks.lookup.mockResolvedValue(DURABLE);
    respondWith({ [LIVE]: [fakeAudioResponse(365)], [DURABLE]: [fakeAudioResponse(366)] });

    const result = await persistCallRecording(fake.client, 'call-1', { retryDelaysMs: [], sleep: noSleep });

    expect(result.ok).toBe(true);
    const fetched = mocks.fetchPublicHttps.mock.calls.map((c) => c[0]);
    expect(fetched).not.toContain(LIVE);
    expect(fetched).toContain(DURABLE);
    expect(fake.calls[0]!.recording_url).toBe(DURABLE);
  });

  it('eTag igual ao de outra ligação do ramal descarta a URL viva', async () => {
    const fake = makeFakeSupabase([
      call(),
      call({ id: 'call-0', recording_url: 'https://other/x.mp3', metadata: { recording_etag: 'E1' } }),
    ]);
    mocks.lookup.mockResolvedValue(DURABLE);
    respondWith({ [LIVE]: [fakeAudioResponse(365, 'E1')], [DURABLE]: [fakeAudioResponse(365, 'E2')] });

    const result = await persistCallRecording(fake.client, 'call-1', { retryDelaysMs: [], sleep: noSleep });

    expect(result.ok).toBe(true);
    expect(fake.uploads[0]!.path).toBe('org-1/call-1.mp3');
    expect((fake.calls[0]!.metadata as Row).recording_etag).toBe('E2');
  });
});
