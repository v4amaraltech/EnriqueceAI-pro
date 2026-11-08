import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

import { computeCallPriority } from './call-priority';
import {
  isCallPriorityV2Enabled,
  loadPrioritySignals,
  recordDecisionEvent,
  recordHumanCorrection,
  recordPrioritySuggestion,
  sanitizePayload,
} from './call-priority.service';
import { makeDb, makeFakeClient, type FakeDb, type Row } from './call-priority.testkit';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

const NOW = new Date('2026-11-07T12:00:00Z');
const ORG = 'org-1';
const OTHER = 'org-2';

function flag(on: boolean): Row {
  return { key: 'call_priority_v2', enabled: on };
}

function world(extra: Record<string, Row[]> = {}, flagOn = true): FakeDb {
  const db = makeDb({
    app_flags: [flag(flagOn)],
    leads: [
      { id: 'lead-1', org_id: ORG, assigned_to: 'u1', closer_id: null, deleted_at: null, updated_at: '2026-11-06T00:00:00Z', custom_field_values: {} },
      { id: 'lead-x', org_id: OTHER, assigned_to: 'u9', closer_id: null, deleted_at: null, updated_at: '2026-11-06T00:00:00Z', custom_field_values: {} },
    ],
    ...extra,
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(makeFakeClient(db) as never);
  return db;
}

const asClient = (db: FakeDb) => makeFakeClient(db) as never;

beforeEach(() => vi.clearAllMocks());

describe('flag call_priority_v2', () => {
  it('ligada somente quando enabled = true', async () => {
    world();
    expect(await isCallPriorityV2Enabled()).toBe(true);
  });

  it('desligada, ausente ou com erro de leitura vale desligada', async () => {
    world({}, false);
    expect(await isCallPriorityV2Enabled()).toBe(false);
    world({ app_flags: [] });
    expect(await isCallPriorityV2Enabled()).toBe(false);
    const db = world();
    db.failReads.add('app_flags');
    expect(await isCallPriorityV2Enabled()).toBe(false);
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new Error('sem credencial');
    });
    expect(await isCallPriorityV2Enabled()).toBe(false);
  });
});

describe('loadPrioritySignals: isolamento por organização', () => {
  it('toda leitura filtra org_id e sinais de outra organização nunca entram', async () => {
    const db = world({
      interactions: [
        { id: 'i1', org_id: ORG, lead_id: 'lead-1', channel: 'email', type: 'replied', created_at: '2026-11-06T00:00:00Z' },
        // mesmo lead_id apontado por linha de outra org (dado inconsistente): precisa ser ignorado
        { id: 'i2', org_id: OTHER, lead_id: 'lead-1', channel: 'email', type: 'replied', created_at: '2026-11-06T00:00:00Z' },
        { id: 'i3', org_id: OTHER, lead_id: 'lead-x', channel: 'email', type: 'replied', created_at: '2026-11-06T00:00:00Z' },
      ],
      calls: [{ id: 'c9', org_id: OTHER, lead_id: 'lead-1', started_at: '2026-11-06T00:00:00Z', created_at: '2026-11-06T00:00:00Z', sdr_disposition: 'relevant_conversation', metadata: {} }],
      custom_fields: [],
      decision_events: [
        { org_id: OTHER, lead_id: 'lead-1', event_type: 'human_correction', idempotency_key: 'correction:x:1', actor_user_id: 'u9', payload: { interest_set: 100 }, created_at: '2026-11-06T00:00:00Z' },
      ],
    });
    const signals = await loadPrioritySignals(asClient(db), ORG, ['lead-1'], NOW);
    expect(signals?.get('lead-1')?.map((s) => s.key)).toEqual(['interaction:i1']);
    for (const read of db.reads.filter((r) => r.table !== 'app_flags')) expect(read.eq.org_id, read.table).toBe(ORG);
    expect(db.reads.map((r) => r.table)).toEqual(expect.arrayContaining(['interactions', 'calls', 'leads', 'custom_fields', 'decision_events']));
  });

  it('falha em qualquer leitura devolve null (o chamador volta à ordem de antes)', async () => {
    const db = world({ interactions: [], calls: [], custom_fields: [], decision_events: [] });
    db.failReads.add('calls');
    expect(await loadPrioritySignals(asClient(db), ORG, ['lead-1'], NOW)).toBeNull();
  });

  it('sem leads não consulta nada', async () => {
    const db = world();
    expect((await loadPrioritySignals(asClient(db), ORG, [], NOW))?.size).toBe(0);
    expect(db.reads).toHaveLength(0);
  });
});

