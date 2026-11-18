import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apply = vi.hoisted(() => ({ applySdrCallResult: vi.fn() }));
const stats = vi.hoisted(() => ({ callsToday: 1 }));
vi.mock('@/features/calls/services/apply-sdr-call-result', () => apply);
vi.mock('./cockpit-auto-dial.service', () => ({
  AUTO_DIAL_METADATA_KEY: 'cockpit_auto_dial',
  loadLeadCallStats: vi.fn(async () => ({ callsToday: stats.callsToday, lastCallAt: null, conversationToday: false })),
}));

import { classifyMotorAnsweredCall, readMotorCarrierHangup, resolveMotorNoAnswer } from './cockpit-auto-dial-outcome.service';

const NOW = new Date('2026-11-17T15:00:00Z');
type CallRow = Record<string, unknown>;

function callRow(over: Partial<CallRow> = {}): CallRow {
  return {
    id: 'call-1',
    user_id: 'u1',
    lead_id: 'lead-1',
    answered_at: '2026-11-17T14:59:50Z',
    duration_seconds: 4,
    hangup_cause: 'NORMAL_CLEARING',
    notes: null,
    created_at: '2026-11-17T14:59:40Z',
    started_at: '2026-11-17T14:59:40Z',
    sdr_disposition: null,
    metadata: { cockpit_auto_dial: { attempt: 1 } },
    ...over,
  };
}

