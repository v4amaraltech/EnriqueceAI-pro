import { readFileSync } from 'fs';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

import {
  authorizeNumberRecovery,
  checkDispatchHealth,
  checkNumberCanSend,
  closedBusinessDays,
  evaluateNumberHealth,
  healthWindowKey,
  loadHealthFactsForGateway,
  MAX_RAMP_STAGE,
  rampCaps,
  recordNumberHealthSignals,
  recoveryIdempotencyToken,
  runNumberHealthEvaluation,
  windowSignals,
  type EvaluationInstance,
  type HealthWindow,
  type NumberHealthFacts,
} from './number-health.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

// ---------------------------------------------------------------------------
// Banco em memoria minimo (somente o que o servico usa)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
interface Fake {
  tables: Record<string, Row[]>;
  reads: string[];
  updates: Array<{ table: string; patch: Row; filters: Array<[string, string, unknown]> }>;
  rpcs: Array<{ fn: string; args: Row }>;
  rpcError: boolean;
}

function makeFake(tables: Fake['tables']): Fake {
  return { tables, reads: [], updates: [], rpcs: [], rpcError: false };
}

function install(f: Fake) {
  const from = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let patch: Row | null = null;
    let head = false;
    let max = Infinity;
    const b: Record<string, unknown> = {};
    b.select = (_c?: string, o?: { head?: boolean }) => ((head = o?.head === true), b);
    b.update = (p: Row) => ((patch = p), b);
    b.eq = (k: string, v: unknown) => (filters.push([k, 'eq', v]), b);
    b.is = (k: string, v: unknown) => (filters.push([k, 'is', v]), b);
    b.gte = (k: string, v: unknown) => (filters.push([k, 'gte', v]), b);
    b.like = (k: string, v: string) => (filters.push([k, 'like', v]), b);
    b.order = () => b;
    b.limit = (n: number) => ((max = n), b);
    const match = (r: Row) =>
      filters.every(([k, op, v]) => {
        const x = r[k];
        if (op === 'eq') return x === v;
        if (op === 'is') return (x ?? null) === v;
        if (op === 'gte') return x !== undefined && x !== null && String(x) >= String(v);
        return typeof x === 'string' && x.startsWith(String(v).replace('%', ''));
      });
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
      const rows = (f.tables[table] ?? []).filter(match);
      if (patch) {
        f.updates.push({ table, patch, filters: [...filters] });
        for (const r of rows) Object.assign(r, patch);
        return Promise.resolve({ data: rows.map((r) => ({ id: r.id })), error: null }).then(ok, ko);
      }
      f.reads.push(table);
      if (head) return Promise.resolve({ count: rows.length, data: null, error: null }).then(ok, ko);
      return Promise.resolve({ data: rows.slice(0, max), error: null }).then(ok, ko);
    };
    return b;
  };
  const rpc = async (fn: string, args: Row) => {
    f.rpcs.push({ fn, args });
    if (f.rpcError) return { data: null, error: { message: 'boom' } };
    if (fn !== 'authorize_number_recovery_with_audit') return { data: null, error: null };
    const row = (f.tables.whatsapp_instances ?? []).find(
      (r) => r.id === args.p_instance_id && r.org_id === args.p_org_id,
    );
    if (!row) return { data: { success: false, error: 'not_found' }, error: null };
    if (row.health_state !== 'paused' && row.health_state !== 'review') {
      return { data: { success: false, error: 'not_blocked' }, error: null };
    }
    if (row.status !== 'connected') return { data: { success: false, error: 'not_connected' }, error: null };
    if (args.p_expected_blocked_at && row.health_state_changed_at && args.p_expected_blocked_at !== row.health_state_changed_at) {
      return { data: { success: false, error: 'stale_episode' }, error: null };
    }
    const recoveredAt = new Date(String(args.p_recovered_at));
    const windowDate = healthWindowKey(recoveredAt);
    const win = (f.tables.whatsapp_number_health_windows ?? []).find(
      (w) => w.instance_id === args.p_instance_id && w.window_date === windowDate,
    );
    const pauseReason = row.health_pause_reason;
    Object.assign(row, {
      health_state: 'warming',
      health_pause_reason: null,
      health_state_changed_at: args.p_recovered_at,
      health_recovered_at: args.p_recovered_at,
      health_ack_window_date: windowDate,
      health_ack_trusted_reports: win?.trusted_reports ?? 0,
      health_ack_restrictions: win?.restriction_events ?? 0,
      auto_send_consecutive_failures: 0,
    });
    if (typeof row.auto_send_pause_reason === 'string' && row.auto_send_pause_reason.startsWith('health:')) {
      row.auto_send_paused_at = null;
      row.auto_send_pause_reason = null;
      row.auto_send_next_at = null;
    }
    const audits = (f.tables.whatsapp_number_health_recoveries ??= []);
    audits.push({
      instance_id: args.p_instance_id,
      pause_reason: pauseReason,
      note: args.p_note,
      idempotency_token: args.p_idempotency_token,
      blocked_at: args.p_expected_blocked_at,
      new_state: 'warming',
      ramp_stage: row.health_ramp_stage,
      total_cap: row.health_total_daily_cap,
      new_contacts_cap: row.health_new_contacts_daily_cap,
    });
    return { data: { success: true, state: 'warming', audit_id: 'audit-1', replay: false }, error: null };
  };
  vi.mocked(createServiceRoleClient).mockReturnValue({ from, rpc } as never);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Quinta-feira. Dias uteis fechados anteriores: 11 (qua), 10 (ter), 09 (seg).