describe('loadPrioritySignals: reaproveita BANT, resultado e classificação existentes', () => {
  it('lê BANT dos custom fields, resultado do SDR e classificação da IA, cada um com sua fonte', async () => {
    const db = world({
      interactions: [],
      custom_fields: [
        { id: 'f-b', org_id: ORG, field_name: 'B (Budget)' },
        { id: 'f-n', org_id: ORG, field_name: 'N (Necessidade)' },
      ],
      decision_events: [],
      calls: [
        {
          id: 'c1',
          org_id: ORG,
          lead_id: 'lead-1',
          started_at: '2026-11-06T10:00:00Z',
          created_at: '2026-11-06T10:00:00Z',
          sdr_disposition: 'answered_no_progress',
          metadata: { ai_outcome: { status: 'done', disposition: 'relevant_conversation', confidence: 0.9, needs_review: false, classified_at: '2026-11-06T11:00:00Z' } },
        },
      ],
    });
    db.tables.leads![0]!.custom_field_values = { 'f-b': 'faturamento de 2 milhões', 'f-n': '   ', 'f-outro': 'x' };
    const signals = (await loadPrioritySignals(asClient(db), ORG, ['lead-1'], NOW))?.get('lead-1') ?? [];
    expect(signals).toContainEqual(expect.objectContaining({ kind: 'bant', filledFields: 1 }));
    expect(signals).toContainEqual(expect.objectContaining({ kind: 'call_outcome', by: 'sdr', disposition: 'answered_no_progress' }));
    expect(signals).toContainEqual(expect.objectContaining({ kind: 'call_outcome', by: 'ai', disposition: 'relevant_conversation', confidence: 0.9 }));
  });

  it('disposição gravada pela própria IA em sdr_disposition não vira "resultado do SDR"', async () => {
    const db = world({
      interactions: [],
      custom_fields: [],
      decision_events: [],
      calls: [
        {
          id: 'c1',
          org_id: ORG,
          lead_id: 'lead-1',
          started_at: '2026-11-06T10:00:00Z',
          created_at: '2026-11-06T10:00:00Z',
          sdr_disposition: 'relevant_conversation',
          metadata: { ai_outcome: { status: 'done', disposition: 'relevant_conversation', confidence: 0.3, needs_review: true } },
        },
      ],
    });
    const signals = (await loadPrioritySignals(asClient(db), ORG, ['lead-1'], NOW))?.get('lead-1') ?? [];
    expect(signals.filter((s) => s.kind === 'call_outcome' && s.by === 'sdr')).toHaveLength(0);
    // Transcrição de baixa confiança: nada de interesse.
    expect(computeCallPriority(signals, NOW).interest).toBe(0);
  });

  it('transcrição ausente: sem sinal de IA, sem erro', async () => {
    const db = world({ interactions: [], custom_fields: [], decision_events: [], calls: [] });
    const signals = (await loadPrioritySignals(asClient(db), ORG, ['lead-1'], NOW))?.get('lead-1') ?? [];
    expect(computeCallPriority(signals, NOW).missing).toContain('transcript');
  });
});

describe('trilha decision_events', () => {
  const base = { orgId: ORG, leadId: 'lead-1', eventType: 'signal_observed' as const, source: 'explicit_reply' as const, idempotencyKey: 'k1', payload: { score: 10 } };

  it('replay da mesma chave é duplicado e não grava segunda linha', async () => {
    const db = world();
    const c = asClient(db);
    expect(await recordDecisionEvent(c, base)).toBe('recorded');
    expect(await recordDecisionEvent(c, base)).toBe('duplicate');
    expect(db.tables.decision_events).toHaveLength(1);
  });

  it('a mesma chave em outra organização é outro evento', async () => {
    const db = world();
    const c = asClient(db);
    await recordDecisionEvent(c, base);
    expect(await recordDecisionEvent(c, { ...base, orgId: OTHER, leadId: 'lead-x' })).toBe('recorded');
    expect(db.tables.decision_events).toHaveLength(2);
  });

  it('toda linha leva versão do modelo, fonte e organização', async () => {
    const db = world();
    await recordDecisionEvent(asClient(db), base);
    expect(db.tables.decision_events![0]).toMatchObject({ org_id: ORG, model_version: 'call_priority_v2.0', source: 'explicit_reply' });
  });

  it('payload sem PII: só chaves permitidas e valores curtos', () => {
    const p = sanitizePayload({
      score: 12,
      telefone: '+5516999867577',
      email: 'a@b.com',
      transcricao: 'texto longo da ligação',
      reason_codes: ['explicit_reply', 'bant'],
      primary_source: 'x'.repeat(500),
    });
    expect(Object.keys(p).sort()).toEqual(['primary_source', 'reason_codes', 'score']);
    expect((p.primary_source as string).length).toBe(120);
  });

  it('nunca atualiza nem apaga (append-only): a sugestão repetida é duplicada', async () => {
    const db = world();
    const result = computeCallPriority([], NOW);
    const input = { orgId: ORG, leadId: 'lead-1', result, v1PickSame: true, dayKey: '2026-11-07' };
    expect(await recordPrioritySuggestion(asClient(db), input)).toBe('recorded');
    expect(await recordPrioritySuggestion(asClient(db), input)).toBe('duplicate');
    expect(db.tables.decision_events).toHaveLength(1);
    expect(db.tables.decision_events![0]).toMatchObject({ event_type: 'priority_suggestion', model_version: 'call_priority_v2.0' });
  });
});