function client(row: CallRow | null): SupabaseClient {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

const amd = (prediction: string, confidence = 0.95) => ({ cockpit_auto_dial: { attempt: 1 }, live_amd: { prediction, confidence } });
const base = { orgId: 'org-1', userId: 'u1', callId: 'call-1', now: NOW };

beforeEach(() => {
  apply.applySdrCallResult.mockReset();
  stats.callsToday = 1;
});

describe('classifyMotorAnsweredCall', () => {
  it('máquina com confiança decide na hora, mesmo sem hangup', async () => {
    const row = callRow({ hangup_cause: null, duration_seconds: 0, metadata: amd('voicemail') });
    expect(await classifyMotorAnsweredCall({ ...base, supabase: client(row) })).toMatchObject({ status: 'verdict', verdict: 'nao_conversou', machine: true });
  });
  it('humano decide na hora', async () => {
    const row = callRow({ hangup_cause: null, duration_seconds: 0, metadata: amd('human') });
    expect(await classifyMotorAnsweredCall({ ...base, supabase: client(row) })).toMatchObject({ verdict: 'conversou' });
  });
  it('sem sinal claro e sem hangup: pendente', async () => {
    expect(await classifyMotorAnsweredCall({ ...base, supabase: client(callRow({ hangup_cause: null })) })).toEqual({ status: 'pending' });
  });
  it('curtíssima sem AMD, com hangup: não conversou (não é máquina)', async () => {
    expect(await classifyMotorAnsweredCall({ ...base, supabase: client(callRow()) })).toMatchObject({ verdict: 'nao_conversou', machine: false });
  });
  it('longa: conversou', async () => {
    expect(await classifyMotorAnsweredCall({ ...base, supabase: client(callRow({ duration_seconds: 75 })) })).toMatchObject({ verdict: 'conversou' });
  });
  it('ligação de outro usuário ou sem lead: recusada', async () => {
    expect(await classifyMotorAnsweredCall({ ...base, supabase: client(callRow({ user_id: 'u2' })) })).toEqual({ status: 'refused' });
    expect(await classifyMotorAnsweredCall({ ...base, supabase: client(callRow({ lead_id: null })) })).toEqual({ status: 'refused' });
  });
});

describe('resolveMotorNoAnswer com ligação atendida', () => {
  function writable(row: CallRow) {
    apply.applySdrCallResult.mockImplementation(async (_s: unknown, input: { sdrOutcome: string }) => {
      row.sdr_disposition = input.sdrOutcome;
      return { success: true };
    });
    return client(row);
  }

  it('conversou continua "answered" e não grava nada', async () => {
    const row = callRow({ duration_seconds: 80 });
    expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row) })).toEqual({ status: 'answered' });
    expect(apply.applySdrCallResult).not.toHaveBeenCalled();
  });

  it('fail-open: atendida sem duração nem AMD (conversou) segue "answered"', async () => {
    const row = callRow({ duration_seconds: null });
    expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row) })).toEqual({ status: 'answered' });
  });

  it('máquina na 1ª tentativa: not_last, sem gravar', async () => {
    const row = callRow({ metadata: amd('voicemail') });
    expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row) })).toEqual({ status: 'not_last', attemptNo: 1 });
    expect(apply.applySdrCallResult).not.toHaveBeenCalled();
  });

  it('máquina na 3ª tentativa: grava voicemail com a nota padrão, sem avançar cadência', async () => {
    stats.callsToday = 3;
    const row = callRow({ metadata: amd('voicemail') });
    expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row) })).toEqual({ status: 'recorded', attemptNo: 3 });
    expect(apply.applySdrCallResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sdrOutcome: 'voicemail', via: 'webphone', notes: expect.any(String) }));
  });

  it('number_not_exist na 3ª também vira voicemail', async () => {
    stats.callsToday = 3;
    const row = callRow({ metadata: amd('number_not_exist') });
    await resolveMotorNoAnswer({ ...base, supabase: writable(row) });
    expect(apply.applySdrCallResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sdrOutcome: 'voicemail' }));
  });

  it('curtíssima sem AMD na 3ª: no_answer', async () => {
    stats.callsToday = 3;
    const row = callRow();
    expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row) })).toEqual({ status: 'recorded', attemptNo: 3 });
    expect(apply.applySdrCallResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sdrOutcome: 'no_answer' }));
  });

  it('AMD "no_answer" (máquina) na 3ª grava no_answer, não voicemail', async () => {
    stats.callsToday = 3;
    const row = callRow({ metadata: amd('no_answer') });
    await resolveMotorNoAnswer({ ...base, supabase: writable(row) });
    expect(apply.applySdrCallResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sdrOutcome: 'no_answer' }));
  });

  it('máquina sem hangup ainda: pendente', async () => {
    const row = callRow({ hangup_cause: null, metadata: amd('voicemail') });
    expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row) })).toEqual({ status: 'pending' });
  });

  it('"Não foi conversa" do SDR (notConversation) trata a atendida longa como não atendida: 3ª grava no_answer', async () => {
    stats.callsToday = 3;
    const row = callRow({ duration_seconds: 90 });
    expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row), notConversation: true })).toEqual({ status: 'recorded', attemptNo: 3 });
    expect(apply.applySdrCallResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sdrOutcome: 'no_answer' }));
  });

  it('não atendida (sem answered_at) segue igual a hoje: no_answer na 3ª', async () => {
    stats.callsToday = 3;
    const row = callRow({ answered_at: null });
    expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row) })).toEqual({ status: 'recorded', attemptNo: 3 });
    expect(apply.applySdrCallResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sdrOutcome: 'no_answer' }));
  });

  it('nota do SDR existente não é coberta', async () => {
    stats.callsToday = 3;
    const row = callRow({ notes: 'ficou de ligar', metadata: amd('voicemail') });
    await resolveMotorNoAnswer({ ...base, supabase: writable(row) });
    const arg = apply.applySdrCallResult.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('notes');
  });

  describe('nunca sobrescreve desfecho já gravado (Sentinela)', () => {
    it('atendida com sdr_disposition (relevant_conversation) + notConversation na 3ª: NÃO grava e devolve answered', async () => {
      stats.callsToday = 3;
      const row = callRow({ duration_seconds: 90, sdr_disposition: 'relevant_conversation' });
      expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row), notConversation: true })).toEqual({ status: 'answered' });
      expect(apply.applySdrCallResult).not.toHaveBeenCalled();
      expect(row.sdr_disposition).toBe('relevant_conversation');
    });

    it('atendida curtíssima/máquina já com desfecho: também não sobrescreve (veredito nao_conversou)', async () => {
      stats.callsToday = 3;
      const row = callRow({ sdr_disposition: 'callback_requested', metadata: amd('voicemail') });
      expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row) })).toEqual({ status: 'answered' });
      expect(apply.applySdrCallResult).not.toHaveBeenCalled();
    });

    it('controle: sdr_disposition nulo grava como hoje', async () => {
      stats.callsToday = 3;
      const row = callRow({ duration_seconds: 90, sdr_disposition: null });
      expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row), notConversation: true })).toEqual({ status: 'recorded', attemptNo: 3 });
      expect(apply.applySdrCallResult).toHaveBeenCalledTimes(1);
    });

    it('ligação com mais de 30 min: notConversation é ignorado (nada gravado)', async () => {
      stats.callsToday = 3;
      const row = callRow({ duration_seconds: 90, created_at: '2026-11-17T14:00:00Z', started_at: '2026-11-17T14:00:00Z' });
      expect(await resolveMotorNoAnswer({ ...base, supabase: writable(row), notConversation: true })).toEqual({ status: 'answered' });
      expect(apply.applySdrCallResult).not.toHaveBeenCalled();
    });
  });
});


