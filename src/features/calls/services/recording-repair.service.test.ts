import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Row,
  fakeAudio,
  fakeAudioResponse,
  makeFakeSupabase,
} from './recording-fake-supabase.testutil';
import { repairRecordingsPage } from './recording-repair.service';

const mocks = vi.hoisted(() => ({ fetchPublicHttps: vi.fn(), candidates: vi.fn() }));
vi.mock('@/lib/security/safe-url', () => ({ fetchPublicHttps: mocks.fetchPublicHttps }));
vi.mock('./recover-recording.service', () => ({
  lookupRecordingCandidatesFromApi4Com: mocks.candidates,
}));
vi.mock('./audio-duration', async () => {
  const { fakeAudioSeconds } = await import('./recording-fake-supabase.testutil');
  return { measureAudioSeconds: (b: Buffer) => Promise.resolve(fakeAudioSeconds(b)) };
});

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
  mocks.candidates.mockReset().mockImplementation(async function* () {
    yield DURABLE;
  });
});

/** Cada URL responde com a duração indicada; as demais dão 404. */
function respondBy(map: Record<string, number>) {
  mocks.fetchPublicHttps.mockImplementation((url: string) =>
    Promise.resolve(
      url in map ? fakeAudioResponse(map[url]!) : new Response(null, { status: 404 }),
    ),
  );
}

const LISTENER = 'https://listener.api4com.com/files/listen/a.mp3';
const S3 = 'https://s3.sa-east-1.amazonaws.com/pbx-prod-callface/a.mp3';

