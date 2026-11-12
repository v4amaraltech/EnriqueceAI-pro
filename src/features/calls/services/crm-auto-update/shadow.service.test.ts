import { describe, expect, it } from 'vitest';

import { legacyAiOutcomeApplied, readCrmAutoUpdateMarker, runCrmAutoUpdate } from './shadow.service';

type Row = Record<string, unknown>;

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';

/**
 * Banco em memória com o mínimo do builder do Supabase usado pelo service.
 * O UPDATE é aplicado de verdade nas linhas que passam em TODOS os filtros (.eq e .is),
 * mescla o payload e devolve as linhas afetadas no .select(). Insert no log simula UNIQUE.
 */
function fakeDb(seed: Record<string, Row[]>, opts: { failUpdate?: string; failLogInsert?: boolean } = {}) {
  const tables: Record<string, Row[]> = { crm_auto_update_shadow_log: [], ...seed };
  const writes: Array<{ table: string; op: string; data: Row; affected?: number }> = [];
  const db = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let mode: 'select' | 'update' | 'insert' | 'delete' = 'select';
      let payload: Row = {};
      const rows = () => tables[table] ?? (tables[table] = []);
      const matches = (r: Row) => filters.every((f) => f(r));
      const result = (single = false) => {
        if (mode === 'insert') {
          if (table === 'crm_auto_update_shadow_log' && opts.failLogInsert) {
            return { data: null, error: { code: '57014', message: 'timeout' } };
          }
          if (table === 'crm_auto_update_shadow_log' && rows().some((r) => r.call_id === payload.call_id)) {
            return { data: null, error: { code: '23505', message: 'duplicate' } };
          }
          rows().push({ id: `log-${rows().length + 1}`, ...payload });
          writes.push({ table, op: 'insert', data: payload });
          return { data: null, error: null };
        }
        if (mode === 'update') {
          if (opts.failUpdate === table) return { data: null, error: { message: 'connection reset' } };
          const hit = rows().filter(matches);
          for (const r of hit) Object.assign(r, payload);
          writes.push({ table, op: 'update', data: payload, affected: hit.length });
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
        if (mode === 'delete') {
          writes.push({ table, op: 'delete', data: payload });
          return { data: null, error: null };
        }
        const hit = rows().filter(matches);
        return { data: single ? (hit[0] ?? null) : hit, error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (d: Row) => ((mode = 'insert'), (payload = d), b),
        update: (d: Row) => ((mode = 'update'), (payload = d), b),
        delete: () => ((mode = 'delete'), b),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
        is: (k: string, v: null) => (filters.push((r) => (r[k] ?? null) === v), b),
        limit: () => b,
        single: () => Promise.resolve(result(true)),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(res, rej),
      };
      return b;
    },
  };
  return { db: db as never, tables, writes };
}

