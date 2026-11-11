import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchPublicHttps: vi.fn(), lookup: vi.fn() }));
vi.mock('@/lib/security/safe-url', () => ({ fetchPublicHttps: mocks.fetchPublicHttps }));
vi.mock('./recover-recording.service', () => ({ lookupRecordingFromApi4Com: mocks.lookup }));
vi.mock('./audio-duration', async () => {
  const { fakeAudioSeconds } = await import('./recording-fake-supabase.testutil');
  return { measureAudioSeconds: (b: Buffer) => Promise.resolve(fakeAudioSeconds(b)) };
});

import { fakeAudio, fakeAudioResponse, makeFakeSupabase, type Row } from './recording-fake-supabase.testutil';
import { repairRecordingsPage } from './recording-repair.service';

const DURABLE = 'https://fs5.api4com.com/durable.mp3';
const PATH = 'org-1/call-1.mp3';

function call(over: Row = {}): Row {
  return {
    id: 'call-1',
    org_id: 'org-1',
    recording_url: 'https://listener.api4com.com/files/listen/a.mp3',
    recording_storage_path: PATH,
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

beforeEach(() => {
  mocks.fetchPublicHttps.mockReset().mockResolvedValue(fakeAudioResponse(365));
  mocks.lookup.mockReset().mockResolvedValue(DURABLE);
});

describe('repairRecordingsPage', () => {
  it('dry-run não grava nada', async () => {
    const fake = makeFakeSupabase([call()], { [PATH]: fakeAudio(12) });

    const page = await repairRecordingsPage(fake.client, { orgId: 'org-1' });

    expect(page.counts.would_repair).toBe(1);
    expect(fake.uploads).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
    expect(fake.storage.get(PATH)!.toString()).toBe('dur:12');
  });

  it('apply sobrescreve a cópia ruim e é idempotente', async () => {
    const fake = makeFakeSupabase([call()], { [PATH]: fakeAudio(12) });

    const first = await repairRecordingsPage(fake.client, { orgId: 'org-1', apply: true });
    expect(first.counts.repaired).toBe(1);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.storage.get(PATH)!.toString()).toBe('dur:365');
    expect((fake.calls[0]!.metadata as Row).recording_persist_status).toBe('ok');

    const second = await repairRecordingsPage(fake.client, { orgId: 'org-1', apply: true });
    expect(second.counts.skipped_ok).toBe(1);
    expect(fake.uploads).toHaveLength(1);
  });

  it('não repara quando o áudio durável também não bate, e marca mismatch', async () => {
    mocks.fetchPublicHttps.mockResolvedValue(fakeAudioResponse(20));
    const fake = makeFakeSupabase([call()], { [PATH]: fakeAudio(12) });

    const page = await repairRecordingsPage(fake.client, { orgId: 'org-1', apply: true });

    expect(page.counts.unrepairable).toBe(1);
    expect(fake.uploads).toHaveLength(0);
    expect((fake.calls[0]!.metadata as Row).recording_persist_status).toBe('mismatch');
  });

  it('filtra por org e pagina por keyset de id', async () => {
    const fake = makeFakeSupabase(
      [
        call({ id: 'a', metadata: { recording_persist_status: 'ok' } }),
        call({ id: 'b', metadata: { recording_persist_status: 'ok' } }),
        call({ id: 'c', metadata: { recording_persist_status: 'ok' } }),
        call({ id: 'z', org_id: 'org-2', metadata: { recording_persist_status: 'ok' } }),
      ],
    );

    const p1 = await repairRecordingsPage(fake.client, { orgId: 'org-1', limit: 2 });
    expect(p1.details.map((d) => d.callId)).toEqual(['a', 'b']);
    expect(p1.nextCursor).toBe('b');

    const p2 = await repairRecordingsPage(fake.client, { orgId: 'org-1', limit: 2, cursor: p1.nextCursor });
    expect(p2.details.map((d) => d.callId)).toEqual(['c']);
    expect(p2.nextCursor).toBeNull();
  });
});