describe('repairRecordingsPage', () => {
  it('recording_url S3 com duração ok repara sem chamar a API4COM', async () => {
    respondBy({ [S3]: 365 });
    const fake = makeFakeSupabase([call({ recording_url: S3 })], { [PATH]: fakeAudio(12) });

    const page = await repairRecordingsPage(fake.client, { orgId: 'org-1', apply: true });

    expect(page.counts.repaired).toBe(1);
    expect(page.sources).toEqual({ recording_url: 1, api4com: 0 });
    expect(page.details[0]).toMatchObject({ outcome: 'repaired', source: 'recording_url' });
    expect(mocks.candidates).not.toHaveBeenCalled();
    expect(fake.storage.get(PATH)!.toString()).toBe('dur:365');
  });

  it('dry-run com recording_url bom é would_repair, fonte recording_url', async () => {
    respondBy({ [S3]: 365 });
    const fake = makeFakeSupabase([call({ recording_url: S3 })], { [PATH]: fakeAudio(12) });

    const page = await repairRecordingsPage(fake.client, { orgId: 'org-1' });

    expect(page.counts.would_repair).toBe(1);
    expect(page.sources.recording_url).toBe(1);
    expect(mocks.candidates).not.toHaveBeenCalled();
    expect(fake.uploads).toHaveLength(0);
  });

  it('recording_url com duração errada cai na API4COM (fonte api4com)', async () => {
    respondBy({ [LISTENER]: 20, [DURABLE]: 365 });
    const fake = makeFakeSupabase([call()], { [PATH]: fakeAudio(12) });

    const page = await repairRecordingsPage(fake.client, { orgId: 'org-1', apply: true });

    expect(mocks.candidates).toHaveBeenCalledTimes(1);
    expect(page.details[0]).toMatchObject({ outcome: 'repaired', source: 'api4com' });
    expect(page.sources).toEqual({ recording_url: 0, api4com: 1 });
    expect((fake.calls[0] as Row).recording_url).toBe(DURABLE);
  });

  it('ligação curta perto da tolerância: borderline_short e apply não marca mismatch', async () => {
    // 12 s no banco, 20 s no Storage e no link: passa de 5 s mas cabe na folga de 15 s.
    respondBy({ [LISTENER]: 20, [DURABLE]: 20 });
    const fake = makeFakeSupabase([call({ duration_seconds: 12 })], { [PATH]: fakeAudio(20) });

    const page = await repairRecordingsPage(fake.client, { orgId: 'org-1', apply: true });

    expect(page.counts.borderline_short).toBe(1);
    expect(page.counts.unrepairable).toBe(0);
    expect(fake.uploads).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
    expect((fake.calls[0]!.metadata as Row).recording_persist_status).toBeUndefined();
  });

  it('ligação curta com borderline ainda acha cópia que bate de verdade', async () => {
    respondBy({ [LISTENER]: 20, [DURABLE]: 12 });
    const fake = makeFakeSupabase([call({ duration_seconds: 12 })], { [PATH]: fakeAudio(20) });

    const page = await repairRecordingsPage(fake.client, { orgId: 'org-1' });

    expect(page.details[0]).toMatchObject({ outcome: 'would_repair', source: 'api4com' });
  });

  it('ligação curta claramente trocada (12 s contra 365 s) é unrepairable e apply marca mismatch', async () => {
    respondBy({ [LISTENER]: 365, [DURABLE]: 365 });
    const fake = makeFakeSupabase([call({ duration_seconds: 12 })], { [PATH]: fakeAudio(365) });

    const page = await repairRecordingsPage(fake.client, { orgId: 'org-1', apply: true });

    expect(page.counts.unrepairable).toBe(1);
    expect(page.counts.borderline_short).toBe(0);
    expect((fake.calls[0]!.metadata as Row).recording_persist_status).toBe('mismatch');
  });

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
    const fake = makeFakeSupabase([
      call({ id: 'a', metadata: { recording_persist_status: 'ok' } }),
      call({ id: 'b', metadata: { recording_persist_status: 'ok' } }),
      call({ id: 'c', metadata: { recording_persist_status: 'ok' } }),
      call({ id: 'z', org_id: 'org-2', metadata: { recording_persist_status: 'ok' } }),
    ]);

    const p1 = await repairRecordingsPage(fake.client, { orgId: 'org-1', limit: 2 });
    expect(p1.details.map((d) => d.callId)).toEqual(['a', 'b']);
    expect(p1.nextCursor).toBe('b');

    const p2 = await repairRecordingsPage(fake.client, {
      orgId: 'org-1',
      limit: 2,
      cursor: p1.nextCursor,
    });
    expect(p2.details.map((d) => d.callId)).toEqual(['c']);
    expect(p2.nextCursor).toBeNull();
  });

  describe('Callface (S3) com fone e hora batendo: duration_divergent', () => {
    const CALLFACE =
      'https://s3.sa-east-1.amazonaws.com/pbx-prod-callface/recordings/2026/11/11/OUT-X-TEL-5511999999999-DT-20261111-HR-0700-CALLID-abc.mp3';
    const cf = (over: Row = {}) =>
      call({
        recording_url: CALLFACE,
        started_at: '2026-11-11T10:00:30Z',
        duration_seconds: 60,
        ...over,
      });

    it('dry-run classifica duration_divergent sem buscar na API4COM', async () => {
      respondBy({ [CALLFACE]: 140 });
      const fake = makeFakeSupabase([cf()], { [PATH]: fakeAudio(140) });

      const page = await repairRecordingsPage(fake.client, { orgId: 'org-1' });

      expect(page.counts.duration_divergent).toBe(1);
      expect(page.counts.unrepairable).toBe(0);
      expect(mocks.candidates).not.toHaveBeenCalled();
      expect(fake.updates).toHaveLength(0);
    });

    it('apply não marca mismatch, grava só a flag e mantém a cópia servida', async () => {
      respondBy({ [CALLFACE]: 140 });
      const fake = makeFakeSupabase([cf({ metadata: { recording_persist_status: 'mismatch' } })], {
        [PATH]: fakeAudio(140),
      });

      const page = await repairRecordingsPage(fake.client, { orgId: 'org-1', apply: true });

      expect(page.counts.duration_divergent).toBe(1);
      expect(fake.uploads).toHaveLength(0);
      const meta = fake.calls[0]!.metadata as Row;
      expect(meta.recording_persist_status).toBe('unverified');
      expect(meta.recording_duration_divergent).toBe(true);
      expect(meta.recording_audio_seconds).toBeUndefined();
    });

    it('telefone diferente continua unrepairable', async () => {
      respondBy({ [CALLFACE]: 140 });
      const fake = makeFakeSupabase([cf({ destination: '5511888888888' })], {
        [PATH]: fakeAudio(140),
      });

      const page = await repairRecordingsPage(fake.client, { orgId: 'org-1' });

      expect(page.counts.unrepairable).toBe(1);
      expect(page.counts.duration_divergent).toBe(0);
    });

    it('Storage com áudio diferente do Callface não vira duration_divergent', async () => {
      respondBy({ [CALLFACE]: 140 });
      const fake = makeFakeSupabase([cf()], { [PATH]: fakeAudio(300) });

      const page = await repairRecordingsPage(fake.client, { orgId: 'org-1' });

      expect(page.counts.duration_divergent).toBe(0);
      expect(page.counts.unrepairable).toBe(1);
    });
  });

  describe('URL compartilhada entre ligações', () => {
    const sibling = (over: Row = {}) =>
      call({
        id: 'call-0',
        recording_storage_path: null,
        metadata: { recording_persist_status: 'ok' },
        ...over,
      });

    it('outra ligação com a mesma URL e duração que também bate: ambiguous_shared_url, nada gravado', async () => {
      respondBy({ [LISTENER]: 365 });
      mocks.candidates.mockImplementation(async function* () {});
      const fake = makeFakeSupabase([sibling({ duration_seconds: 360 }), call()], {
        [PATH]: fakeAudio(12),
      });

      const page = await repairRecordingsPage(fake.client, { orgId: 'org-1', apply: true });

      const d = page.details.find((x) => x.callId === 'call-1')!;
      expect(d).toMatchObject({
        outcome: 'ambiguous_shared_url',
        source: 'recording_url',
        sharedWith: ['call-0'],
      });
      expect(page.counts.ambiguous_shared_url).toBe(1);
      expect(fake.uploads).toHaveLength(0);
      expect((fake.calls[1]!.metadata as Row).recording_persist_status).toBeUndefined();
    });

    it('irmã com duração que não bate: caso claro, repara', async () => {
      respondBy({ [LISTENER]: 365 });
      const fake = makeFakeSupabase([sibling({ duration_seconds: 20 }), call()], {
        [PATH]: fakeAudio(12),
      });

      const page = await repairRecordingsPage(fake.client, { orgId: 'org-1' });

      expect(page.details.find((x) => x.callId === 'call-1')).toMatchObject({
        outcome: 'would_repair',
        source: 'recording_url',
      });
    });

    it('ambígua no link salvo mas a API4COM acha cópia própria: repara pela API4COM', async () => {
      respondBy({ [LISTENER]: 365, [DURABLE]: 365 });
      const fake = makeFakeSupabase([sibling({ duration_seconds: 365 }), call()], {
        [PATH]: fakeAudio(12),
      });

      const page = await repairRecordingsPage(fake.client, { orgId: 'org-1' });

      expect(page.details.find((x) => x.callId === 'call-1')).toMatchObject({
        outcome: 'would_repair',
        source: 'api4com',
      });
    });
  });
});