function seed(over: { flags?: Row[]; call?: Partial<Row>; qualification?: Partial<Row> } = {}) {
  return {
    app_flags: over.flags ?? [
      { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
      { key: 'crm_auto_update_v1_live', enabled: false, allow_org_ids: [], allow_user_ids: [] },
    ],
    calls: [{ id: 'call-1', org_id: ORG, lead_id: 'lead-1', sdr_disposition: null, metadata: null, ...over.call }],
    call_qualifications: [
      {
        id: 'q-1',
        call_id: 'call-1',
        provider: 'jev',
        status: 'completed',
        outcome: 'meeting_booked',
        next_step_suggestion: 'meeting',
        interest: 'high',
        confidence: 0.92,
        needs_review: false,
        needs_review_reasons: [],
        transcript_id: 't-1',
        updated_at: '2026-11-11T12:00:00Z',
        ...over.qualification,
      },
    ],
    call_transcripts_v2: [{ id: 't-1', text: 'Fechado, terça às 10h então.' }],
    leads: [{ id: 'lead-1', status: 'contacted' }],
  };
}

describe('runCrmAutoUpdate (shadow)', () => {
  it('grava só no log: nenhuma escrita em calls, leads, atividades ou interações', async () => {
    const { db, writes, tables } = fakeDb(seed());
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    const row = tables.crm_auto_update_shadow_log?.[0];
    expect(row).toMatchObject({
      call_id: 'call-1',
      org_id: ORG,
      qualification_id: 'q-1',
      mode: 'shadow',
      verdict: 'would_apply',
      skip_reason: null,
      proposed_changes: {
        disposition: 'relevant_conversation',
        next_activity: { type: 'meeting', channel: null },
        lead_status: { from: 'contacted', to: 'qualified' },
      },
    });
  });

  it('idempotente: segunda execução não grava de novo', async () => {
    const { db, writes } = fakeDb(seed());
    await runCrmAutoUpdate(db, 'call-1');
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('already_logged');
    expect(writes).toHaveLength(1);
  });

  it('flags como a migration cria (desligadas): não grava nada', async () => {
    const { db, writes } = fakeDb(
      seed({
        flags: [
          { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [], allow_user_ids: [] },
          { key: 'crm_auto_update_v1_live', enabled: false, allow_org_ids: [], allow_user_ids: [] },
        ],
      }),
    );
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('off');
    expect(writes).toHaveLength(0);
  });

  it('qualificação ainda não concluída: espera, sem gravar', async () => {
    const { db, writes } = fakeDb(seed({ qualification: { status: 'processing' } }));
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('qualification_not_ready');
    expect(writes).toHaveLength(0);
  });

  it('needs_review e SDR já registrado viram skip com motivo', async () => {
    const review = fakeDb(seed({ qualification: { needs_review: true } }));
    await runCrmAutoUpdate(review.db, 'call-1');
    expect(review.tables.crm_auto_update_shadow_log?.[0]).toMatchObject({ verdict: 'skip', skip_reason: 'needs_review' });

    const sdr = fakeDb(seed({ call: { sdr_disposition: 'callback_requested' } }));
    await runCrmAutoUpdate(sdr.db, 'call-1');
    expect(sdr.tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      input_snapshot: expect.objectContaining({ sdr_disposition: 'callback_requested' }),
    });
    expect(sdr.writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
  });

  it('opt-out: skip opt_out_requested, proposta só documental e nenhuma escrita fora do log', async () => {
    const s = seed({ qualification: { outcome: 'not_interested', next_step_suggestion: 'none', confidence: 0.91 } });
    s.call_transcripts_v2 = [{ id: 't-1', text: 'Não tenho interesse. Tira meu e-mail, elimina meu telefone.' }];
    const { db, writes, tables } = fakeDb(s);
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    const row = tables.crm_auto_update_shadow_log?.[0];
    expect(row).toMatchObject({
      verdict: 'skip',
      skip_reason: 'opt_out_requested',
      rules_version: 'v1.1',
      proposed_changes: {
        disposition: 'answered_no_progress',
        opt_out: {
          requested: true,
          channels: ['email', 'phone'],
          applied: false,
          suggested_actions: expect.arrayContaining([
            expect.objectContaining({ target: 'email_suppressions', channel: 'email' }),
            expect.objectContaining({ target: 'contact_consent_evidence', channel: 'phone' }),
          ]),
        },
      },
      input_snapshot: expect.objectContaining({ opt_out_requested: true, opt_out_channels: ['email', 'phone'] }),
    });
    // O texto da ligação nunca é copiado para o log.
    expect(JSON.stringify(row)).not.toContain('elimina meu telefone');
  });

  it('sem opt-out: proposed_changes sem chave opt_out e snapshot com opt_out_requested false', async () => {
    const { db, tables } = fakeDb(seed());
    await runCrmAutoUpdate(db, 'call-1');
    const row = tables.crm_auto_update_shadow_log?.[0] as Record<string, Record<string, unknown>>;
    expect(row.proposed_changes).not.toHaveProperty('opt_out');
    expect(row.input_snapshot).toMatchObject({ opt_out_requested: false, opt_out_channels: [] });
  });

  it('modo live com reunião marcada (fora do escopo da escrita): só registra, applied = false', async () => {
    const { db, writes, tables } = fakeDb(
      seed({
        flags: [
          { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
          { key: 'crm_auto_update_v1_live', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
        ],
      }),
    );
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('logged');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      mode: 'live',
      verdict: 'would_apply',
      applied: false,
      applied_at: null,
    });
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    expect(tables.calls?.[0]).toMatchObject({ sdr_disposition: null, metadata: null });
  });
});

const LIVE_FLAGS: Row[] = [
  { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
  { key: 'crm_auto_update_v1_live', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
];

function voicemail(over: { confidence?: number; outcome?: string; call?: Partial<Row>; flags?: Row[] } = {}) {
  const s = seed({
    flags: over.flags ?? LIVE_FLAGS,
    call: { metadata: { callRef: 'abc' }, ...over.call },
    qualification: {
      outcome: over.outcome ?? 'voicemail',
      next_step_suggestion: 'retry',
      interest: 'unknown',
      confidence: over.confidence ?? 0.85,
    },
  });
  s.call_transcripts_v2 = [{ id: 't-1', text: 'Sua chamada está sendo encaminhada para a caixa de mensagens.' }];
  return s;
}

const CRM_TABLES = ['calls', 'leads', 'scheduled_activities', 'interactions', 'call_transcripts_v2', 'call_qualifications'];

describe('runCrmAutoUpdate (live, caixa postal)', () => {
  it('voicemail 0,85 com org no allowlist live: escreve só calls.sdr_disposition + marcador e loga applied', async () => {
    const { db, writes, tables } = fakeDb(voicemail({ confidence: 0.85 }));
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('applied');

    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual(['calls:update', 'crm_auto_update_shadow_log:insert']);
    expect(writes[0]?.affected).toBe(1);
    const call = tables.calls?.[0] as Row & { metadata: Record<string, unknown> };
    expect(call.sdr_disposition).toBe('voicemail');
    // Mescla com o metadata existente, sem apagar o resto nem usar ai_outcome.
    expect(call.metadata.callRef).toBe('abc');
    expect(call.metadata).not.toHaveProperty('ai_outcome');
    expect(call.metadata.crm_auto_update).toMatchObject({
      applied: true,
      disposition: 'voicemail',
      qualification_id: 'q-1',
      rules_version: 'v1.1',
      source: 'crm_auto_update_v1_live',
      applied_at: expect.any(String),
    });
    expect(tables.leads?.[0]).toEqual({ id: 'lead-1', status: 'contacted' });
    expect(tables.scheduled_activities ?? []).toHaveLength(0);
    expect(tables.interactions ?? []).toHaveLength(0);

    const log = tables.crm_auto_update_shadow_log?.[0] as Row;
    expect(log).toMatchObject({
      mode: 'live',
      verdict: 'would_apply',
      skip_reason: null,
      applied: true,
      proposed_changes: {
        disposition: 'voicemail',
        next_activity: { type: 'retry', channel: 'phone' },
        lead_status: null,
      },
    });
    expect(log.applied_at).toBe((call.metadata.crm_auto_update as Row).applied_at);
  });

  it('voicemail 0,84 em live: não escreve no CRM, log would_apply com applied = false', async () => {
    const { db, writes, tables } = fakeDb(voicemail({ confidence: 0.84 }));
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    expect(tables.calls?.[0]).toMatchObject({ sdr_disposition: null, metadata: { callRef: 'abc' } });
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      mode: 'live',
      verdict: 'would_apply',
      applied: false,
      applied_at: null,
    });
  });

  it.each([
    ['not_connected', 0.99],
    ['meeting_booked', 0.99],
    ['callback', 0.99],
    ['not_interested', 0.99],
  ])('%s %s em live: nada em calls, log como hoje com applied = false', async (outcome, confidence) => {
    const { db, writes, tables } = fakeDb(voicemail({ outcome, confidence }));
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    expect(tables.calls?.[0]).toMatchObject({ sdr_disposition: null });
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({ mode: 'live', applied: false, applied_at: null });
  });

  it('not_connected 0,99 em live propõe voicemail, mas não escreve', async () => {
    const { db, tables } = fakeDb(voicemail({ outcome: 'not_connected', confidence: 0.99 }));
    await runCrmAutoUpdate(db, 'call-1');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'would_apply',
      proposed_changes: { disposition: 'voicemail' },
      applied: false,
    });
    expect(tables.calls?.[0]?.sdr_disposition).toBeNull();
  });

  it('org fora do allowlist live, voicemail 0,95: shadow, não escreve', async () => {
    const { db, writes, tables } = fakeDb(
      voicemail({
        confidence: 0.95,
        flags: [
          { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
          { key: 'crm_auto_update_v1_live', enabled: false, allow_org_ids: ['outra-org'], allow_user_ids: [] },
        ],
      }),
    );
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({ mode: 'shadow', verdict: 'would_apply', applied: false });
  });

  it('flag live com enabled = true e allowlist vazio: continua shadow, não escreve', async () => {
    const { db, writes, tables } = fakeDb(
      voicemail({
        confidence: 0.95,
        flags: [
          { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
          { key: 'crm_auto_update_v1_live', enabled: true, allow_org_ids: [], allow_user_ids: [] },
        ],
      }),
    );
    await runCrmAutoUpdate(db, 'call-1');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({ mode: 'shadow', applied: false });
  });

  it('SDR já registrou (sem nosso marcador), voicemail 0,99 live: skip already_dispositioned, sem sobrescrever', async () => {
    const { db, writes, tables } = fakeDb(voicemail({ confidence: 0.99, call: { sdr_disposition: 'no_answer' } }));
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    expect(tables.calls?.[0]?.sdr_disposition).toBe('no_answer');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      applied: false,
    });
  });

  it('fluxo antigo do Power Dialer já aplicou: skip, sem escrever', async () => {
    const { db, writes } = fakeDb(
      voicemail({
        confidence: 0.99,
        call: { metadata: { ai_outcome: { status: 'done', disposition: 'voicemail' } } },
      }),
    );
    await runCrmAutoUpdate(db, 'call-1');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
  });

  it('idempotente: segunda execução depois do log retorna already_logged sem nenhuma escrita', async () => {
    const { db, writes } = fakeDb(voicemail({ confidence: 0.9 }));
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('applied');
    expect(writes).toHaveLength(2);
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('already_logged');
    expect(writes).toHaveLength(2);
  });

  it('recuperação: CRM já tem nosso marcador e falta o log, grava só o log com applied = true', async () => {
    const marker = {
      applied: true,
      disposition: 'voicemail',
      applied_at: '2026-11-12T15:00:00.000Z',
      qualification_id: 'q-1',
      rules_version: 'v1.1',
      source: 'crm_auto_update_v1_live',
    };
    const { db, writes, tables } = fakeDb(
      voicemail({ confidence: 0.9, call: { sdr_disposition: 'voicemail', metadata: { crm_auto_update: marker } } }),
    );
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('applied_recovered');
    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual(['crm_auto_update_shadow_log:insert']);
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      mode: 'live',
      verdict: 'would_apply',
      skip_reason: null,
      applied: true,
      applied_at: '2026-11-12T15:00:00.000Z',
      proposed_changes: { disposition: 'voicemail' },
      input_snapshot: expect.objectContaining({ recovered_from_marker: true, sdr_disposition: null }),
    });
  });

  it('UPDATE ok e log falha: a próxima execução recupera pelo marcador sem escrever de novo', async () => {
    const first = fakeDb(voicemail({ confidence: 0.9 }), { failLogInsert: true });
    expect(await runCrmAutoUpdate(first.db, 'call-1')).toBe('log_failed');
    expect(first.tables.calls?.[0]?.sdr_disposition).toBe('voicemail');
    expect(first.tables.crm_auto_update_shadow_log).toHaveLength(0);

    // Mesmo estado do banco, agora com o log funcionando.
    const second = fakeDb({ ...voicemail({ confidence: 0.9 }), calls: first.tables.calls as Row[] });
    expect(await runCrmAutoUpdate(second.db, 'call-1')).toBe('applied_recovered');
    expect(second.writes.map((w) => `${w.table}:${w.op}`)).toEqual(['crm_auto_update_shadow_log:insert']);
    const marker = (first.tables.calls?.[0]?.metadata as Record<string, Row>).crm_auto_update;
    expect(second.tables.crm_auto_update_shadow_log?.[0]).toMatchObject({ applied: true, applied_at: marker?.applied_at });
  });

  it('erro de banco no UPDATE: não grava o log (o retry tenta de novo)', async () => {
    const { db, tables } = fakeDb(voicemail({ confidence: 0.9 }), { failUpdate: 'calls' });
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('crm_write_failed');
    expect(tables.crm_auto_update_shadow_log).toHaveLength(0);
    expect(tables.calls?.[0]?.sdr_disposition).toBeNull();
  });

  it('corrida: SDR preenche no meio e o UPDATE condicional pega 0 linhas, skip sem sobrescrever', async () => {
    const s = voicemail({ confidence: 0.95 });
    const { db, writes, tables } = fakeDb(s);
    // Simula o SDR registrando entre a leitura da ligação e o UPDATE.
    const original = (db as { from: (t: string) => Record<string, unknown> }).from;
    let callsReads = 0;
    (db as { from: (t: string) => unknown }).from = (t: string) => {
      const b = original(t);
      if (t === 'calls') {
        const update = b.update as (d: Row) => unknown;
        b.update = (d: Row) => {
          (tables.calls?.[0] as Row).sdr_disposition = 'callback_requested';
          return update(d);
        };
        callsReads += 1;
      }
      return b;
    };
    expect(await runCrmAutoUpdate(db, 'call-1')).toBe('logged');
    expect(callsReads).toBeGreaterThan(1);
    expect(writes.find((w) => w.table === 'calls')?.affected).toBe(0);
    expect(tables.calls?.[0]).toMatchObject({ sdr_disposition: 'callback_requested', metadata: { callRef: 'abc' } });
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      applied: false,
      applied_at: null,
      input_snapshot: expect.objectContaining({ sdr_disposition: 'callback_requested', live_write_conflict: true }),
    });
  });

  it('nunca toca em tabelas do CRM além de calls', async () => {
    const { db, writes } = fakeDb(voicemail({ confidence: 0.99 }));
    await runCrmAutoUpdate(db, 'call-1');
    const touched = writes.filter((w) => CRM_TABLES.includes(w.table)).map((w) => w.table);
    expect(touched).toEqual(['calls']);
  });
});

describe('readCrmAutoUpdateMarker', () => {
  it('só reconhece o nosso marcador, nunca ai_outcome', () => {
    expect(readCrmAutoUpdateMarker(null)).toBeNull();
    expect(readCrmAutoUpdateMarker({ ai_outcome: { status: 'done', disposition: 'voicemail' } })).toBeNull();
    expect(readCrmAutoUpdateMarker({ crm_auto_update: { applied: false } })).toBeNull();
    expect(readCrmAutoUpdateMarker({ crm_auto_update: { applied: true, disposition: 'voicemail' } })).toMatchObject({
      applied: true,
    });
  });
});

describe('legacyAiOutcomeApplied', () => {
  it('só conta desfecho do fluxo antigo efetivamente aplicado', () => {
    expect(legacyAiOutcomeApplied(null)).toBe(false);
    expect(legacyAiOutcomeApplied({ ai_outcome: { status: 'done', disposition: 'voicemail' } })).toBe(true);
    expect(legacyAiOutcomeApplied({ ai_outcome: { status: 'done', disposition: 'voicemail', applied: false } })).toBe(
      false,
    );
    expect(legacyAiOutcomeApplied({ ai_outcome: { status: 'pending' } })).toBe(false);
  });
});
