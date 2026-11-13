import { afterEach, describe, expect, it, vi } from 'vitest';

import { runHangupCrmShadow, triggerHangupCrmShadow } from './hangup-shadow.service';

type Row = Record<string, unknown>;

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const CRM_TABLES = ['leads', 'scheduled_activities', 'interactions'];

/**
 * Banco em memória com o mínimo do builder usado pelo service.
 * O UPDATE é aplicado de verdade nas linhas que passam em TODOS os filtros (.eq e .is),
 * mescla o payload e devolve as linhas afetadas no .select(). Insert no log simula UNIQUE.
 */
function fakeDb(
  seed: Record<string, Row[]>,
  opts: { uniqueByMessage?: boolean; failLogInsert?: boolean; failUpdate?: string } = {},
) {
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
            return { data: null, error: { code: '23502', message: 'null value in column "qualification_id"' } };
          }
          if (table === 'crm_auto_update_shadow_log' && rows().some((r) => r.call_id === payload.call_id)) {
            return opts.uniqueByMessage
              ? { data: null, error: { message: 'duplicate key value violates unique constraint' } }
              : { data: null, error: { code: '23505', message: 'duplicate' } };
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
        // Cópia rasa: no banco real o SELECT não compartilha referência com o UPDATE.
        const hit = rows().filter(matches).map((r) => ({ ...r }));
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
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
      };
      return b;
    },
  };
  return { db: db as never, tables, writes };
}

