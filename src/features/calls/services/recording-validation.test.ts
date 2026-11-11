import { describe, expect, it } from 'vitest';

import { shouldPersistRecordingOnEvent } from '../recording-trigger';
import { shouldServeStoredRecording } from './recording-proxy';
import {
  callfaceRecordingMatchesCall,
  classifyRecordingDuration,
  classifyRepairDuration,
  findReusedRecordingOwner,
  isDurationStable,
  parseCallfaceRecordingUrl,
  recordingDurationMismatches,
  recordingToleranceSeconds,
} from './recording-validation';

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
    const others = [
      {
        id: 'c1',
        org_id: 'o1',
        origin: '1001',
        recording_url: 'x',
        metadata: { recording_etag: 'e' },
      },
    ];
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
    expect(shouldPersistRecordingOnEvent('channel-answer', { recordUrl: 'https://x/a.mp3' })).toBe(
      false,
    );
  });
  it('dispara no channel-hangup com recordUrl ou URL já salva no answer', () => {
    expect(shouldPersistRecordingOnEvent('channel-hangup', { recordUrl: 'https://x/a.mp3' })).toBe(
      true,
    );
    expect(
      shouldPersistRecordingOnEvent('channel-hangup', { existingRecordingUrl: 'https://x/a.mp3' }),
    ).toBe(true);
    expect(shouldPersistRecordingOnEvent('channel-hangup', {})).toBe(false);
  });
});

describe('proxy: shouldServeStoredRecording', () => {
  const base = { recording_storage_path: 'o/c.mp3', duration_seconds: 365, metadata: null };
  it('serve cópia sem flag', () => {
    expect(shouldServeStoredRecording(base)).toBe(true);
  });
  it('pula cópia flagada como mismatch', () => {
    expect(
      shouldServeStoredRecording({ ...base, metadata: { recording_persist_status: 'mismatch' } }),
    ).toBe(false);
  });
  it('pula cópia cuja duração medida não bate', () => {
    expect(shouldServeStoredRecording({ ...base, metadata: { recording_audio_seconds: 12 } })).toBe(
      false,
    );
  });
  it('sem path não serve', () => {
    expect(shouldServeStoredRecording({ ...base, recording_storage_path: null })).toBe(false);
  });
  it('serve cópia do Callface marcada como duração divergente', () => {
    expect(
      shouldServeStoredRecording({
        ...base,
        metadata: { recording_duration_divergent: true, recording_audio_seconds: 12 },
      }),
    ).toBe(true);
  });
});

describe('classifyRepairDuration (borderline_short)', () => {
  it('curta perto da tolerância é borderline_short', () => {
    expect(classifyRecordingDuration(20, 12)).toBe('mismatch');
    expect(classifyRepairDuration(20, 12)).toBe('borderline_short');
    expect(classifyRepairDuration(27, 12)).toBe('borderline_short');
  });

  it('curta claramente trocada continua mismatch', () => {
    expect(classifyRepairDuration(365, 12)).toBe('mismatch');
    expect(classifyRepairDuration(28, 12)).toBe('mismatch');
  });

  it('ligação acima de 30 s não tem borderline', () => {
    expect(classifyRepairDuration(70, 40)).toBe('mismatch');
  });

  it('dentro da tolerância segue ok e sem medida segue unverified', () => {
    expect(classifyRepairDuration(14, 12)).toBe('ok');
    expect(classifyRepairDuration(null, 12)).toBe('unverified');
  });
});

describe('callface (S3) recording name', () => {
  const URL_OK =
    'https://s3.sa-east-1.amazonaws.com/pbx-prod-callface/recordings/2026/09/25/OUT-Jo%C3%A3oFoga%C3%A7a-TEL-5554981122370-DT-20260925-HR-1707-CALLID-231e52a9.mp3';
  const call = {
    destination: '+55 54 98112-2370',
    started_at: '2026-09-25T20:07:40Z', // 17:07:40 BRT
    created_at: '2026-09-25T20:07:30Z',
  };

  it('lê telefone e horário (BRT) do nome', () => {
    const name = parseCallfaceRecordingUrl(URL_OK);
    expect(name?.phone).toBe('5554981122370');
    expect(name?.at.toISOString()).toBe('2026-09-25T20:07:00.000Z');
  });

  it('ignora URL que não é do Callface no S3', () => {
    expect(parseCallfaceRecordingUrl('https://listener.api4com.com/files/listen/a.mp3')).toBeNull();
    expect(
      parseCallfaceRecordingUrl(
        'https://s3.sa-east-1.amazonaws.com/outro-bucket/TEL-1-DT-20260925-HR-1707.mp3',
      ),
    ).toBeNull();
    expect(
      parseCallfaceRecordingUrl(
        'https://evil.example.com/pbx-prod-callface/TEL-5554981122370-DT-20260925-HR-1707.mp3',
      ),
    ).toBeNull();
    expect(parseCallfaceRecordingUrl(null)).toBeNull();
  });

  it('bate quando fone e hora (até 2 min) conferem', () => {
    expect(callfaceRecordingMatchesCall(URL_OK, call)).toBe(true);
    expect(
      callfaceRecordingMatchesCall(URL_OK, { ...call, started_at: '2026-09-25T20:08:59Z' }),
    ).toBe(true);
  });

  it('não bate com outro telefone ou fora da janela', () => {
    expect(callfaceRecordingMatchesCall(URL_OK, { ...call, destination: '5554981129999' })).toBe(
      false,
    );
    expect(
      callfaceRecordingMatchesCall(URL_OK, { ...call, started_at: '2026-09-25T20:10:30Z' }),
    ).toBe(false);
    expect(
      callfaceRecordingMatchesCall(URL_OK, {
        ...call,
        started_at: null,
        created_at: '2026-09-25T20:07:10Z',
      }),
    ).toBe(true);
  });
});