const NOW = new Date('2026-11-12T15:00:00.000Z');

const healthy = (date: string, over: Partial<HealthWindow> = {}): HealthWindow => ({
  date,
  sentNewContacts: 8,
  sentToRespondents: 4,
  replies: 3,
  failures: 0,
  trustedReports: 0,
  restrictionEvents: 0,
  ...over,
});
const threeHealthy = (): HealthWindow[] => ['2026-11-11', '2026-11-10', '2026-11-09'].map((d) => healthy(d));

const inst = (over: Partial<EvaluationInstance> = {}): EvaluationInstance => ({
  status: 'connected',
  state: 'onboarding',
  rampStage: 0,
  rampChangedOn: null,
  consecutiveFailures: 0,
  ackWindowDate: null,
  ackTrustedReports: 0,
  ackRestrictions: 0,
  ...over,
});

const evaluate = (i: Partial<EvaluationInstance>, windows: HealthWindow[]) =>
  evaluateNumberHealth({ now: NOW, instance: inst(i), windows });

const facts = (over: Partial<NumberHealthFacts> = {}): NumberHealthFacts => ({
  instanceId: 'inst-A',
  connected: true,
  state: 'warming',
  newContactsCap: 10,
  totalCap: 20,
  sentNewToday: 0,
  sentTotalToday: 0,
  windowDate: '2026-11-12',
  ...over,
});

// ---------------------------------------------------------------------------
// Janela e rampa de tetos
// ---------------------------------------------------------------------------

describe('janela America/Sao_Paulo', () => {
  it('a virada do dia e a meia-noite de Sao Paulo, nao a de UTC', () => {
    expect(healthWindowKey(new Date('2026-11-08T02:59:59Z'))).toBe('2026-11-07');
    expect(healthWindowKey(new Date('2026-11-08T03:00:00Z'))).toBe('2026-11-08');
    expect(healthWindowKey(new Date('2026-11-08T01:30:00Z'))).toBe('2026-11-07');
  });

  it('dias fechados pulam fim de semana e respeitam o piso', () => {
    // 2026-11-09 e segunda.
    expect(closedBusinessDays('2026-11-09', 3, null)).toEqual(['2026-11-06', '2026-11-05', '2026-11-04']);
    expect(closedBusinessDays('2026-11-12', 3, '2026-11-10')).toEqual(['2026-11-11']);
  });
});

describe('tetos por estagio', () => {
  it('estagio 0 coincide com os defaults restritivos e nunca passa do maximo do pacing', () => {
    expect(rampCaps(0)).toEqual({ newContacts: 10, total: 20 });
    expect(rampCaps(1)).toEqual({ newContacts: 20, total: 40 });
    expect(rampCaps(MAX_RAMP_STAGE).newContacts).toBe(80);
    expect(rampCaps(999).newContacts).toBe(80);
    expect(rampCaps(-3)).toEqual({ newContacts: 10, total: 20 });
  });
});

// ---------------------------------------------------------------------------
// Rampa
// ---------------------------------------------------------------------------

describe('rampa so avanca com janela saudavel e amostra minima', () => {
  it('tres janelas fechadas saudaveis avancam um degrau', () => {
    const r = evaluate({}, threeHealthy());
    expect(r.rampAdvanced).toBe(true);
    expect(r.nextRampStage).toBe(1);
    expect(r.nextState).toBe('warming');
    expect(r.blockers).toEqual([]);
  });

  it('nunca avanca so por tempo: dias passam sem janelas e nada muda', () => {
    const r = evaluate({ rampChangedOn: '2026-10-01' }, []);
    expect(r.rampAdvanced).toBe(false);
    expect(r.nextRampStage).toBe(0);
    expect(r.blockers).toContain('telemetry_unknown');
  });

  it('amostra abaixo do minimo nao conta', () => {
    const ws = threeHealthy();
    ws[1] = healthy('2026-11-10', { sentNewContacts: 3, sentToRespondents: 2, replies: 2 });
    const r = evaluate({}, ws);
    expect(r.rampAdvanced).toBe(false);
    expect(r.blockers).toContain('insufficient_sample');
  });

  it('a janela de hoje (parcial) nao conta', () => {
    const r = evaluate({}, [healthy('2026-11-12'), healthy('2026-11-11'), healthy('2026-11-10')]);
    expect(r.rampAdvanced).toBe(false);
  });

  it('degrau recem-dado exige tres janelas novas', () => {
    const r = evaluate({ rampStage: 1, rampChangedOn: '2026-11-10' }, threeHealthy());
    expect(r.rampAdvanced).toBe(false);
    expect(r.blockers).toContain('not_enough_windows');
  });

  it('no estagio maximo nao passa do teto e o estado e healthy', () => {
    const r = evaluate({ state: 'healthy', rampStage: MAX_RAMP_STAGE }, threeHealthy());
    expect(r.rampAdvanced).toBe(false);
    expect(r.nextRampStage).toBe(MAX_RAMP_STAGE);
  });

  it('ultimo degrau leva a healthy', () => {
    const r = evaluate({ state: 'warming', rampStage: MAX_RAMP_STAGE - 1 }, threeHealthy());
    expect(r.nextState).toBe('healthy');
  });
});