describe('readMotorCarrierHangup: só a marca live_amd.auto_hangup decide', () => {
  const read = (row: CallRow | null, userId = 'u1') => readMotorCarrierHangup({ supabase: client(row), orgId: 'o1', userId, callId: 'call-1' });
  const hang = (over: Record<string, unknown> = {}) => ({ at: '2026-11-17T14:59:45Z', phrase: 'caixa postal', prediction: 'voicemail', confidence: 0.9, ...over });
  const withAmd = (live: Record<string, unknown>) => callRow({ metadata: { cockpit_auto_dial: { attempt: 1 }, live_amd: live } });

  it('marca presente com predição de operadora e confiança >= 0,84: auto_hangup', async () => {
    expect(await read(withAmd({ prediction: 'voicemail', auto_hangup: hang() }))).toEqual({ status: 'auto_hangup', prediction: 'voicemail' });
    expect(await read(withAmd({ auto_hangup: hang({ prediction: 'no_answer', confidence: 0.84 }) }))).toEqual({ status: 'auto_hangup', prediction: 'no_answer' });
    expect(await read(withAmd({ auto_hangup: hang({ prediction: 'number_not_exist' }) }))).toEqual({ status: 'auto_hangup', prediction: 'number_not_exist' });
  });

  it('no_answer SEM auto_hangup, mesmo com next_activity_confidence 0,9: NÃO decide', async () => {
    expect(await read(withAmd({ prediction: 'no_answer', confidence: 0.9, next_activity_suggestion: 'not_connected', next_activity_confidence: 0.9 }))).toEqual({ status: 'none' });
  });

  it('marca sem frase, com predição humana, confiança baixa ou inválida: NÃO decide', async () => {
    for (const bad of [hang({ phrase: null }), hang({ phrase: '  ' }), hang({ prediction: 'human' }), hang({ confidence: 0.8 }), hang({ confidence: 1.5 }), hang({ confidence: '0.9' })]) {
      expect(await read(withAmd({ prediction: 'voicemail', auto_hangup: bad }))).toEqual({ status: 'none' });
    }
  });

  it('ligação de outro usuário, inexistente ou sem lead: refused', async () => {
    expect(await read(withAmd({ auto_hangup: hang() }), 'outro')).toEqual({ status: 'refused' });
    expect(await read(null)).toEqual({ status: 'refused' });
    expect(await read({ ...withAmd({ auto_hangup: hang() }), lead_id: null })).toEqual({ status: 'refused' });
  });
});