describe('recordHumanCorrection', () => {
  const sdr = { orgId: ORG, userId: 'u1', isManager: false };

  it('flag desligada: não lê lead nem grava', async () => {
    const db = world({}, false);
    expect(await recordHumanCorrection({ actor: sdr, leadId: 'lead-1', interest: 50, requestId: 'r1' })).toEqual({ status: 'disabled' });
    expect(db.tables.decision_events ?? []).toHaveLength(0);
    expect(db.reads.some((r) => r.table === 'leads')).toBe(false);
  });

  it('registra com o autor humano e prevalece no cálculo', async () => {
    const db = world({ interactions: [], calls: [], custom_fields: [] });
    db.tables.interactions = [{ id: 'i1', org_id: ORG, lead_id: 'lead-1', channel: 'email', type: 'replied', created_at: '2026-11-06T00:00:00Z' }];
    const r = await recordHumanCorrection({ actor: sdr, leadId: 'lead-1', interest: 0, requestId: 'r1' });
    expect(r).toEqual({ status: 'recorded', interest: 0 });
    expect(db.tables.decision_events![0]).toMatchObject({ event_type: 'human_correction', source: 'human', actor_user_id: 'u1', org_id: ORG });
    const signals = (await loadPrioritySignals(asClient(db), ORG, ['lead-1'], NOW))?.get('lead-1') ?? [];
    const result = computeCallPriority(signals, NOW);
    expect(result.interest).toBe(0);
    expect(result.humanCorrected).toBe(true);
  });

  it('mesma requisição repetida não grava de novo', async () => {
    const db = world();
    await recordHumanCorrection({ actor: sdr, leadId: 'lead-1', interest: 40, requestId: 'r1' });
    const again = await recordHumanCorrection({ actor: sdr, leadId: 'lead-1', interest: 40, requestId: 'r1' });
    expect(again).toEqual({ status: 'duplicate', interest: 40 });
    expect(db.tables.decision_events).toHaveLength(1);
  });

  it('lead de outra organização responde not_found e não grava', async () => {
    const db = world();
    expect(await recordHumanCorrection({ actor: sdr, leadId: 'lead-x', interest: 40, requestId: 'r1' })).toEqual({ status: 'not_found' });
    expect(await recordHumanCorrection({ actor: { ...sdr, isManager: true }, leadId: 'lead-x', interest: 40, requestId: 'r2' })).toEqual({ status: 'not_found' });
    expect(db.tables.decision_events ?? []).toHaveLength(0);
  });

  it('SDR só corrige a própria carteira; gestor corrige qualquer lead da org', async () => {
    const db = world();
    expect((await recordHumanCorrection({ actor: { ...sdr, userId: 'u2' }, leadId: 'lead-1', interest: 40, requestId: 'r1' })).status).toBe('not_found');
    expect((await recordHumanCorrection({ actor: { orgId: ORG, userId: 'm1', isManager: true }, leadId: 'lead-1', interest: 40, requestId: 'r2' })).status).toBe('recorded');
    expect(db.tables.decision_events).toHaveLength(1);
  });

  it('valor inválido é recusado antes de qualquer leitura', async () => {
    const db = world();
    for (const interest of [-1, 101, Number.NaN]) {
      expect(await recordHumanCorrection({ actor: sdr, leadId: 'lead-1', interest, requestId: 'r1' })).toEqual({ status: 'invalid' });
    }
    expect(await recordHumanCorrection({ actor: sdr, leadId: 'lead-1', interest: 10, requestId: '  ' })).toEqual({ status: 'invalid' });
    expect(db.reads).toHaveLength(0);
  });
});
