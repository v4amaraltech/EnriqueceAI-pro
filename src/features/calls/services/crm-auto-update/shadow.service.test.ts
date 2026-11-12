import { describe, expect, it } from 'vitest';

import { legacyAiOutcomeApplied, runCrmAutoUpdate } from './shadow.service';

type Row = Record<string, unknown>;

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';

/** Banco em memória com o mínimo do builder do Supabase usado pelo service. */
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { crm_auto_update_shadow_log: [], ...seed };
  const writes: Array<{ table: string; op: string; data: Row }> = [];
  const db = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let mode: 'select' | 'update' | 'insert' | 'delete' = 'select';
      let payload: Row = {};
      const rows = () => tables[table] ?? (tables[table] = []);
      const matches = (r: Row) => filters.every(([k, v]) => r[k] === v);
      const result = (single = false) => {
        if (mode === 'insert') {
          if (table === 'crm_auto_update_shadow_log' && rows().some((r) => r.call_id === payload.call_id)) {
            return { data: null, error: { code: '23505', message: 'duplicate' } };
          }
          rows().push({ id: `log-${rows().length + 1}`, ...payload });
          writes.push({ table, op: 'insert', data: payload });
          return { data: null, error: null };
        }
        if (mode !== 'select') {
          writes.push({ table, op: mode, data: payload });
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
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        limit: () => b,
        single: () => Promise.resolve(result(true)),
        then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
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

  it('modo live também só registra nesta versão', async () => {
    const { db, writes, tables } = fakeDb(
      seed({
        flags: [
          { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
          { key: 'crm_auto_update_v1_live', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
        ],
      }),
    );
    await runCrmAutoUpdate(db, 'call-1');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({ mode: 'live' });
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
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