describe('queda de resposta congela a rampa (so com amostra minima)', () => {
  it('taxa abaixo do minimo com amostra suficiente congela e bloqueia o avanco', () => {
    const ws = [healthy('2026-11-11', { replies: 0 }), healthy('2026-11-10'), healthy('2026-11-09')];
    const r = evaluate({}, ws);
    expect(r.rampFrozen).toBe(true);
    expect(r.freezeReason).toBe('reply_rate_below_minimum');
    expect(r.rampAdvanced).toBe(false);
    expect(r.blockers).toContain('frozen_reply_rate');
  });

  it('queda relativa contra a linha de base congela', () => {
    const big = (d: string, replies: number) => healthy(d, { sentNewContacts: 15, sentToRespondents: 5, replies });
    const r = evaluate({}, [big('2026-11-11', 2), big('2026-11-10', 8), big('2026-11-09', 8)]);
    expect(r.rampFrozen).toBe(true);
    expect(r.freezeReason).toBe('reply_rate_drop');
  });

  it('zero respostas com amostra pequena NAO congela, mas tambem nao avanca', () => {
    const small = healthy('2026-11-11', { sentNewContacts: 3, sentToRespondents: 1, replies: 0 });
    const r = evaluate({}, [small, healthy('2026-11-10'), healthy('2026-11-09')]);
    expect(r.rampFrozen).toBe(false);
    expect(r.rampAdvanced).toBe(false);
    expect(r.blockers).toContain('insufficient_sample');
  });

  it('congelar nao reduz estagio nem pausa', () => {
    const r = evaluate({ rampStage: 3, state: 'warming', rampChangedOn: '2026-11-01' }, [
      healthy('2026-11-11', { replies: 0 }),
      healthy('2026-11-10'),
      healthy('2026-11-09'),
    ]);
    expect(r.nextRampStage).toBe(3);
    expect(r.pause).toBeNull();
    expect(r.nextState).toBe('warming');
  });
});