const SHADOW_ONLY = [
  { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
  { key: 'crm_auto_update_v1_live', enabled: false, allow_org_ids: [], allow_user_ids: [] },
];
const LIVE = [
  { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
  { key: 'crm_auto_update_v1_live', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
];

function seed(over: { flags?: Row[]; call?: Partial<Row> } = {}) {
  return {
    app_flags: over.flags ?? SHADOW_ONLY,
    calls: [
      {
        id: 'call-1',
        org_id: ORG,
        lead_id: 'lead-1',
        sdr_disposition: null,
        hangup_cause: 'NUMBER_CHANGED',
        answered_at: null,
        duration_seconds: 0,
        connected: false,
        status: 'no_contact',
        metadata: null,
        ...over.call,
      },
    ],
    leads: [{ id: 'lead-1', status: 'new' }],
    scheduled_activities: [],
    interactions: [],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('runHangupCrmShadow (shadow)', () => {
  it('org off: não insere nada', async () => {
    const { db, writes } = fakeDb(seed({ flags: [] }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('off');
    expect(writes).toEqual([]);
  });

  it('causa sem sinal claro: unmapped, não insere', async () => {
    const { db, writes } = fakeDb(seed({ call: { hangup_cause: 'ORIGINATOR_CANCEL' } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('unmapped');
    expect(writes).toEqual([]);
  });

  it('ligação inexistente: call_not_found', async () => {
    const { db, writes } = fakeDb(seed());
    expect(await runHangupCrmShadow(db, 'nope')).toBe('call_not_found');
    expect(writes).toEqual([]);
  });

  it('would_apply: grava só no log, shadow, sem qualificação, hangup_v1', async () => {
    const { db, writes, tables } = fakeDb(seed());
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual(['insert:crm_auto_update_shadow_log']);
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      call_id: 'call-1',
      org_id: ORG,
      lead_id: 'lead-1',
      qualification_id: null,
      qualification_completed_at: null,
      mode: 'shadow',
      applied: false,
      applied_at: null,
      verdict: 'would_apply',
      skip_reason: null,
      rules_version: 'hangup_v1',
      proposed_changes: { disposition: 'no_answer', next_activity: { type: 'retry', channel: 'phone' }, lead_status: null },
      input_snapshot: {
        source: 'hangup_deterministic',
        hangup_cause: 'NUMBER_CHANGED',
        answered_at: null,
        duration_seconds: 0,
        connected: false,
        status: 'no_contact',
        sdr_disposition: null,
        outcome: 'no_answer',
        confidence: 1,
        legacy_ai_outcome_applied: false,
      },
    });
    expect(tables.calls?.[0]).toMatchObject({ sdr_disposition: null, metadata: null });
  });

  it('SDR já registrou: skip already_dispositioned com proposta, sem escrever no CRM', async () => {
    const { db, writes, tables } = fakeDb(seed({ call: { sdr_disposition: 'no_answer' } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      proposed_changes: { disposition: 'no_answer' },
      input_snapshot: { sdr_disposition: 'no_answer' },
    });
    expect(tables.calls?.[0]?.sdr_disposition).toBe('no_answer');
  });

  it('desfecho do fluxo antigo da IA: already_dispositioned', async () => {
    const metadata = { ai_outcome: { status: 'done', disposition: 'voicemail', applied: true } };
    const { db, tables } = fakeDb(seed({ call: { metadata } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      input_snapshot: { legacy_ai_outcome_applied: true },
    });
  });

  it('sem lead: skip no_lead com proposta', async () => {
    const { db, tables } = fakeDb(seed({ call: { lead_id: null, hangup_cause: 'UNALLOCATED_NUMBER' } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'no_lead',
      proposed_changes: { disposition: 'technical_failure', next_activity: { type: 'none', channel: null } },
    });
  });

  it('linha única já existe: already_logged, sem update', async () => {
    const { db, writes } = fakeDb(seed());
    await runHangupCrmShadow(db, 'call-1');
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('already_logged');
    expect(writes.filter((w) => w.op !== 'insert')).toEqual([]);
    expect(writes).toHaveLength(1);
  });

  it('unique reconhecida pela mensagem também vira already_logged', async () => {
    const { db } = fakeDb(seed(), { uniqueByMessage: true });
    await runHangupCrmShadow(db, 'call-1');
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('already_logged');
  });

  it('outro erro no INSERT (ex.: migration não aplicada): log_failed, sem lançar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, writes } = fakeDb(seed(), { failLogInsert: true });
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('log_failed');
    expect(writes).toEqual([]);
  });
});

describe('runHangupCrmShadow (live, não atendeu)', () => {
  const APPLYING = [
    ['NUMBER_CHANGED', 'no_answer'],
    ['NO_ANSWER', 'no_answer'],
    ['NO_USER_RESPONSE', 'no_answer'],
    ['ALLOTTED_TIMEOUT', 'no_answer'],
    ['USER_BUSY', 'busy'],
    ['CALL_REJECTED', 'rejected'],
  ] as const;

  it.each(APPLYING)(
    '%s em live: escreve só calls.sdr_disposition = no_answer + marcador e loga applied',
    async (cause, outcome) => {
      const { db, writes, tables } = fakeDb(seed({ flags: LIVE, call: { hangup_cause: cause } }));
      expect(await runHangupCrmShadow(db, 'call-1')).toBe('applied');
      expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual(['update:calls', 'insert:crm_auto_update_shadow_log']);
      const call = tables.calls?.[0] as Row & { metadata: { crm_auto_update: Row } };
      expect(call.sdr_disposition).toBe('no_answer');
      expect(call.metadata.crm_auto_update).toMatchObject({
        applied: true,
        disposition: 'no_answer',
        rules_version: 'hangup_v1',
        source: 'crm_auto_update_v1_live',
        applied_at: expect.any(String),
      });
      expect(call.metadata.crm_auto_update).not.toHaveProperty('qualification_id');
      const log = tables.crm_auto_update_shadow_log?.[0];
      expect(log).toMatchObject({
        mode: 'live',
        verdict: 'would_apply',
        skip_reason: null,
        applied: true,
        applied_at: expect.any(String),
        qualification_id: null,
        rules_version: 'hangup_v1',
        proposed_changes: { disposition: 'no_answer', lead_status: null },
        input_snapshot: { source: 'hangup_deterministic', hangup_cause: cause, outcome, sdr_disposition: null },
      });
      expect(log?.applied_at).toBe(call.metadata.crm_auto_update.applied_at);
      expect(writes.filter((w) => CRM_TABLES.includes(w.table))).toEqual([]);
    },
  );

  it('NUMBER_CHANGED com answered_at e duração 29s em live também escreve no_answer', async () => {
    const { db, tables } = fakeDb(
      seed({
        flags: LIVE,
        call: { hangup_cause: 'NUMBER_CHANGED', answered_at: '2026-11-12T13:00:05.000Z', duration_seconds: 29 },
      }),
    );
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('applied');
    expect(tables.calls?.[0]?.sdr_disposition).toBe('no_answer');
  });

  it.each([
    ['UNALLOCATED_NUMBER', 'invalid_number', 'technical_failure'],
    ['INVALID_NUMBER_FORMAT', 'invalid_number', 'technical_failure'],
    ['NORMAL_TEMPORARY_FAILURE', 'technical_failure', 'technical_failure'],
    ['RECOVERY_ON_TIMER_EXPIRE', 'technical_failure', 'technical_failure'],
  ] as const)('%s em live: só o log (mode live, applied false), nada em calls', async (cause, outcome, disposition) => {
    const { db, writes, tables } = fakeDb(seed({ flags: LIVE, call: { hangup_cause: cause } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual(['insert:crm_auto_update_shadow_log']);
    expect(tables.calls?.[0]).toMatchObject({ sdr_disposition: null, metadata: null });
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      mode: 'live',
      applied: false,
      applied_at: null,
      verdict: 'would_apply',
      proposed_changes: { disposition },
      input_snapshot: { outcome, hangup_cause: cause },
    });
  });

  it.each(['ORIGINATOR_CANCEL', 'NORMAL_CLEARING'] as const)(
    '%s em live: unmapped, nenhuma escrita',
    async (cause) => {
      const { db, writes, tables } = fakeDb(
        seed({
          flags: LIVE,
          call: {
            hangup_cause: cause,
            answered_at: cause === 'NORMAL_CLEARING' ? '2026-11-12T13:00:05.000Z' : null,
            duration_seconds: 12,
          },
        }),
      );
      expect(await runHangupCrmShadow(db, 'call-1')).toBe('unmapped');
      expect(writes).toEqual([]);
      expect(tables.calls?.[0]?.sdr_disposition).toBeNull();
    },
  );

  it('org fora do allowlist live: shadow, não escreve', async () => {
    const { db, writes, tables } = fakeDb(seed({ flags: SHADOW_ONLY }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({ mode: 'shadow', verdict: 'would_apply', applied: false });
    expect(tables.calls?.[0]?.sdr_disposition).toBeNull();
  });

  it('flag live com enabled = true e allowlist vazio: continua shadow, não escreve', async () => {
    const flags = [
      { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
      { key: 'crm_auto_update_v1_live', enabled: true, allow_org_ids: [], allow_user_ids: [] },
    ];
    const { db, tables } = fakeDb(seed({ flags }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({ mode: 'shadow', applied: false });
    expect(tables.calls?.[0]?.sdr_disposition).toBeNull();
  });

  it('SDR já registrou (sem nosso marcador), live: skip already_dispositioned, sem sobrescrever', async () => {
    const { db, writes, tables } = fakeDb(
      seed({ flags: LIVE, call: { sdr_disposition: 'technical_failure' } }),
    );
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    expect(tables.calls?.[0]?.sdr_disposition).toBe('technical_failure');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      mode: 'live',
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      applied: false,
      applied_at: null,
      input_snapshot: { sdr_disposition: 'technical_failure' },
    });
  });

  it('fluxo antigo do Power Dialer já aplicou: skip, sem escrever', async () => {
    const metadata = { ai_outcome: { status: 'done', disposition: 'no_answer', applied: true } };
    const { db, tables } = fakeDb(seed({ flags: LIVE, call: { metadata } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(tables.calls?.[0]?.sdr_disposition).toBeNull();
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      applied: false,
    });
  });

  it('sem lead em live: skip no_lead, sem escrever', async () => {
    const { db, tables } = fakeDb(seed({ flags: LIVE, call: { lead_id: null } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(tables.calls?.[0]?.sdr_disposition).toBeNull();
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'no_lead',
      applied: false,
    });
  });

  it('idempotente: segunda execução depois do log retorna already_logged sem nenhuma escrita', async () => {
    const { db, writes, tables } = fakeDb(seed({ flags: LIVE }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('applied');
    expect(writes).toHaveLength(2);
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('already_logged');
    expect(writes).toHaveLength(2);
    expect(tables.calls?.[0]?.sdr_disposition).toBe('no_answer');
  });

  it('recuperação: CRM já tem nosso marcador hangup_v1 e falta o log, grava só o log com applied = true', async () => {
    const marker = {
      applied: true,
      disposition: 'no_answer',
      applied_at: '2026-11-12T22:00:00.000Z',
      rules_version: 'hangup_v1',
      source: 'crm_auto_update_v1_live',
    };
    const { db, writes, tables } = fakeDb(
      seed({ flags: LIVE, call: { sdr_disposition: 'no_answer', metadata: { crm_auto_update: marker } } }),
    );
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('applied_recovered');
    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual(['crm_auto_update_shadow_log:insert']);
    expect(tables.calls?.[0]?.sdr_disposition).toBe('no_answer');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      mode: 'live',
      verdict: 'would_apply',
      skip_reason: null,
      applied: true,
      applied_at: '2026-11-12T22:00:00.000Z',
      proposed_changes: { disposition: 'no_answer' },
      input_snapshot: expect.objectContaining({ recovered_from_marker: true, sdr_disposition: null }),
    });
  });

  it('UPDATE ok e log falha: a próxima execução recupera pelo marcador sem escrever de novo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = fakeDb(seed({ flags: LIVE }), { failLogInsert: true });
    expect(await runHangupCrmShadow(first.db, 'call-1')).toBe('log_failed');
    expect(first.tables.calls?.[0]?.sdr_disposition).toBe('no_answer');
    expect(first.tables.crm_auto_update_shadow_log).toHaveLength(0);

    const second = fakeDb({ ...seed({ flags: LIVE }), calls: first.tables.calls as Row[] });
    expect(await runHangupCrmShadow(second.db, 'call-1')).toBe('applied_recovered');
    expect(second.writes.map((w) => `${w.table}:${w.op}`)).toEqual(['crm_auto_update_shadow_log:insert']);
    const marker = (first.tables.calls?.[0]?.metadata as Record<string, Row>).crm_auto_update;
    expect(second.tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      applied: true,
      applied_at: marker?.applied_at,
    });
    expect(second.tables.calls?.[0]?.sdr_disposition).toBe('no_answer');
  });

  it('erro de banco no UPDATE: não grava o log (o retry tenta de novo)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, tables } = fakeDb(seed({ flags: LIVE }), { failUpdate: 'calls' });
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('crm_write_failed');
    expect(tables.crm_auto_update_shadow_log).toHaveLength(0);
    expect(tables.calls?.[0]?.sdr_disposition).toBeNull();
  });

  it('corrida: SDR preenche no meio e o UPDATE condicional pega 0 linhas, skip sem sobrescrever', async () => {
    const s = seed({ flags: LIVE });
    const { db, writes, tables } = fakeDb(s);
    const original = (db as { from: (t: string) => Record<string, unknown> }).from;
    let callsReads = 0;
    (db as { from: (t: string) => unknown }).from = (t: string) => {
      const b = original(t);
      if (t === 'calls') {
        const update = b.update as (d: Row) => unknown;
        b.update = (d: Row) => {
          (tables.calls?.[0] as Row).sdr_disposition = 'technical_failure';
          return update(d);
        };
        callsReads += 1;
      }
      return b;
    };
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(callsReads).toBeGreaterThan(1);
    expect(writes.find((w) => w.table === 'calls')?.affected).toBe(0);
    expect(tables.calls?.[0]?.sdr_disposition).toBe('technical_failure');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      applied: false,
      applied_at: null,
      input_snapshot: expect.objectContaining({ sdr_disposition: 'technical_failure', live_write_conflict: true }),
    });
  });

  it('marcador de caixa postal JEV não é tratado como escrita hangup (não recupera, não sobrescreve)', async () => {
    const marker = {
      applied: true,
      disposition: 'voicemail',
      applied_at: '2026-11-12T15:00:00.000Z',
      qualification_id: 'q-1',
      rules_version: 'v1.1',
      source: 'crm_auto_update_v1_live',
    };
    const { db, writes, tables } = fakeDb(
      seed({ flags: LIVE, call: { sdr_disposition: 'voicemail', metadata: { crm_auto_update: marker } } }),
    );
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => w.table)).toEqual(['crm_auto_update_shadow_log']);
    expect(tables.calls?.[0]?.sdr_disposition).toBe('voicemail');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      applied: false,
    });
  });

  it('nunca toca em leads, scheduled_activities nem interactions', async () => {
    const { db, writes } = fakeDb(seed({ flags: LIVE }));
    await runHangupCrmShadow(db, 'call-1');
    expect(writes.filter((w) => CRM_TABLES.includes(w.table))).toEqual([]);
    expect(writes.filter((w) => w.table === 'calls' && w.op === 'update')).toHaveLength(1);
  });
});

describe('triggerHangupCrmShadow', () => {
  it('não lança quando o service rejeita', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      from: () => {
        throw new Error('db down');
      },
    } as never;
    expect(() => triggerHangupCrmShadow(db, 'call-1')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalled();
  });

  it('não lança quando a Promise rejeita depois', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = { from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.reject(new Error('timeout')) }) }) }) } as never;
    expect(() => triggerHangupCrmShadow(db, 'call-1')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalledWith(expect.stringContaining('timeout'));
  });
});
