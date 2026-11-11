import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { type AssemblyAiClient, createAssemblyAiClient } from './assemblyai.client';
import {
  assessAudioDuration,
  downmixToMonoPcm16,
  durationMatches,
  encodeWavMono16,
  prepareMonoAudio,
} from './audio';
import { ASSEMBLYAI_KEYTERMS_PROMPT } from './constants';
import { shouldTriggerEngineOnHangup } from './flag';
import {
  type JevClient,
  type JevResponse,
  buildJevQuestions,
  buildSummary,
  mapJevResponse,
} from './jev.client';
import { aggregateDaily } from './monitoring';
import { type EngineDeps, processEngineCall } from './orchestrator';
import { triggerTranscriptionEngine } from './trigger';

type Row = Record<string, unknown>;

/** Banco em memória com o mínimo do builder do Supabase usado pelo orquestrador. */
function fakeDb(call: Row | null, seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    call_transcripts_v2: [],
    call_qualifications: [],
    ...seed,
  };
  const writes: Array<{ table: string; op: string; data: Row }> = [];
  let seq = 0;
  const db = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let mode: 'select' | 'update' | 'insert' = 'select';
      let payload: Row = {};
      const matches = (r: Row) => filters.every(([k, v]) => r[k] === v);
      const result = () => {
        if (table === 'calls') return { data: call, error: null };
        const rows = tables[table] ?? (tables[table] = []);
        if (mode === 'insert') {
          const row = { id: `id-${++seq}`, updated_at: new Date().toISOString(), ...payload };
          rows.push(row);
          writes.push({ table, op: 'insert', data: payload });
          return { data: [row], error: null };
        }
        if (mode === 'update') {
          const hit = rows.filter(matches);
          hit.forEach((r) => Object.assign(r, payload));
          writes.push({ table, op: 'update', data: payload });
          return { data: hit, error: null };
        }
        return { data: rows.filter(matches), error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (d: Row) => ((mode = 'insert'), (payload = d), b),
        update: (d: Row) => ((mode = 'update'), (payload = d), b),
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        limit: () => b,
        single: () => Promise.resolve(result()),
        then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
      };
      return b;
    },
  };
  return { db: db as never, tables, writes };
}

const CALL = {
  id: 'call-1',
  org_id: 'org-1',
  user_id: 'u1',
  recording_url: 'https://rec.example.com/a.mp3',
  duration_seconds: 60,
  answered_at: '2026-11-11T10:00:00Z',
  started_at: '2026-11-11T10:00:00Z',
  created_at: '2026-11-11T10:00:00Z',
  destination: '5511999999999',
  origin: '1001',
  type: 'outbound',
  metadata: null,
};

const jevOk = (over: Partial<Record<string, unknown>> = {}): JevResponse => ({
  model: 'jev-1.14.0',
  usage: { input_tokens: 1000, output_tokens: 5 },
  answers: {
    outcome: { type: 'choice', choice: 'callback', confidence: 0.9 },
    interest: { type: 'score', score: 1.8, confidence: 0.8 },
    has_objections: { type: 'noul', noul: 0.1 },
    objection_type: { type: 'choice', choice: 'price', confidence: 0.2 },
    next_step_suggestion: { type: 'choice', choice: 'callback', confidence: 0.85 },
    ...over,
  } as JevResponse['answers'],
});

function makeDeps(db: unknown, over: Partial<EngineDeps> = {}) {
  const transcribe = vi.fn().mockResolvedValue({
    text: 'Olá, tudo bem? Pode me ligar amanhã.',
    utterances: [
      { speaker: 'A', text: 'Olá, tudo bem?', start: 0, end: 1000 },
      { speaker: 'B', text: 'Pode me ligar amanhã.', start: 1000, end: 2000 },
    ],
    speakersCount: 2,
    audioSeconds: 60,
    model: 'universal-3-5-pro',
  });
  const qualify = vi.fn().mockImplementation(async (input) => mapJevResponse(jevOk(), input));
  const assembly: AssemblyAiClient = { transcribe };
  const jev: JevClient = { qualify };
  const deps: Partial<EngineDeps> = {
    db: db as never,
    isEnabled: vi.fn().mockResolvedValue(true),
    downloadAudio: vi.fn().mockResolvedValue(Buffer.from('x')),
    lookupRecording: vi.fn().mockResolvedValue(null),
    prepareAudio: vi
      .fn()
      .mockResolvedValue({
        wav: Buffer.from('w'),
        durationSeconds: 60,
        sampleRate: 8000,
        sourceChannels: 2,
      }),
    assemblyAi: () => assembly,
    jev: () => jev,
    now: () => Date.now(),
    ...over,
  };
  return { deps, transcribe, qualify };
}

