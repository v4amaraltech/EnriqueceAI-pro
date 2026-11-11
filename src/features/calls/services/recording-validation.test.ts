import { describe, expect, it } from 'vitest';

import {
  classifyRecordingDuration,
  findReusedRecordingOwner,
  isDurationStable,
  recordingDurationMismatches,
  recordingToleranceSeconds,
} from './recording-validation';
import { shouldPersistRecordingOnEvent } from '../recording-trigger';
import { shouldServeStoredRecording } from './recording-proxy';

describe('duração da gravação', () => {
  it('tolerância é o maior entre 15% e 5 s', () => {
    expect(recordingToleranceSeconds(10)).toBe(5);
    expect(recordingToleranceSeconds(200)).toBe(30);
  });

  it('recusa 12 s contra 365 s e aceita arredondamento', () => {
    expect(recordingDurationMismatches(12, 365)).toBe(true);
    expect(classifyRecordingDuration(58, 60)).toBe('ok');
    expect(classifyRecordingDuration(33, 30)).toBe('ok');
  });

  it('sem medida ou sem duração da ligação fica unverified', () => {
    expect(classifyRecordingDuration(null, 60)).toBe('unverified');
    expect(classifyRecordingDuration(60, 0)).toBe('unverified');
  });

  it('estabilidade entre tentativas', () => {
    expect(isDurationStable(6, 6.2)).toBe(true);
    expect(isDurationStable(6, 12)).toBe(false);
    expect(isDurationStable(null, 6)).toBe(false);
  });
});

describe('findReusedRecordingOwner', () => {
  const call = { id: 'c2', org_id: 'o1', origin: '1001', destination: '551199' };
  it('acha outra ligação do mesmo ramal com a mesma URL', () => {
    const others = [{ id: 'c1', org_id: 'o1', origin: '1001', recording_url: 'u1' }];
    expect(findReusedRecordingOwner(call, others, { url: 'u1', etag: null })).toBe('c1');
  });
  it('acha por eTag', () => {
    const others = [{ id: 'c1', org_id: 'o1', origin: '1001', recording_url: 'x', metadata: { recording_etag: 'e' } }];
    expect(findReusedRecordingOwner(call, others, { url: 'u9', etag: 'e' })).toBe('c1');
  });
  it('ignora outro ramal, outra org e a própria ligação', () => {
    const others = [
      { id: 'c1', org_id: 'o1', origin: '2002', recording_url: 'u1' },
      { id: 'c3', org_id: 'o2', origin: '1001', recording_url: 'u1' },
      { id: 'c2', org_id: 'o1', origin: '1001', recording_url: 'u1' },
    ];
    expect(findReusedRecordingOwner(call, others, { url: 'u1', etag: null })).toBeNull();
  });
});

describe('shouldPersistRecordingOnEvent', () => {
  it('não dispara no channel-answer, mesmo com recordUrl', () => {
    expect(shouldPersistRecordingOnEvent('channel-answer', { recordUrl: 'https://x/a.mp3' })).toBe(false);
  });
  it('dispara no channel-hangup com recordUrl ou URL já salva no answer', () => {
    expect(shouldPersistRecordingOnEvent('channel-hangup', { recordUrl: 'https://x/a.mp3' })).toBe(true);
    expect(shouldPersistRecordingOnEvent('channel-hangup', { existingRecordingUrl: 'https://x/a.mp3' })).toBe(true);
    expect(shouldPersistRecordingOnEvent('channel-hangup', {})).toBe(false);
  });
});

describe('proxy: shouldServeStoredRecording', () => {
  const base = { recording_storage_path: 'o/c.mp3', duration_seconds: 365, metadata: null };
  it('serve cópia sem flag', () => {
    expect(shouldServeStoredRecording(base)).toBe(true);
  });
  it('pula cópia flagada como mismatch', () => {
    expect(shouldServeStoredRecording({ ...base, metadata: { recording_persist_status: 'mismatch' } })).toBe(false);
  });
  it('pula cópia cuja duração medida não bate', () => {
    expect(shouldServeStoredRecording({ ...base, metadata: { recording_audio_seconds: 12 } })).toBe(false);
  });
  it('sem path não serve', () => {
    expect(shouldServeStoredRecording({ ...base, recording_storage_path: null })).toBe(false);
  });
});