describe('sinal desconhecido', () => {
  it('telemetria ausente em qualquer sinal bloqueia o avanco e fica marcada como desconhecida', () => {
    for (const key of ['replies', 'failures', 'trustedReports', 'restrictionEvents'] as const) {
      const ws = threeHealthy();
      ws[0] = healthy('2026-11-11', { [key]: null });
      const r = evaluate({}, ws);
      expect(r.rampAdvanced, key).toBe(false);
      expect(r.telemetryUnknown, key).toBe(true);
      expect(r.blockers, key).toContain('telemetry_unknown');
      expect(r.pause, key).toBeNull();
    }
  });

  it('desconhecido nao e zero: windowSignals nao inventa taxa', () => {
    const s = windowSignals(healthy('2026-11-11', { replies: null, failures: null }));
    expect(s.replyRate).toEqual({ known: false });
    expect(s.failureRate).toEqual({ known: false });
    expect(s.allKnown).toBe(false);
  });

  it('denuncia desconhecida nao pausa e nao libera', () => {
    const r = evaluate({}, [healthy('2026-11-11', { trustedReports: null })]);
    expect(r.pause).toBeNull();
    expect(r.rampAdvanced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pausa
// ---------------------------------------------------------------------------

describe('pausa', () => {
  it('desconexao pausa', () => {
    const r = evaluate({ status: 'disconnected', rampStage: 2, state: 'warming' }, threeHealthy());
    expect(r.pause).toEqual({ reason: 'session_disconnected', state: 'paused' });
    expect(r.nextState).toBe('paused');
    expect(r.nextRampStage).toBe(2);
    expect(r.rampAdvanced).toBe(false);
  });

  it('falhas seguidas pausam', () => {
    expect(evaluate({ consecutiveFailures: 3 }, []).pause?.reason).toBe('consecutive_failures');
    expect(evaluate({ consecutiveFailures: 2 }, []).pause).toBeNull();
  });

  it('denuncia confiavel vai para revisao', () => {
    const r = evaluate({}, [healthy('2026-11-11', { trustedReports: 1 })]);
    expect(r.pause).toEqual({ reason: 'trusted_report', state: 'review' });
    expect(r.nextState).toBe('review');
  });

  it('restricao vai para revisao', () => {
    const r = evaluate({}, [healthy('2026-11-12', { restrictionEvents: 1 })]);
    expect(r.pause).toEqual({ reason: 'restriction', state: 'review' });
  });

  it('taxa de falha alta com amostra pausa; moderada degrada; amostra pequena nao pausa', () => {
    const f = (failures: number, sent = 12) =>
      healthy('2026-11-11', { sentNewContacts: sent, sentToRespondents: 0, failures });
    expect(evaluate({}, [f(8)]).pause?.reason).toBe('failure_rate_high');
    const degraded = evaluate({}, [f(3)]);
    expect(degraded.pause).toBeNull();
    expect(degraded.nextState).toBe('degraded');
    expect(evaluate({}, [f(3, 3)]).pause).toBeNull();
  });

  it('estado pausado e pegajoso: janelas saudaveis e reconexao nao despausam', () => {
    for (const state of ['paused', 'review'] as const) {
      const r = evaluate({ state, status: 'connected' }, threeHealthy());
      expect(r.nextState).toBe(state);
      expect(r.rampAdvanced).toBe(false);
      expect(r.pause).toBeNull();
    }
  });

  it('eventos reconhecidos na recuperacao nao repausam; evento novo repausa', () => {
    const ack = { ackWindowDate: '2026-11-11', ackTrustedReports: 1, ackRestrictions: 0, state: 'warming' as const };
    const same = evaluate(ack, [healthy('2026-11-11', { trustedReports: 1 }), healthy('2026-11-10', { trustedReports: 2 })]);
    expect(same.pause).toBeNull();
    const fresh = evaluate(ack, [healthy('2026-11-11', { trustedReports: 2 })]);
    expect(fresh.pause?.reason).toBe('trusted_report');
    const later = evaluate(ack, [healthy('2026-11-12', { trustedReports: 1 })]);
    expect(later.pause?.reason).toBe('trusted_report');
  });

  it('janela anterior a recuperacao nao conta como saudavel', () => {
    const r = evaluate({ ackWindowDate: '2026-11-10', state: 'warming', rampStage: 1 }, threeHealthy());
    expect(r.rampAdvanced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tetos de envio (pacing, total com respondentes)
// ---------------------------------------------------------------------------

describe('checkNumberCanSend', () => {
  const ctx = { isNewContact: false, continuityAuthorized: true };

  it('dentro dos tetos libera', () => {
    expect(checkNumberCanSend(facts(), ctx)).toEqual({ allowed: true });
  });

  it('respondentes consomem o teto TOTAL', () => {
    const r = checkNumberCanSend(facts({ sentTotalToday: 20, sentNewToday: 2 }), ctx);
    expect(r).toEqual({ allowed: false, reasons: ['daily_cap_reached'], retryable: true });
    expect(checkNumberCanSend(facts({ sentTotalToday: 19, sentNewToday: 10 }), ctx)).toEqual({ allowed: true });
  });

  it('contato novo respeita o teto de novos e o total', () => {
    const c = { isNewContact: true, continuityAuthorized: true };
    expect(checkNumberCanSend(facts({ sentNewToday: 10, sentTotalToday: 10 }), c).allowed).toBe(false);
    expect(checkNumberCanSend(facts({ sentNewToday: 9, sentTotalToday: 12 }), c).allowed).toBe(true);
  });

  it('leitura incerta nega como saude desconhecida', () => {
    expect(checkNumberCanSend(null, ctx)).toEqual({ allowed: false, reasons: ['sender_health_unknown'], retryable: true });
    expect(checkNumberCanSend(facts({ sentTotalToday: Number.NaN }), ctx).allowed).toBe(false);
    expect(checkNumberCanSend(facts({ totalCap: -1 }), ctx).allowed).toBe(false);
  });

  it('pausado, em revisao ou desconectado nao envia e nao e retryable', () => {
    for (const over of [{ state: 'paused' }, { state: 'review' }, { connected: false }] as const) {
      const r = checkNumberCanSend(facts(over), ctx);
      expect(r).toMatchObject({ allowed: false, reasons: ['sender_paused'], retryable: false });
    }
  });

  it('degradado atende respondente mas segura contato novo', () => {
    expect(checkNumberCanSend(facts({ state: 'degraded' }), ctx).allowed).toBe(true);
    expect(checkNumberCanSend(facts({ state: 'degraded' }), { isNewContact: true, continuityAuthorized: true }).allowed).toBe(false);
  });

  it('Evolution exige continuidade autorizada', () => {
    const r = checkNumberCanSend(facts(), { isNewContact: false, continuityAuthorized: false });
    expect(r).toMatchObject({ allowed: false, reasons: ['evolution_requires_authorized_continuity'], retryable: false });
  });
});

// ---------------------------------------------------------------------------
// Persistencia e flag (banco em memoria)
// ---------------------------------------------------------------------------

let db: Fake;
let warn: ReturnType<typeof vi.spyOn>;

const instanceRow = (over: Row = {}): Row => ({
  id: 'inst-A',
  org_id: 'org-1',
  user_id: 'sdr-1',
  status: 'connected',
  auto_send_consecutive_failures: 0,
  auto_send_paused_at: null,
  auto_send_pause_reason: null,
  health_state: 'onboarding',
  health_total_daily_cap: 20,
  health_new_contacts_daily_cap: 10,
  health_ramp_stage: 0,
  health_ramp_changed_on: null,
  health_ack_window_date: null,
  health_ack_trusted_reports: 0,
  health_ack_restrictions: 0,
  ...over,
});

const winRow = (date: string, over: Row = {}): Row => ({
  instance_id: 'inst-A',
  window_date: date,
  sent_new_contacts: 8,
  sent_to_respondents: 4,
  replies_received: 3,
  failures: 0,
  trusted_reports: 0,
  restriction_events: 0,
  ...over,
});

const setup = (flag: boolean | null, tables: Partial<Fake['tables']> = {}) => {
  db = makeFake({
    app_flags: flag === null ? [] : [{ key: 'number_health_v1', enabled: flag }],
    whatsapp_instances: [instanceRow()],
    whatsapp_number_health_windows: [],
    whatsapp_send_queue: [],
    interactions: [],
    ...tables,
  });
  install(db);
};

beforeEach(() => {
  vi.resetAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

const onlyFlagRead = () => expect(db.reads.every((t) => t === 'app_flags')).toBe(true);

describe('flag number_health_v1 desligada: sem efeito', () => {
  for (const [label, flag] of [['desligada', false], ['sem linha', null]] as const) {
    it(`${label}: nada e lido alem da flag e nada e escrito`, async () => {
      setup(flag);
      expect(await loadHealthFactsForGateway('org-1', 'inst-A', NOW)).toBeUndefined();
      expect(await checkDispatchHealth({ orgId: 'org-1', leadId: 'l1', senderInstanceId: 'inst-A', continuityConfirmedByGateway: true, now: NOW })).toEqual({ enabled: false });
      expect(await recordNumberHealthSignals({ orgId: 'org-1', instanceId: 'inst-A', now: NOW, delta: { sentNewContacts: 1 } })).toEqual({ success: true, data: { recorded: false } });
      const run = await runNumberHealthEvaluation({ orgId: 'org-1', instanceId: 'inst-A', now: NOW });
      expect(run).toMatchObject({ success: true, data: { applied: false, reason: 'flag_disabled' } });
      expect(await authorizeNumberRecovery({ orgId: 'org-1', instanceId: 'inst-A', actor: { userId: 'm', orgId: 'org-1', role: 'manager' }, note: 'revisao concluida', idempotencyToken: 'token-1', expectedBlockedAt: '2026-11-12T10:00:00.000Z', now: NOW })).toMatchObject({ success: false, code: 'flag_disabled' });
      onlyFlagRead();
      expect(db.updates).toEqual([]);
      expect(db.rpcs).toEqual([]);
    });
  }

  it('flag ilegivel: avaliacao e registro nao escrevem; checagem de envio nega', async () => {
    setup(true);
    db.tables.app_flags = [];
    const failing = vi.fn(() => {
      throw new Error('boom');
    });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: failing } as never);
    expect(await runNumberHealthEvaluation({ orgId: 'org-1', instanceId: 'inst-A', now: NOW })).toMatchObject({
      data: { applied: false, reason: 'flag_unreadable' },
    });
    expect(await recordNumberHealthSignals({ orgId: 'org-1', instanceId: 'inst-A', delta: {} })).toMatchObject({
      data: { recorded: false },
    });
    expect(
      await checkDispatchHealth({ orgId: 'org-1', leadId: 'l1', senderInstanceId: 'inst-A', continuityConfirmedByGateway: true }),
    ).toMatchObject({ enabled: true, allowed: false, reasons: ['sender_health_unknown'] });
  });
});

describe('registro de sinais', () => {
  it('soma na janela do dia de Sao Paulo e deixa o que nao foi informado como desconhecido', async () => {
    setup(true);
    // 02:30Z do dia 08 ainda e dia 07 em Sao Paulo.
    const r = await recordNumberHealthSignals({
      orgId: 'org-1',
      instanceId: 'inst-A',
      now: new Date('2026-11-08T02:30:00Z'),
      delta: { sentToRespondents: 1, failures: 0 },
    });
    expect(r).toEqual({ success: true, data: { recorded: true } });
    expect(db.rpcs).toHaveLength(1);
    expect(db.rpcs[0]!.args).toMatchObject({
      p_window_date: '2026-11-07',
      p_sent_new_contacts: 0,
      p_sent_to_respondents: 1,
      p_replies: null,
      p_failures: 0,
      p_trusted_reports: null,
      p_restriction_events: null,
    });
  });

  it('delta negativo ou fracionario e recusado antes de qualquer escrita', async () => {
    setup(true);
    expect(await recordNumberHealthSignals({ orgId: 'org-1', instanceId: 'inst-A', delta: { failures: -1 } })).toMatchObject({ success: false, code: 'invalid_input' });
    expect(await recordNumberHealthSignals({ orgId: 'org-1', instanceId: 'inst-A', delta: { replies: 1.5 } })).toMatchObject({ success: false });
    expect(db.rpcs).toEqual([]);
  });

  it('erro do banco vira falha, sem lancar', async () => {
    setup(true);
    db.rpcError = true;
    expect(await recordNumberHealthSignals({ orgId: 'org-1', instanceId: 'inst-A', delta: {} })).toMatchObject({ success: false, code: 'write_failed' });
  });
});

describe('checkDispatchHealth (flag ligada)', () => {
  const input = { orgId: 'org-1', leadId: 'lead-1', senderInstanceId: 'inst-A', continuityConfirmedByGateway: true, now: NOW };

  it('soma janela do dia e fila atual no teto total e conta respondente fora do teto de novos', async () => {
    setup(true, {
      whatsapp_number_health_windows: [winRow('2026-11-12', { sent_new_contacts: 5, sent_to_respondents: 14 })],
      whatsapp_send_queue: [
        { sender_user_id: 'sdr-1', status: 'sent', sent_at: '2026-11-12T12:00:00Z', counts_toward_limit: true },
        { sender_user_id: 'sdr-1', status: 'sent', sent_at: '2026-11-12T13:00:00Z', counts_toward_limit: false },
      ],
      interactions: [{ org_id: 'org-1', lead_id: 'lead-1', channel: 'whatsapp', type: 'replied' }],
    });
    // total = 5 + 14 + 2 = 21 >= 20: teto total atingido mesmo sendo respondente.
    expect(await checkDispatchHealth(input)).toMatchObject({ enabled: true, allowed: false, reasons: ['daily_cap_reached'], retryable: true });
  });

  it('fila do dia anterior nao conta', async () => {
    setup(true, {
      whatsapp_send_queue: [{ sender_user_id: 'sdr-1', status: 'sent', sent_at: '2026-11-11T20:00:00Z', counts_toward_limit: true }],
    });
    expect(await checkDispatchHealth(input)).toMatchObject({ enabled: true, allowed: true, isNewContact: true, windowDate: '2026-11-12' });
  });

  it('respondente identificado pelo historico de resposta', async () => {
    setup(true, { interactions: [{ org_id: 'org-1', lead_id: 'lead-1', channel: 'whatsapp', type: 'replied' }] });
    expect(await checkDispatchHealth(input)).toMatchObject({ allowed: true, isNewContact: false });
  });

  it('instancia inexistente ou sem id: saude desconhecida, nunca outra instancia', async () => {
    setup(true);
    expect(await checkDispatchHealth({ ...input, senderInstanceId: 'inst-X' })).toMatchObject({ allowed: false, reasons: ['sender_health_unknown'] });
    expect(await checkDispatchHealth({ ...input, senderInstanceId: null })).toMatchObject({ allowed: false, reasons: ['sender_health_unknown'] });
  });

  it('numero pausado nao e substituido por outro numero saudavel da mesma organizacao', async () => {
    setup(true, {
      whatsapp_instances: [
        instanceRow({ health_state: 'paused' }),
        instanceRow({ id: 'inst-B', user_id: 'sdr-2', health_state: 'healthy' }),
      ],
    });
    const r = await checkDispatchHealth(input);
    expect(r).toMatchObject({ enabled: true, allowed: false, reasons: ['sender_paused'], retryable: false });
    expect(r).not.toHaveProperty('instanceId');
    expect(db.updates).toEqual([]);
    expect(db.rpcs).toEqual([]);
  });
});

describe('avaliacao persistida', () => {
  const run = () => runNumberHealthEvaluation({ orgId: 'org-1', instanceId: 'inst-A', now: NOW });

  it('avanca o degrau e grava os tetos do novo estagio com CAS pelo estado lido', async () => {
    setup(true, { whatsapp_number_health_windows: ['2026-11-11', '2026-11-10', '2026-11-09'].map((d) => winRow(d)) });
    const r = await run();
    expect(r).toMatchObject({ success: true, data: { applied: true, rampAdvanced: true, state: 'warming' } });
    const upd = db.updates.find((u) => u.patch.health_ramp_stage === 1)!;
    expect(upd.patch).toMatchObject({
      health_state: 'warming',
      health_ramp_stage: 1,
      health_ramp_changed_on: '2026-11-12',
      health_new_contacts_daily_cap: 20,
      health_total_daily_cap: 40,
    });
    expect(upd.filters).toContainEqual(['health_state', 'eq', 'onboarding']);
    expect(upd.filters).toContainEqual(['id', 'eq', 'inst-A']);
  });

  it('sem telemetria nao avanca nem muda tetos', async () => {
    setup(true);
    await run();
    const patch = db.updates[0]!.patch;
    expect(patch).not.toHaveProperty('health_ramp_stage');
    expect(patch).not.toHaveProperty('health_total_daily_cap');
    expect(patch).not.toHaveProperty('health_state');
  });

  it('desconexao pausa preservando tetos, estagio e janelas, e para tambem a fila atual', async () => {
    setup(true, {
      whatsapp_instances: [instanceRow({ status: 'disconnected', health_state: 'warming', health_ramp_stage: 2, health_total_daily_cap: 60, health_new_contacts_daily_cap: 30 })],
      whatsapp_number_health_windows: [winRow('2026-11-11')],
    });
    const r = await run();
    expect(r).toMatchObject({ success: true, data: { applied: true, paused: true, state: 'paused' } });
    for (const u of db.updates) {
      expect(u.patch).not.toHaveProperty('health_total_daily_cap');
      expect(u.patch).not.toHaveProperty('health_new_contacts_daily_cap');
      expect(u.patch).not.toHaveProperty('health_ramp_stage');
    }
    const row = db.tables.whatsapp_instances![0]!;
    expect(row).toMatchObject({ health_state: 'paused', health_pause_reason: 'session_disconnected', health_ramp_stage: 2, health_total_daily_cap: 60, auto_send_pause_reason: 'health:session_disconnected' });
    expect(db.tables.whatsapp_number_health_windows).toHaveLength(1);
  });

  it('nao sobrescreve pausa manual existente da fila', async () => {
    setup(true, { whatsapp_instances: [instanceRow({ status: 'disconnected', auto_send_paused_at: '2026-11-12T10:00:00Z', auto_send_pause_reason: 'pausado manualmente' })] });
    await run();
    expect(db.tables.whatsapp_instances![0]!.auto_send_pause_reason).toBe('pausado manualmente');
  });

  it('avaliar outro numero da organizacao nao toca o primeiro', async () => {
    setup(true, { whatsapp_instances: [instanceRow({ status: 'disconnected' }), instanceRow({ id: 'inst-B', user_id: 'sdr-2' })] });
    await run();
    expect(db.tables.whatsapp_instances!.find((r) => r.id === 'inst-B')).toMatchObject({ health_state: 'onboarding', auto_send_paused_at: null });
  });

  it('instancia de outra organizacao nao e encontrada', async () => {
    setup(true);
    expect(await runNumberHealthEvaluation({ orgId: 'org-2', instanceId: 'inst-A', now: NOW })).toMatchObject({ success: false, code: 'not_found' });
  });
});

describe('desconexao e recuperacao autorizada', () => {
  const manager = { userId: 'mgr-1', orgId: 'org-1', role: 'manager' as const };
  const blockedAt = '2026-11-12T10:00:00.000Z';
  const recover = (over: Partial<Parameters<typeof authorizeNumberRecovery>[0]> = {}) =>
    authorizeNumberRecovery({
      orgId: 'org-1',
      instanceId: 'inst-A',
      actor: manager,
      note: 'numero reconectado e revisado',
      idempotencyToken: over.idempotencyToken ?? 'token-default',
      expectedBlockedAt: over.expectedBlockedAt ?? blockedAt,
      now: NOW,
      ...over,
    });

  const paused = (over: Row = {}) =>
    instanceRow({
      health_state: 'paused',
      health_pause_reason: 'session_disconnected',
      health_state_changed_at: blockedAt,
      health_ramp_stage: 2,
      health_total_daily_cap: 60,
      health_new_contacts_daily_cap: 30,
      auto_send_paused_at: '2026-11-12T10:00:00Z',
      auto_send_pause_reason: 'health:session_disconnected',
      ...over,
    });

  it('reconectar sozinho nao despausa', async () => {
    setup(true, { whatsapp_instances: [paused()], whatsapp_number_health_windows: ['2026-11-11', '2026-11-10', '2026-11-09'].map((d) => winRow(d)) });
    await runNumberHealthEvaluation({ orgId: 'org-1', instanceId: 'inst-A', now: NOW });
    expect(db.tables.whatsapp_instances![0]).toMatchObject({ health_state: 'paused', health_ramp_stage: 2 });
  });

  it('SDR, gestor de outra organizacao ou justificativa vazia sao recusados', async () => {
    setup(true, { whatsapp_instances: [paused()] });
    expect(await recover({ actor: { ...manager, role: 'sdr' } })).toMatchObject({ success: false, code: 'forbidden' });
    expect(await recover({ actor: { ...manager, orgId: 'org-2' } })).toMatchObject({ success: false, code: 'forbidden' });
    expect(await recover({ note: ' curto ' })).toMatchObject({ success: false, code: 'invalid_input' });
    expect(db.updates).toEqual([]);
  });

  it('exige numero conectado e estado bloqueado', async () => {
    setup(true, { whatsapp_instances: [paused({ status: 'disconnected' })] });
    expect(await recover()).toMatchObject({ success: false, code: 'not_connected' });
    setup(true, { whatsapp_instances: [instanceRow()] });
    expect(await recover()).toMatchObject({ success: false, code: 'not_blocked' });
    expect(db.updates).toEqual([]);
  });

  it('gestor recupera: volta a warming, mantem estagio e tetos, libera so o freio da camada de saude', async () => {
    setup(true, { whatsapp_instances: [paused()], whatsapp_number_health_windows: [winRow('2026-11-12', { trusted_reports: 1 })] });
    expect(await recover()).toEqual({ success: true, data: { state: 'warming' } });
    const row = db.tables.whatsapp_instances![0]!;
    expect(row).toMatchObject({
      health_state: 'warming',
      health_ramp_stage: 2,
      health_total_daily_cap: 60,
      health_new_contacts_daily_cap: 30,
      health_ack_window_date: '2026-11-12',
      health_ack_trusted_reports: 1,
      auto_send_paused_at: null,
    });
    expect(db.tables.whatsapp_number_health_windows).toHaveLength(1);
  });

  it('nao libera pausa manual da fila', async () => {
    setup(true, { whatsapp_instances: [paused({ auto_send_pause_reason: 'pausado manualmente por Ana' })] });
    await recover();
    expect(db.tables.whatsapp_instances![0]!.auto_send_paused_at).toBe('2026-11-12T10:00:00Z');
  });
});

describe('garantias de codigo', () => {
  const src = readFileSync(join(__dirname, 'number-health.service.ts'), 'utf8');

  it('nunca apaga metricas', () => {
    expect(src).not.toMatch(/\.delete\(/);
    expect(src).not.toMatch(/\.upsert\(/);
    expect(src).not.toMatch(/truncate/i);
  });

  it('nunca escolhe outro numero: toda consulta de instancia usa o id recebido', () => {
    expect(src).not.toMatch(/\.neq\(\s*'id'/);
    expect(src).not.toMatch(/\.in\(\s*'id'/);
  });

  it('token do pedido e estavel e muda com nota ou episodio', () => {
    const base = {
      orgId: 'org-1',
      instanceId: 'inst-A',
      actorUserId: 'mgr-1',
      note: 'numero reconectado e revisado',
      blockedAt: '2026-11-12T10:00:00.000Z',
    };
    const token = recoveryIdempotencyToken(base);
    expect(token).toBe(recoveryIdempotencyToken(base));
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(recoveryIdempotencyToken({ ...base, note: 'outra justificativa valida' })).not.toBe(token);
    expect(recoveryIdempotencyToken({ ...base, blockedAt: '2026-11-13T10:00:00.000Z' })).not.toBe(token);
  });

  it('a migration nao concede DELETE e as flags nascem desligadas', () => {
    const sql = readFileSync(
      join(__dirname, '../../../../supabase/migrations/20261107200000_number_health.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/i);
    expect(sql).toMatch(/'number_health_v1', false/);
    expect(sql).toMatch(/health_total_daily_cap INTEGER NOT NULL DEFAULT 20/);
    expect(sql).toMatch(/health_new_contacts_daily_cap INTEGER NOT NULL DEFAULT 10/);
    expect(sql).toMatch(/health_state TEXT NOT NULL DEFAULT 'onboarding'/);
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });

  it('o contrato novo nao usa ON CONFLICT depois do update nem unique(instance, previous_state)', () => {
    const sql = readFileSync(
      join(__dirname, '../../../../supabase/migrations/20261109120000_number_health_recovery_contract.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/ON CONFLICT/i);
    expect(sql).not.toMatch(/unique\s*\(\s*instance_id\s*,\s*previous_state\s*\)/i);
    expect(sql).toMatch(/instance_id, blocked_at/);
    expect(sql).toMatch(/ON DELETE RESTRICT/);
    expect(sql).toMatch(/token_conflict/);
    expect(sql).toMatch(/stale_episode/);
    expect(sql).not.toMatch(/GRANT[^\n;]*\bDELETE\b/i);
    expect(sql).toMatch(/REFERENCES auth\.users\(id\)/);
  });
});