describe('processEngineCall', () => {
  it('flag off: não chama provedores nem grava', async () => {
    const { db, writes } = fakeDb(CALL);
    const { deps, transcribe, qualify } = makeDeps(db, {
      isEnabled: vi.fn().mockResolvedValue(false),
    });
    expect(await processEngineCall('call-1', deps)).toBe('flag_off');
    expect(transcribe).not.toHaveBeenCalled();
    expect(qualify).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('duração < 30s: grava skipped sem chamar provedor', async () => {
    const { db, tables } = fakeDb({ ...CALL, duration_seconds: 20 });
    const { deps, transcribe } = makeDeps(db);
    expect(await processEngineCall('call-1', deps)).toBe('skipped');
    expect(transcribe).not.toHaveBeenCalled();
    expect(tables.call_transcripts_v2?.[0]).toMatchObject({
      status: 'skipped',
      error: 'duration_too_short',
    });
  });

  it('não atendida: sem linha', async () => {
    const { db, writes } = fakeDb({ ...CALL, answered_at: null });
    const { deps } = makeDeps(db);
    expect(await processEngineCall('call-1', deps)).toBe('not_eligible');
    expect(writes).toHaveLength(0);
  });

  it('divergência de duração: não transcreve e registra duration_mismatch', async () => {
    const { db, tables } = fakeDb(CALL);
    const { deps, transcribe } = makeDeps(db, {
      prepareAudio: vi
        .fn()
        .mockResolvedValue({
          wav: Buffer.from('w'),
          durationSeconds: 20,
          sampleRate: 8000,
          sourceChannels: 1,
        }),
    });
    expect(await processEngineCall('call-1', deps)).toBe('skipped');
    expect(transcribe).not.toHaveBeenCalled();
    expect(String(tables.call_transcripts_v2?.[0]?.error)).toMatch(/^duration_mismatch/);
  });

  it('áudio maior que o banco (66s vs 85,2s): transcreve e grava duration_warning', async () => {
    const { db, tables } = fakeDb({ ...CALL, duration_seconds: 66 });
    const { deps, transcribe } = makeDeps(db, {
      prepareAudio: vi
        .fn()
        .mockResolvedValue({
          wav: Buffer.from('w'),
          durationSeconds: 85.2,
          sampleRate: 8000,
          sourceChannels: 1,
        }),
    });
    expect(await processEngineCall('call-1', deps)).toBe('completed');
    expect(transcribe).toHaveBeenCalled();
    expect(tables.call_transcripts_v2?.[0]).toMatchObject({
      status: 'completed',
      error: 'duration_warning: call=66s audio=85.2s',
    });
    expect(tables.call_qualifications?.[0]).toMatchObject({
      status: 'completed',
      needs_review: true,
      needs_review_reasons: ['duration_warning'],
    });
  });

  it('áudio maior aceitável é fallback: match justo da busca durável tem preferência', async () => {
    const { db, tables } = fakeDb({ ...CALL, duration_seconds: 66 });
    const prepare = vi
      .fn()
      .mockResolvedValueOnce({
        wav: Buffer.from('w'),
        durationSeconds: 85.2,
        sampleRate: 8000,
        sourceChannels: 1,
      })
      .mockResolvedValueOnce({
        wav: Buffer.from('w'),
        durationSeconds: 67,
        sampleRate: 8000,
        sourceChannels: 1,
      });
    const lookup = vi.fn().mockResolvedValue('https://rec.example.com/durable.mp3');
    const { deps } = makeDeps(db, { prepareAudio: prepare, lookupRecording: lookup });
    expect(await processEngineCall('call-1', deps)).toBe('completed');
    expect(lookup).toHaveBeenCalled();
    expect(tables.call_transcripts_v2?.[0]?.error).toBeNull();
  });

  it('caminho feliz: grava as duas linhas e não escreve em calls', async () => {
    const { db, tables, writes } = fakeDb(CALL);
    const { deps } = makeDeps(db);
    expect(await processEngineCall('call-1', deps)).toBe('completed');
    expect(tables.call_transcripts_v2?.[0]).toMatchObject({
      status: 'completed',
      provider: 'assemblyai',
      speakers_count: 2,
    });
    expect(tables.call_qualifications?.[0]).toMatchObject({
      status: 'completed',
      provider: 'jev',
      outcome: 'callback',
      interest: 'medium',
      needs_review: false,
      needs_review_reasons: [],
    });
    expect(writes.every((w) => w.table !== 'calls')).toBe(true);
  });

  it('usa recording_url e nunca o Storage; mismatch tenta busca durável', async () => {
    const { db } = fakeDb(CALL);
    const download = vi.fn().mockResolvedValue(Buffer.from('x'));
    const lookup = vi.fn().mockResolvedValue('https://rec.example.com/durable.mp3');
    const prepare = vi
      .fn()
      .mockResolvedValueOnce({
        wav: Buffer.from('w'),
        durationSeconds: 20,
        sampleRate: 8000,
        sourceChannels: 1,
      })
      .mockResolvedValueOnce({
        wav: Buffer.from('w'),
        durationSeconds: 59,
        sampleRate: 8000,
        sourceChannels: 1,
      });
    const { deps } = makeDeps(db, {
      downloadAudio: download,
      lookupRecording: lookup,
      prepareAudio: prepare,
    });
    expect(await processEngineCall('call-1', deps)).toBe('completed');
    expect(download.mock.calls.map((c) => c[0])).toEqual([
      'https://rec.example.com/a.mp3',
      'https://rec.example.com/durable.mp3',
    ]);
  });

  it('segunda execução é idempotente', async () => {
    const { db, tables } = fakeDb(CALL);
    const { deps, transcribe, qualify } = makeDeps(db);
    await processEngineCall('call-1', deps);
    expect(await processEngineCall('call-1', deps)).toBe('completed');
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(qualify).toHaveBeenCalledTimes(1);
    expect(tables.call_transcripts_v2).toHaveLength(1);
    expect(tables.call_qualifications).toHaveLength(1);
  });

  it('retry de linha failed reaproveita a mesma linha', async () => {
    const { db, tables } = fakeDb(CALL, {
      call_transcripts_v2: [
        {
          id: 't1',
          call_id: 'call-1',
          provider: 'assemblyai',
          status: 'failed',
          attempts: 1,
          updated_at: '2026-11-11T10:00:00Z',
        },
      ],
    });
    const { deps } = makeDeps(db);
    expect(await processEngineCall('call-1', deps)).toBe('completed');
    expect(tables.call_transcripts_v2).toHaveLength(1);
    expect(tables.call_transcripts_v2?.[0]).toMatchObject({
      id: 't1',
      status: 'completed',
      attempts: 2,
    });
  });

  it('desiste após MAX_ATTEMPTS', async () => {
    const { db } = fakeDb(CALL, {
      call_transcripts_v2: [
        {
          id: 't1',
          call_id: 'call-1',
          provider: 'assemblyai',
          status: 'failed',
          attempts: 3,
          updated_at: 'x',
        },
      ],
    });
    const { deps, transcribe } = makeDeps(db);
    expect(await processEngineCall('call-1', deps)).toBe('gave_up');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('falha do AssemblyAI vira failed com erro', async () => {
    const { db, tables } = fakeDb(CALL);
    const { deps, qualify } = makeDeps(db);
    deps.assemblyAi = () => ({
      transcribe: vi.fn().mockRejectedValue(new Error('assemblyai_http_500')),
    });
    expect(await processEngineCall('call-1', deps)).toBe('transcript_failed');
    expect(tables.call_transcripts_v2?.[0]).toMatchObject({
      status: 'failed',
      error: 'assemblyai_http_500',
    });
    expect(qualify).not.toHaveBeenCalled();
  });
});

describe('mapJevResponse', () => {
  const input = {
    transcript: 'x',
    utterances: [{ speaker: 'A', text: 'Quero saber o preço', start: 0, end: 1 }],
    durationSeconds: 60,
    callType: 'outbound' as const,
  };

  it('mapeia respostas e monta resumo em código', () => {
    const q = mapJevResponse(
      jevOk({
        has_objections: { type: 'noul', noul: 0.95 },
        objection_type: { type: 'choice', choice: 'price', confidence: 0.9 },
      }),
      input,
    );
    expect(q.objections).toEqual({ has_objections: true, probability: 0.95, main_type: 'price' });
    expect(q.summary).toContain('Objeção principal: preço');
    expect(q.summary).toContain('Quero saber o preço');
    expect(q.inputTokens).toBe(1000);
    expect(q.costUsd).toBeCloseTo(0.000042, 8);
    expect(q.model).toBe('jev-1.14.0');
  });

  it('baixa confiança marca needs_review', () => {
    const q = mapJevResponse(
      jevOk({ outcome: { type: 'choice', choice: 'other', confidence: 0.3 } }),
      input,
    );
    expect(q.needsReview).toBe(true);
    expect(q.confidence).toBe(0.3);
    expect(q.needsReviewReasons).toContain('outcome_low_confidence');
  });

  const high = (over: Partial<Record<string, unknown>> = {}) =>
    jevOk({
      outcome: { type: 'choice', choice: 'meeting_booked', confidence: 0.96 },
      next_step_suggestion: { type: 'choice', choice: 'meeting', confidence: 0.96 },
      ...over,
    });

  it('caso Ismael: outcome e next altos, noul indeciso, não marca revisão', () => {
    const q = mapJevResponse(high({ has_objections: { type: 'noul', noul: 0.38 } }), input);
    expect(q.needsReview).toBe(false);
    expect(q.needsReviewReasons).toEqual([]);
  });

  it('outcome e next altos com objection_type de baixa confiança: sem revisão e sem puxar confiança', () => {
    const q = mapJevResponse(
      high({
        has_objections: { type: 'noul', noul: 0.95 },
        objection_type: { type: 'choice', choice: 'price', confidence: 0.3 },
        interest: { type: 'score', score: 2, confidence: 0.9 },
      }),
      input,
    );
    expect(q.needsReview).toBe(false);
    expect(q.confidence).toBe(0.9);
  });

  it('next_step com baixa confiança e outcome alto marca revisão', () => {
    const q = mapJevResponse(
      high({ next_step_suggestion: { type: 'choice', choice: 'meeting', confidence: 0.5 } }),
      input,
    );
    expect(q.needsReview).toBe(true);
  });

  it('sem confiança de outcome marca revisão', () => {
    expect(
      mapJevResponse(high({ outcome: { type: 'choice', choice: 'callback' } }), input).needsReview,
    ).toBe(true);
  });

  it('sem outcome/next altos, noul indeciso ainda marca revisão', () => {
    const q = mapJevResponse(
      jevOk({
        outcome: { type: 'choice', choice: 'callback', confidence: 0.7 },
        has_objections: { type: 'noul', noul: 0.45 },
      }),
      input,
    );
    expect(q.needsReview).toBe(true);
  });

  it('perguntas de ICP são opcionais e entram no resumo quando informadas', () => {
    expect(() => mapJevResponse(jevOk(), input)).not.toThrow();
    expect(Object.keys(buildJevQuestions())).toEqual(
      expect.arrayContaining([
        'monthly_revenue',
        'headcount',
        'digital_maturity',
        'decision_maker',
        'bant_budget',
        'bant_authority',
        'bant_need',
        'bant_timeline',
      ]),
    );
    const q = mapJevResponse(
      jevOk({
        monthly_revenue: { type: 'choice', choice: 'above_150k' },
        headcount: { type: 'choice', choice: 'over_5' },
        decision_maker: { type: 'choice', choice: 'yes' },
        digital_maturity: { type: 'choice', choice: 'unknown' },
        bant_budget: { type: 'choice', choice: 'not_mentioned' },
      }),
      input,
    );
    expect(q.summary).toContain('faturamento acima de R$ 150 mil/mês');
    expect(q.summary).toContain('porte mais de 5 funcionários');
    expect(q.summary).toContain('decisor na ligação: sim');
    expect(q.summary).not.toContain('maturidade');
    expect(q.summary).not.toContain('BANT');
  });

  it('resumo antigo quando todo o ICP é não mencionado', () => {
    const base = {
      outcome: 'callback',
      interest: 'low',
      objections: { has_objections: false, probability: 0, main_type: 'none' },
      nextStepSuggestion: 'callback',
    };
    const withIcp = buildSummary(base, 'x', {
      monthlyRevenue: 'not_mentioned',
      headcount: 'not_mentioned',
      decisionMaker: undefined,
    });
    expect(withIcp).toBe(buildSummary(base, 'x'));
    expect(withIcp).not.toContain('ICP');
  });

  it('resposta incompleta lança', () => {
    expect(() => mapJevResponse({ answers: {} }, input)).toThrow('jev_incomplete_answers');
  });
});

describe('hangup trigger', () => {
  const base = { callId: 'c', orgId: 'o', appUrl: 'https://app', serviceRoleKey: 'k' };
  it('helper puro', () => {
    expect(
      shouldTriggerEngineOnHangup({ answered: true, durationSeconds: 30, flagEnabled: true }),
    ).toBe(true);
    expect(
      shouldTriggerEngineOnHangup({ answered: true, durationSeconds: 29, flagEnabled: true }),
    ).toBe(false);
    expect(
      shouldTriggerEngineOnHangup({ answered: false, durationSeconds: 60, flagEnabled: true }),
    ).toBe(false);
    expect(
      shouldTriggerEngineOnHangup({ answered: true, durationSeconds: 60, flagEnabled: false }),
    ).toBe(false);
  });
  it('só faz fetch com a flag ligada', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    expect(
      await triggerTranscriptionEngine({
        ...base,
        answered: true,
        durationSeconds: 60,
        isEnabled: async () => false,
        fetchImpl: f,
      }),
    ).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(
      await triggerTranscriptionEngine({
        ...base,
        answered: true,
        durationSeconds: 60,
        isEnabled: async () => true,
        fetchImpl: f,
      }),
    ).toBe(true);
    expect(f).toHaveBeenCalledWith(
      'https://app/api/workers/transcribe-qualify-call',
      expect.anything(),
    );
  });
  it('não lê a flag para ligação curta', async () => {
    const isEnabled = vi.fn();
    await triggerTranscriptionEngine({ ...base, answered: true, durationSeconds: 10, isEnabled });
    expect(isEnabled).not.toHaveBeenCalled();
  });
});

describe('monitoramento', () => {
  it('agrega por dia', () => {
    const t = (over: Row) => ({
      org_id: 'o',
      created_at: '2026-11-11T15:00:00Z',
      status: 'completed',
      error: null,
      audio_seconds: 60,
      latency_ms: 1000,
      cost_usd: 0.01,
      text_length: 10,
      ...over,
    });
    const [d] = aggregateDaily(
      [
        t({}),
        t({ latency_ms: 3000 }),
        t({ status: 'failed', latency_ms: null, error: 'x' }),
        t({
          status: 'skipped',
          error: 'duration_mismatch: call=60s audio=20.0s',
          latency_ms: null,
        }),
        t({ text_length: 0 }),
      ] as never,
      [{ org_id: 'o', created_at: '2026-11-11T15:00:00Z', cost_usd: 0.001, needs_review: true }],
    );
    expect(d).toMatchObject({
      day: '2026-11-11',
      attempted: 5,
      completed: 3,
      failed: 1,
      skipped: 1,
      failureRate: 0.2,
      emptyTranscripts: 1,
      durationMismatches: 1,
      latencyP50: 1000,
      latencyP95: 2800,
      needsReview: 1,
    });
    expect(d?.transcriptCostUsd).toBeCloseTo(0.05);
  });
});

describe('áudio', () => {
  it('downmix mono de WAV estéreo e duração', async () => {
    const left = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    const right = new Float32Array([-0.5, -0.5, 0.5, 0.5]);
    const mono = downmixToMonoPcm16([left, right]);
    expect(Array.from(mono).slice(0, 2)).toEqual([0, 0]);
    expect(mono[2]).toBeGreaterThan(16000);

    const stereo = Buffer.alloc(44 + 8000 * 2 * 2);
    stereo.write('RIFF', 0, 'ascii');
    stereo.writeUInt32LE(stereo.length - 8, 4);
    stereo.write('WAVEfmt ', 8, 'ascii');
    stereo.writeUInt32LE(16, 16);
    stereo.writeUInt16LE(1, 20);
    stereo.writeUInt16LE(2, 22);
    stereo.writeUInt32LE(8000, 24);
    stereo.writeUInt16LE(16, 34);
    stereo.write('data', 36, 'ascii');
    stereo.writeUInt32LE(8000 * 2 * 2, 40);
    const out = await prepareMonoAudio(stereo);
    expect(out.sourceChannels).toBe(2);
    expect(out.durationSeconds).toBeCloseTo(1);
    expect(out.wav.length).toBe(encodeWavMono16(new Int16Array(8000), 8000).length);
  });

  it('tolerância de duração', () => {
    expect(durationMatches(60, 55)).toBe(true);
    expect(durationMatches(60, 30)).toBe(false);
    expect(durationMatches(600, 520)).toBe(true);
  });

  it('áudio maior dentro do teto é aceito com aviso; menor ou absurdo é recusado', () => {
    expect(assessAudioDuration(66, 85.2)).toEqual({ accepted: true, warning: true });
    expect(assessAudioDuration(60, 55)).toEqual({ accepted: true, warning: false });
    expect(assessAudioDuration(600, 520)).toEqual({ accepted: true, warning: false });
    expect(assessAudioDuration(60, 30).accepted).toBe(false);
    expect(assessAudioDuration(60, 20).accepted).toBe(false);
    expect(assessAudioDuration(60, 300).accepted).toBe(false);
  });
});

describe('assemblyai keyterms', () => {
  it('envia keyterms_prompt no POST /transcript', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const json = (v: unknown) => ({ ok: true, json: async () => v }) as Response;
      if (u.endsWith('/upload')) return json({ upload_url: 'https://up/x' });
      if (u.endsWith('/transcript')) {
        bodies.push(JSON.parse(String(init?.body)));
        return json({
          id: 't1',
          status: 'completed',
          text: 'oi',
          audio_duration: 60,
          utterances: [],
        });
      }
      throw new Error(`url inesperada ${u}`);
    }) as unknown as typeof fetch;
    const client = createAssemblyAiClient({ apiKey: 'k', fetchImpl });
    await client.transcribe(Buffer.from('x'));
    expect(bodies[0]?.keyterms_prompt).toEqual(ASSEMBLYAI_KEYTERMS_PROMPT);
    expect(bodies[0]).not.toHaveProperty('prompt');
  });
});

describe('migration', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261111150000_call_transcription_engine.sql'),
    'utf8',
  );
  it('flag nasce desligada e sem org', () => {
    expect(sql).toMatch(/'call_transcription_engine_v1',\s*false,/);
    expect(sql).toMatch(/,\s*'\{\}',\s*'\{\}'\s*\)/);
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(sql).not.toContain('c2727473-1df8-4faa-9264-a9fc1759fe3b');
    expect(sql).not.toMatch(/enabled\s*=\s*true/i);
  });
  it('sem cron nem update em app_flags', () => {
    expect(sql).not.toMatch(/cron\.schedule/i);
    expect(sql).not.toMatch(/UPDATE\s+(public\.)?app_flags/i);
  });
  it('RLS forçada e DELETE bloqueado', () => {
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('append-only');
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/i);
  });
});
