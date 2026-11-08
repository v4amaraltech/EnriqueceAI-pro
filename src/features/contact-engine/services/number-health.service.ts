import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { brtDateKey, isBrBusinessDay } from '@/lib/utils/br-holidays';

import {
  BUSINESS_DAYS_PER_RAISE,
  DAILY_LIMIT_STEP,
  MAX_CONSECUTIVE_FAILURES,
  MAX_DAILY_LIMIT,
  START_DAILY_LIMIT,
  brtDayStartIso,
} from '@/features/whatsapp-auto-send/utils/pacing';

import type { HealthSignal, IsoTimestamp, NumberHealthState, SendDenialReason, Uuid } from '../types';
import { readScopedFlagState, type FlagScope } from './flag-scope.service';

/**
 * Saude e tetos por numero (PR10). Vale para instancias Evolution
 * (`whatsapp_instances`); a Cloud API oficial nao passa por aqui.
 *
 * Flag `number_health_v1` (app_flags, global, nasce desligada). DESLIGADA: este
 * modulo nao le instancia, janela nem fila, nao escreve nada e o gateway e o
 * dispatcher se comportam exatamente como antes. A flag e de restricao: erro de
 * leitura conta como LIGADA nos pontos de envio (fail-closed), mas nunca autoriza
 * escrita (avaliacao e registro nao escrevem com a flag ilegivel).
 *
 * Regras:
 *  - Janela = dia no calendario America/Sao_Paulo (UTC-3 fixo, o mesmo
 *    `brtDateKey` do pacing; sem horario de verao desde 2019).
 *  - A rampa so avanca com `BUSINESS_DAYS_PER_RAISE` janelas fechadas e saudaveis
 *    seguidas, cada uma com amostra minima e TODOS os sinais conhecidos. Tempo
 *    sozinho nunca avanca. Queda da taxa de resposta (com amostra minima) congela.
 *  - Telemetria ausente e desconhecida (`HealthSignal` com `known: false`): bloqueia
 *    avanco, nunca vira "sem risco". Nao bloqueia o envio dentro dos tetos atuais.
 *  - Falha de sessao, falhas seguidas, restricao ou denuncia confiavel pausam.
 *    `paused`/`review` so saem por recuperacao autorizada (`authorizeNumberRecovery`),
 *    nunca sozinhos nem por reconexao.
 *  - Pausa preserva tetos, estagio e metricas. Nada aqui apaga ou zera metrica,
 *    troca, gira ou substitui numero. Toda leitura e escrita usa o `instanceId`
 *    recebido; capacidade esgotada devolve negacao, nunca outro numero.
 *  - Os tetos daqui so RESTRINGEM: valem junto com o pacing atual
 *    (`auto_send_daily_limit`), que segue intacto. O mais restritivo prevalece.
 *  - Logs: somente ids e motivos.
 */

export const NUMBER_HEALTH_FLAG_KEY = 'number_health_v1';

// ---------------------------------------------------------------------------
// Parametros (derivados do pacing existente quando ha equivalente)
// ---------------------------------------------------------------------------

/** Mensagens minimas numa janela para ela contar como evidencia. */
export const MIN_WINDOW_SAMPLE = 10;
/** Acima disso a janela nao e saudavel (e o numero vira `degraded`). */
export const MAX_HEALTHY_FAILURE_RATE = 0.1;
/** Acima disso, com amostra minima, pausa. */
export const PAUSE_FAILURE_RATE = 0.3;
/** Taxa de resposta minima de uma janela saudavel. */
export const MIN_REPLY_RATE = 0.1;
/** Queda relativa contra a linha de base que congela a rampa. */
export const REPLY_DROP_RATIO = 0.5;
/** Quantas janelas fechadas e saudaveis seguidas para subir um degrau. */
export const WINDOWS_PER_RAISE = BUSINESS_DAYS_PER_RAISE;
/** Janelas consideradas pela avaliacao. */
export const EVALUATION_LOOKBACK_DAYS = 14;
/** Teto de contatos novos do estagio 0. Restritivo: metade do inicio do pacing. */
export const RAMP_BASE_NEW_CONTACTS = START_DAILY_LIMIT / 2;
export const MAX_RAMP_STAGE = Math.round((MAX_DAILY_LIMIT - RAMP_BASE_NEW_CONTACTS) / DAILY_LIMIT_STEP);

export interface RampCaps {
  newContacts: number;
  /** Inclui respondentes. */
  total: number;
}

/** Tetos do estagio. Estagio 0 = defaults da migration (10 novos, 20 total). */
export function rampCaps(stage: number): RampCaps {
  const s = Math.min(MAX_RAMP_STAGE, Math.max(0, Math.trunc(Number.isFinite(stage) ? stage : 0)));
  const newContacts = Math.min(MAX_DAILY_LIMIT, RAMP_BASE_NEW_CONTACTS + s * DAILY_LIMIT_STEP);
  return { newContacts, total: newContacts * 2 };
}

// ---------------------------------------------------------------------------
// Janela (America/Sao_Paulo)
// ---------------------------------------------------------------------------

/** Chave da janela (YYYY-MM-DD) de um instante, no fuso de Sao Paulo. */
export function healthWindowKey(at: Date): string {
  return brtDateKey(at);
}

/** Dias uteis FECHADOS (anteriores a `todayKey`), do mais recente ao mais antigo, estritamente depois de `floorKey`. */
export function closedBusinessDays(todayKey: string, count: number, floorKey: string | null): string[] {
  const out: string[] = [];
  const cursor = new Date(`${todayKey}T12:00:00Z`);
  for (let i = 0; i < 60 && out.length < count; i++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const key = cursor.toISOString().slice(0, 10);
    if (floorKey !== null && key <= floorKey) break;
    if (isBrBusinessDay(key)) out.push(key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sinais por janela
// ---------------------------------------------------------------------------

export interface HealthWindow {
  /** YYYY-MM-DD, calendario de Sao Paulo. */
  date: string;
  sentNewContacts: number;
  sentToRespondents: number;
  /** `null` = desconhecido. */
  replies: number | null;
  failures: number | null;
  trustedReports: number | null;
  restrictionEvents: number | null;
}

export interface WindowSignals {
  sample: number;
  replyRate: HealthSignal<number>;
  failureRate: HealthSignal<number>;
  trustedReports: HealthSignal<number>;
  restrictionEvents: HealthSignal<number>;
  /** Todos os quatro sinais conhecidos. */
  allKnown: boolean;
}

const known = (n: number | null): HealthSignal<number> =>
  n === null || !Number.isFinite(n) || n < 0 ? { known: false } : { known: true, value: n };

export function windowSignals(w: HealthWindow): WindowSignals {
  const sample = Math.max(0, w.sentNewContacts) + Math.max(0, w.sentToRespondents);
  const replies = known(w.replies);
  const failures = known(w.failures);
  const attempts = failures.known ? sample + failures.value : 0;
  const replyRate: HealthSignal<number> =
    replies.known && sample > 0 ? { known: true, value: replies.value / sample } : { known: false };
  const failureRate: HealthSignal<number> =
    failures.known && attempts > 0 ? { known: true, value: failures.value / attempts } : { known: false };
  const trustedReports = known(w.trustedReports);
  const restrictionEvents = known(w.restrictionEvents);
  return {
    sample,
    replyRate,
    failureRate,
    trustedReports,
    restrictionEvents,
    allKnown: replyRate.known && failureRate.known && trustedReports.known && restrictionEvents.known,
  };
}

// ---------------------------------------------------------------------------
// Avaliacao (pura)
// ---------------------------------------------------------------------------

export type HealthPauseReason =
  | 'session_disconnected'
  | 'consecutive_failures'
  | 'failure_rate_high'
  | 'trusted_report'
  | 'restriction';

export type RampBlocker =
  | 'state_blocked'
  | 'frozen_reply_rate'
  | 'degraded'
  | 'not_enough_windows'
  | 'telemetry_unknown'
  | 'insufficient_sample'
  | 'window_unhealthy';

export interface EvaluationInstance {
  /** `whatsapp_instances.status`. */
  status: string;
  state: NumberHealthState;
  rampStage: number;
  /** Dia (YYYY-MM-DD) da ultima mudanca de estagio. */
  rampChangedOn: string | null;
  consecutiveFailures: number;
  /** Recuperacao autorizada: eventos ate esta janela ja foram reconhecidos. */
  ackWindowDate: string | null;
  ackTrustedReports: number;
  ackRestrictions: number;
}

export interface EvaluationInput {
  now: Date;
  instance: EvaluationInstance;
  windows: HealthWindow[];
}

export interface EvaluationResult {
  nextState: NumberHealthState;
  /** Presente so quando a avaliacao PAUSA agora (estado atual ainda nao bloqueado). */
  pause: { reason: HealthPauseReason; state: 'paused' | 'review' } | null;
  nextRampStage: number;
  rampAdvanced: boolean;
  rampFrozen: boolean;
  freezeReason: string | null;
  blockers: RampBlocker[];
  /** Houve janela relevante com sinal desconhecido. */
  telemetryUnknown: boolean;
}

export const isBlockedState = (s: NumberHealthState): boolean => s === 'paused' || s === 'review';

function stateForStage(stage: number): NumberHealthState {
  return stage >= MAX_RAMP_STAGE ? 'healthy' : 'warming';
}

/** Janela sem o que a recuperacao autorizada ja reconheceu. */
function withAck(w: HealthWindow, i: EvaluationInstance): { window: HealthWindow; acknowledged: boolean } {
  if (i.ackWindowDate === null || w.date > i.ackWindowDate) return { window: w, acknowledged: false };
  if (w.date < i.ackWindowDate) {
    return {
      window: { ...w, trustedReports: w.trustedReports === null ? null : 0, restrictionEvents: w.restrictionEvents === null ? null : 0 },
      acknowledged: true,
    };
  }
  return {
    window: {
      ...w,
      trustedReports: w.trustedReports === null ? null : Math.max(0, w.trustedReports - i.ackTrustedReports),
      restrictionEvents: w.restrictionEvents === null ? null : Math.max(0, w.restrictionEvents - i.ackRestrictions),
    },
    acknowledged: true,
  };
}

function pauseTrigger(
  i: EvaluationInstance,
  windows: Array<{ window: HealthWindow; acknowledged: boolean }>,
): { reason: HealthPauseReason; state: 'paused' | 'review' } | null {
  if (i.status !== 'connected') return { reason: 'session_disconnected', state: 'paused' };
  if (i.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return { reason: 'consecutive_failures', state: 'paused' };
  for (const { window } of windows) {
    const s = windowSignals(window);
    if (s.trustedReports.known && s.trustedReports.value > 0) return { reason: 'trusted_report', state: 'review' };
    if (s.restrictionEvents.known && s.restrictionEvents.value > 0) return { reason: 'restriction', state: 'review' };
  }
  for (const { window, acknowledged } of windows) {
    if (acknowledged) continue;
    const s = windowSignals(window);
    if (s.sample >= MIN_WINDOW_SAMPLE && s.failureRate.known && s.failureRate.value > PAUSE_FAILURE_RATE) {
      return { reason: 'failure_rate_high', state: 'paused' };
    }
  }
  return null;
}

function isHealthyWindow(s: WindowSignals): boolean {
  return (
    s.allKnown &&
    s.sample >= MIN_WINDOW_SAMPLE &&
    s.failureRate.known &&
    s.failureRate.value <= MAX_HEALTHY_FAILURE_RATE &&
    s.replyRate.known &&
    s.replyRate.value >= MIN_REPLY_RATE &&
    s.trustedReports.known &&
    s.trustedReports.value === 0 &&
    s.restrictionEvents.known &&
    s.restrictionEvents.value === 0
  );
}

/** Queda de resposta com amostra minima na janela mais recente (fechada) com amostra. */
function replyRateDrop(sampled: Array<{ date: string; s: WindowSignals }>): string | null {
  const latest = sampled[0];
  if (!latest || !latest.s.replyRate.known) return null;
  const rate = latest.s.replyRate.value;
  if (rate < MIN_REPLY_RATE) return 'reply_rate_below_minimum';
  const base = sampled
    .slice(1, 4)
    .map((x) => (x.s.replyRate.known ? x.s.replyRate.value : null))
    .filter((v): v is number => v !== null);
  if (base.length === 0) return null;
  const baseline = base.reduce((a, b) => a + b, 0) / base.length;
  return rate < baseline * REPLY_DROP_RATIO ? 'reply_rate_drop' : null;
}

export function evaluateNumberHealth(input: EvaluationInput): EvaluationResult {
  const { now, instance: inst } = input;
  const todayKey = healthWindowKey(now);
  const all = input.windows
    .filter((w) => w.date <= todayKey)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((w) => withAck(w, inst));

  const base: EvaluationResult = {
    nextState: inst.state,
    pause: null,
    nextRampStage: inst.rampStage,
    rampAdvanced: false,
    rampFrozen: false,
    freezeReason: null,
    blockers: [],
    telemetryUnknown: false,
  };

  // 1. Gatilhos de pausa. Estado ja bloqueado e pegajoso: so a recuperacao autorizada o muda.
  const trigger = pauseTrigger(inst, all);
  if (isBlockedState(inst.state)) return { ...base, blockers: ['state_blocked'] };
  if (trigger) return { ...base, nextState: trigger.state, pause: trigger, blockers: ['state_blocked'] };

  // 2. Janelas fechadas de dias uteis depois do ultimo degrau e da ultima recuperacao.
  const floor = [inst.rampChangedOn, inst.ackWindowDate].filter((d): d is string => d !== null).sort().at(-1) ?? null;
  const sampledClosed = all
    .filter(({ window, acknowledged }) => !acknowledged && window.date < todayKey)
    .map(({ window }) => ({ date: window.date, s: windowSignals(window) }))
    .filter((x) => x.s.sample >= MIN_WINDOW_SAMPLE);

  // 3. Degradado: falha acima do saudavel, ainda abaixo do limite de pausa.
  const recent = all.find(({ acknowledged }) => !acknowledged);
  const recentSignals = recent ? windowSignals(recent.window) : null;
  const degraded =
    recentSignals !== null &&
    recentSignals.sample >= MIN_WINDOW_SAMPLE &&
    recentSignals.failureRate.known &&
    recentSignals.failureRate.value > MAX_HEALTHY_FAILURE_RATE;

  // 4. Congelamento por queda de resposta.
  const freezeReason = replyRateDrop(sampledClosed);

  const blockers: RampBlocker[] = [];
  if (degraded) blockers.push('degraded');
  if (freezeReason) blockers.push('frozen_reply_rate');

  // 5. Avanco: N janelas fechadas, saudaveis e com sinais conhecidos.
  const days = closedBusinessDays(todayKey, WINDOWS_PER_RAISE, floor);
  let telemetryUnknown = false;
  if (days.length < WINDOWS_PER_RAISE) {
    blockers.push('not_enough_windows');
  } else {
    for (const day of days) {
      const w = all.find((x) => x.window.date === day && !x.acknowledged)?.window;
      if (!w) {
        telemetryUnknown = true;
        blockers.push('telemetry_unknown');
        break;
      }
      const s = windowSignals(w);
      if (!s.allKnown) {
        telemetryUnknown = true;
        blockers.push('telemetry_unknown');
        break;
      }
      if (s.sample < MIN_WINDOW_SAMPLE) {
        blockers.push('insufficient_sample');
        break;
      }
      if (!isHealthyWindow(s)) {
        blockers.push('window_unhealthy');
        break;
      }
    }
  }

  const advance = blockers.length === 0 && inst.rampStage < MAX_RAMP_STAGE;
  const nextRampStage = advance ? inst.rampStage + 1 : inst.rampStage;

  let nextState: NumberHealthState = inst.state;
  if (degraded) nextState = 'degraded';
  else if (advance) nextState = stateForStage(nextRampStage);
  else if (inst.state === 'degraded') nextState = inst.rampStage === 0 ? 'onboarding' : stateForStage(inst.rampStage);

  return {
    nextState,
    pause: null,
    nextRampStage,
    rampAdvanced: advance,
    rampFrozen: freezeReason !== null,
    freezeReason,
    blockers,
    telemetryUnknown,
  };
}

// ---------------------------------------------------------------------------
// Checagem de envio (pura)
// ---------------------------------------------------------------------------

export interface NumberHealthFacts {
  instanceId: Uuid;
  /** `whatsapp_instances.status === 'connected'`. */
  connected: boolean;
  state: NumberHealthState;
  newContactsCap: number;
  totalCap: number;
  /** Ja enviados hoje (dia de Sao Paulo), de todas as origens conhecidas. */
  sentNewToday: number;
  sentTotalToday: number;
  windowDate: string;
}

export interface SendHealthContext {
  /** Lead que ainda nao respondeu neste canal. Respondente nao usa teto de novos, mas usa o total. */
  isNewContact: boolean;
  /** Evolution so serve continuidade autorizada. */
  continuityAuthorized: boolean;
}

export type SendHealthCheck =
  | { allowed: true }
  | { allowed: false; reasons: SendDenialReason[]; retryable: boolean };

const validCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * `facts` nulo (leitura incerta) nega com `sender_health_unknown`. Capacidade
 * esgotada e espera (`retryable`), nunca redistribuicao para outro numero.
 */
export function checkNumberCanSend(facts: NumberHealthFacts | null, ctx: SendHealthContext): SendHealthCheck {
  if (!facts) return { allowed: false, reasons: ['sender_health_unknown'], retryable: true };
  if (
    !validCount(facts.newContactsCap) ||
    !validCount(facts.totalCap) ||
    !validCount(facts.sentNewToday) ||
    !validCount(facts.sentTotalToday)
  ) {
    return { allowed: false, reasons: ['sender_health_unknown'], retryable: true };
  }

  const reasons: SendDenialReason[] = [];
  if (!ctx.continuityAuthorized) reasons.push('evolution_requires_authorized_continuity');

  if (!facts.connected || isBlockedState(facts.state)) {
    reasons.push('sender_paused');
    return { allowed: false, reasons, retryable: false };
  }

  // `degraded` ainda atende quem ja respondeu; contato novo fica em espera.
  const newCap = facts.state === 'degraded' ? 0 : facts.newContactsCap;
  let capReached = false;
  if (facts.sentTotalToday >= facts.totalCap) capReached = true;
  if (ctx.isNewContact && facts.sentNewToday >= newCap) capReached = true;
  if (capReached) reasons.push('daily_cap_reached');

  if (reasons.length === 0) return { allowed: true };
  return { allowed: false, reasons, retryable: reasons.every((r) => r === 'daily_cap_reached') };
}

// ---------------------------------------------------------------------------
// Flag
// ---------------------------------------------------------------------------

export type NumberHealthFlag = 'on' | 'off' | 'error';

export async function readNumberHealthFlag(scope?: FlagScope): Promise<NumberHealthFlag> {
  return readScopedFlagState(NUMBER_HEALTH_FLAG_KEY, scope);
}

// ---------------------------------------------------------------------------
// Carga de fatos
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof createServiceRoleClient>;
type Rows<T> = { data: T[] | null; error: { message: string } | null };

interface InstanceHealthRow {
  id: string;
  org_id: string;
  user_id: string | null;
  status: string;
  auto_send_consecutive_failures: number;
  auto_send_paused_at: string | null;
  health_state: NumberHealthState;
  health_total_daily_cap: number;
  health_new_contacts_daily_cap: number;
  health_ramp_stage: number;
  health_ramp_changed_on: string | null;
  health_ack_window_date: string | null;
  health_ack_trusted_reports: number;
  health_ack_restrictions: number;
}

const INSTANCE_HEALTH_COLUMNS =
  'id, org_id, user_id, status, auto_send_consecutive_failures, auto_send_paused_at, health_state, health_total_daily_cap, health_new_contacts_daily_cap, health_ramp_stage, health_ramp_changed_on, health_ack_window_date, health_ack_trusted_reports, health_ack_restrictions';

async function readInstance(db: Db, orgId: Uuid, instanceId: Uuid): Promise<InstanceHealthRow | null> {
  const res = (await from(db, 'whatsapp_instances')
    .select(INSTANCE_HEALTH_COLUMNS)
    .eq('org_id', orgId)
    .eq('id', instanceId)
    .limit(1)) as unknown as Rows<InstanceHealthRow>;
  if (res.error) return null;
  return res.data?.[0] ?? null;
}

interface WindowRow {
  window_date: string;
  sent_new_contacts: number;
  sent_to_respondents: number;
  replies_received: number | null;
  failures: number | null;
  trusted_reports: number | null;
  restriction_events: number | null;
}

const WINDOW_COLUMNS =
  'window_date, sent_new_contacts, sent_to_respondents, replies_received, failures, trusted_reports, restriction_events';

const toWindow = (r: WindowRow): HealthWindow => ({
  date: r.window_date,
  sentNewContacts: Number(r.sent_new_contacts),
  sentToRespondents: Number(r.sent_to_respondents),
  replies: r.replies_received === null ? null : Number(r.replies_received),
  failures: r.failures === null ? null : Number(r.failures),
  trustedReports: r.trusted_reports === null ? null : Number(r.trusted_reports),
  restrictionEvents: r.restriction_events === null ? null : Number(r.restriction_events),
});

/**
 * Envios de hoje da fila atual (`whatsapp_send_queue`), somente leitura. O pacing
 * atual nao e alterado; estes envios contam para o teto total deste modulo.
 */
async function countLegacyQueueToday(
  db: Db,
  userId: string | null,
  now: Date,
): Promise<{ total: number; counted: number } | null> {
  if (!userId) return { total: 0, counted: 0 };
  const base = () =>
    from(db, 'whatsapp_send_queue')
      .select('id', { count: 'exact', head: true })
      .eq('sender_user_id', userId)
      .eq('status', 'sent')
      .gte('sent_at', brtDayStartIso(now));
  const [total, counted] = (await Promise.all([base(), base().eq('counts_toward_limit', true)])) as unknown as Array<{
    count: number | null;
    error?: { message: string } | null;
  }>;
  if (!total || !counted || total.error || counted.error) return null;
  return { total: total.count ?? 0, counted: counted.count ?? 0 };
}

/** Carrega o estado de saude de UMA instancia. Qualquer leitura incerta devolve `null`. */
export async function loadNumberHealthFacts(
  orgId: Uuid,
  instanceId: Uuid,
  now: Date = new Date(),
): Promise<NumberHealthFacts | null> {
  try {
    const db = createServiceRoleClient();
    const inst = await readInstance(db, orgId, instanceId);
    if (!inst) return null;
    const windowDate = healthWindowKey(now);
    const [win, queue] = await Promise.all([
      from(db, 'whatsapp_number_health_windows')
        .select(WINDOW_COLUMNS)
        .eq('instance_id', instanceId)
        .eq('window_date', windowDate)
        .limit(1) as unknown as Promise<Rows<WindowRow>>,
      countLegacyQueueToday(db, inst.user_id, now),
    ]);
    if (win.error || !queue) return null;
    const row = win.data?.[0];
    const w = row ? toWindow(row) : null;
    return {
      instanceId,
      connected: inst.status === 'connected',
      state: inst.health_state,
      newContactsCap: Number(inst.health_new_contacts_daily_cap),
      totalCap: Number(inst.health_total_daily_cap),
      sentNewToday: (w?.sentNewContacts ?? 0) + queue.counted,
      sentTotalToday: (w ? w.sentNewContacts + w.sentToRespondents : 0) + queue.total,
      windowDate,
    };
  } catch {
    return null;
  }
}

/** O lead ja respondeu neste canal? `null` = incerto (tratar como contato novo, o mais restritivo). */
export async function leadHasWhatsAppReply(orgId: Uuid, leadId: Uuid): Promise<boolean | null> {
  try {
    const res = (await from(createServiceRoleClient(), 'interactions')
      .select('id')
      .eq('org_id', orgId)
      .eq('lead_id', leadId)
      .eq('channel', 'whatsapp')
      .eq('type', 'replied')
      .limit(1)) as unknown as Rows<{ id: string }>;
    if (res.error || !res.data) return null;
    return res.data.length > 0;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ponto de integracao: gateway (PR06)
// ---------------------------------------------------------------------------

/**
 * Fatos para o gateway. `undefined` = flag desligada, nada e lido e a decisao nao
 * muda. `null` = flag ligada (ou ilegivel) mas fatos incertos: o gateway nega.
 */
export async function loadHealthFactsForGateway(
  orgId: Uuid,
  instanceId: Uuid,
  now: Date,
): Promise<NumberHealthFacts | null | undefined> {
  const flag = await readNumberHealthFlag({ orgId });
  if (flag === 'off') return undefined;
  return loadNumberHealthFacts(orgId, instanceId, now);
}

// ---------------------------------------------------------------------------
// Ponto de integracao: dispatcher (PR08)
// ---------------------------------------------------------------------------

export type DispatchHealthCheck =
  | { enabled: false }
  | {
      enabled: true;
      allowed: true;
      instanceId: Uuid;
      windowDate: string;
      isNewContact: boolean;
    }
  | { enabled: true; allowed: false; reasons: SendDenialReason[]; retryable: boolean };

export interface DispatchHealthInput {
  orgId: Uuid;
  leadId: Uuid;
  /** Instancia do comando autorizado. Nunca escolhida aqui. */
  senderInstanceId: Uuid | null;
  /** O dispatcher so chega aqui depois de o gateway ter reavaliado a continuidade. */
  continuityConfirmedByGateway: boolean;
  now?: Date;
}

export async function checkDispatchHealth(input: DispatchHealthInput): Promise<DispatchHealthCheck> {
  const flag = await readNumberHealthFlag({ orgId: input.orgId });
  if (flag === 'off') return { enabled: false };
  const now = input.now ?? new Date();
  if (!input.senderInstanceId) {
    return { enabled: true, allowed: false, reasons: ['sender_health_unknown'], retryable: true };
  }
  const [facts, replied] = await Promise.all([
    loadNumberHealthFacts(input.orgId, input.senderInstanceId, now),
    leadHasWhatsAppReply(input.orgId, input.leadId),
  ]);
  const isNewContact = replied !== true;
  const check = checkNumberCanSend(facts, { isNewContact, continuityAuthorized: input.continuityConfirmedByGateway });
  if (!check.allowed) return { enabled: true, ...check };
  return {
    enabled: true,
    allowed: true,
    instanceId: input.senderInstanceId,
    windowDate: facts?.windowDate ?? healthWindowKey(now),
    isNewContact,
  };
}

// ---------------------------------------------------------------------------
// Registro de sinais (atomico, so soma)
// ---------------------------------------------------------------------------

export interface HealthSignalDelta {
  sentNewContacts?: number;
  sentToRespondents?: number;
  /** Omitido = sem informacao (continua desconhecido). Zero explicito = "nenhum". */
  replies?: number;
  failures?: number;
  trustedReports?: number;
  restrictionEvents?: number;
}

export interface RecordSignalsInput {
  orgId: Uuid;
  instanceId: Uuid;
  now?: Date;
  delta: HealthSignalDelta;
}

const validDelta = (n: number | undefined): boolean => n === undefined || (Number.isInteger(n) && n >= 0);

/**
 * Soma deltas na janela de hoje (Sao Paulo). Flag desligada: nao escreve nada.
 * Nunca lanca: telemetria nao pode derrubar o envio.
 */
export async function recordNumberHealthSignals(
  input: RecordSignalsInput,
): Promise<ActionResult<{ recorded: boolean }>> {
  const d = input.delta;
  if (![d.sentNewContacts, d.sentToRespondents, d.replies, d.failures, d.trustedReports, d.restrictionEvents].every(validDelta)) {
    return { success: false, error: 'Delta invalido', code: 'invalid_input' };
  }
  try {
    const flag = await readNumberHealthFlag({ orgId: input.orgId });
    if (flag !== 'on') return { success: true, data: { recorded: false } };
    const { error } = (await createServiceRoleClient().rpc('record_number_health_window' as never, {
      p_org_id: input.orgId,
      p_instance_id: input.instanceId,
      p_window_date: healthWindowKey(input.now ?? new Date()),
      p_sent_new_contacts: d.sentNewContacts ?? 0,
      p_sent_to_respondents: d.sentToRespondents ?? 0,
      p_replies: d.replies ?? null,
      p_failures: d.failures ?? null,
      p_trusted_reports: d.trustedReports ?? null,
      p_restriction_events: d.restrictionEvents ?? null,
    } as never)) as unknown as { error: { message: string } | null };
    if (error) return { success: false, error: 'Falha ao registrar sinais de saude', code: 'write_failed' };
    return { success: true, data: { recorded: true } };
  } catch {
    return { success: false, error: 'Falha ao registrar sinais de saude', code: 'write_failed' };
  }
}

// ---------------------------------------------------------------------------
// Avaliacao com persistencia
// ---------------------------------------------------------------------------

export interface RunEvaluationInput {
  orgId: Uuid;
  instanceId: Uuid;
  now?: Date;
}

export interface RunEvaluationResult {
  applied: boolean;
  reason: string | null;
  state: NumberHealthState | null;
  paused: boolean;
  rampAdvanced: boolean;
  rampFrozen: boolean;
  blockers: RampBlocker[];
}

const noop = (reason: string, state: NumberHealthState | null = null): RunEvaluationResult => ({
  applied: false,
  reason,
  state,
  paused: false,
  rampAdvanced: false,
  rampFrozen: false,
  blockers: [],
});

function logHealth(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.warn(JSON.stringify({ event, ...fields }));
}

/**
 * Avalia UMA instancia e persiste o resultado. Flag desligada ou ilegivel: nao
 * le nem escreve. Nunca escolhe outra instancia; nunca apaga janelas.
 */
export async function runNumberHealthEvaluation(input: RunEvaluationInput): Promise<ActionResult<RunEvaluationResult>> {
  const now = input.now ?? new Date();
  const flag = await readNumberHealthFlag({ orgId: input.orgId });
  if (flag === 'off') return { success: true, data: noop('flag_disabled') };
  if (flag === 'error') return { success: true, data: noop('flag_unreadable') };

  try {
    const db = createServiceRoleClient();
    const inst = await readInstance(db, input.orgId, input.instanceId);
    if (!inst) return { success: false, error: 'Numero nao encontrado', code: 'not_found' };

    const since = new Date(now.getTime() - EVALUATION_LOOKBACK_DAYS * 86_400_000);
    const winRes = (await from(db, 'whatsapp_number_health_windows')
      .select(WINDOW_COLUMNS)
      .eq('instance_id', input.instanceId)
      .gte('window_date', healthWindowKey(since))
      .order('window_date', { ascending: false })
      .limit(EVALUATION_LOOKBACK_DAYS + 2)) as unknown as Rows<WindowRow>;
    if (winRes.error || !winRes.data) return { success: false, error: 'Falha ao ler janelas', code: 'read_failed' };

    const result = evaluateNumberHealth({
      now,
      instance: {
        status: inst.status,
        state: inst.health_state,
        rampStage: Number(inst.health_ramp_stage),
        rampChangedOn: inst.health_ramp_changed_on,
        consecutiveFailures: Number(inst.auto_send_consecutive_failures),
        ackWindowDate: inst.health_ack_window_date,
        ackTrustedReports: Number(inst.health_ack_trusted_reports),
        ackRestrictions: Number(inst.health_ack_restrictions),
      },
      windows: winRes.data.map(toWindow),
    });

    const nowIso: IsoTimestamp = now.toISOString();
    const patch: Record<string, unknown> = { health_evaluated_at: nowIso };
    if (result.nextState !== inst.health_state) {
      patch.health_state = result.nextState;
      patch.health_state_changed_at = nowIso;
    }
    if (result.pause) patch.health_pause_reason = result.pause.reason;
    if (result.rampAdvanced) {
      const caps = rampCaps(result.nextRampStage);
      patch.health_ramp_stage = result.nextRampStage;
      patch.health_ramp_changed_on = healthWindowKey(now);
      patch.health_new_contacts_daily_cap = caps.newContacts;
      patch.health_total_daily_cap = caps.total;
    }
    patch.health_ramp_frozen_at = result.rampFrozen ? nowIso : null;
    patch.health_ramp_freeze_reason = result.freezeReason;

    // CAS pelo estado lido: duas avaliacoes concorrentes nao se atropelam.
    const upd = (await from(db, 'whatsapp_instances')
      .update(patch as never)
      .eq('org_id', input.orgId)
      .eq('id', input.instanceId)
      .eq('health_state', inst.health_state)
      .select('id')) as unknown as Rows<{ id: string }>;
    if (upd.error) return { success: false, error: 'Falha ao gravar saude', code: 'write_failed' };
    if (!upd.data?.length) return { success: true, data: noop('state_conflict', inst.health_state) };

    if (result.pause && inst.auto_send_paused_at === null) {
      // Reusa o freio atual para a fila existente parar tambem. So preenche se ainda nao estava pausada.
      await from(db, 'whatsapp_instances')
        .update({ auto_send_paused_at: nowIso, auto_send_pause_reason: `health:${result.pause.reason}` } as never)
        .eq('org_id', input.orgId)
        .eq('id', input.instanceId)
        .is('auto_send_paused_at', null);
    }

    logHealth('number_health_evaluated', {
      orgId: input.orgId,
      instanceId: input.instanceId,
      from: inst.health_state,
      to: result.nextState,
      pauseReason: result.pause?.reason ?? null,
      rampAdvanced: result.rampAdvanced,
      rampFrozen: result.rampFrozen,
      blockers: result.blockers.join(',') || null,
    });
    return {
      success: true,
      data: {
        applied: true,
        reason: null,
        state: result.nextState,
        paused: result.pause !== null,
        rampAdvanced: result.rampAdvanced,
        rampFrozen: result.rampFrozen,
        blockers: result.blockers,
      },
    };
  } catch {
    return { success: false, error: 'Falha ao avaliar saude do numero', code: 'unexpected' };
  }
}

// ---------------------------------------------------------------------------
// Recuperacao autorizada
// ---------------------------------------------------------------------------

export interface RecoveryInput {
  orgId: Uuid;
  instanceId: Uuid;
  /** Quem autoriza. Precisa ser gestor da mesma organizacao. */
  actor: { userId: Uuid; orgId: Uuid; role: 'manager' | 'sdr' };
  /** Justificativa registrada (revisao do motivo da pausa). */
  note: string;
  now?: Date;
}

/**
 * Tira o numero de `paused`/`review` SOMENTE por decisao de gestor, com o numero
 * reconectado. Volta para `warming` (nunca `healthy`), mantem estagio e tetos,
 * nao apaga janelas e reconhece os eventos ja vistos para que nao repausem sozinhos.
 * Reconexao sozinha nunca despausa.
 */
export async function authorizeNumberRecovery(input: RecoveryInput): Promise<ActionResult<{ state: NumberHealthState }>> {
  if (input.actor.role !== 'manager' || input.actor.orgId !== input.orgId) {
    return { success: false, error: 'Recuperacao exige gestor da organizacao', code: 'forbidden' };
  }
  if (input.note.trim().length < 10) {
    return { success: false, error: 'Informe a justificativa da recuperacao', code: 'invalid_input' };
  }
  const flag = await readNumberHealthFlag({ orgId: input.orgId });
  if (flag !== 'on') return { success: false, error: 'Saude por numero desativada', code: 'flag_disabled' };

  try {
    const now = input.now ?? new Date();
    const db = createServiceRoleClient();
    const inst = await readInstance(db, input.orgId, input.instanceId);
    if (!inst) return { success: false, error: 'Numero nao encontrado', code: 'not_found' };
    if (!isBlockedState(inst.health_state)) {
      return { success: false, error: 'Numero nao esta pausado pela saude', code: 'not_blocked' };
    }
    if (inst.status !== 'connected') {
      return { success: false, error: 'Reconecte o WhatsApp antes de recuperar', code: 'not_connected' };
    }

    const windowDate = healthWindowKey(now);
    const win = (await from(db, 'whatsapp_number_health_windows')
      .select(WINDOW_COLUMNS)
      .eq('instance_id', input.instanceId)
      .eq('window_date', windowDate)
      .limit(1)) as unknown as Rows<WindowRow>;
    if (win.error) return { success: false, error: 'Falha ao ler janela', code: 'read_failed' };
    const today = win.data?.[0];
    const nowIso = now.toISOString();

    const upd = (await from(db, 'whatsapp_instances')
      .update({
        health_state: 'warming',
        health_pause_reason: null,
        health_state_changed_at: nowIso,
        health_recovered_at: nowIso,
        health_ack_window_date: windowDate,
        health_ack_trusted_reports: today?.trusted_reports ?? 0,
        health_ack_restrictions: today?.restriction_events ?? 0,
        // Falhas seguidas voltam a zero para o gatilho nao repausar na hora.
        auto_send_consecutive_failures: 0,
      } as never)
      .eq('org_id', input.orgId)
      .eq('id', input.instanceId)
      .eq('health_state', inst.health_state)
      .select('id')) as unknown as Rows<{ id: string }>;
    if (upd.error) return { success: false, error: 'Falha ao gravar recuperacao', code: 'write_failed' };
    if (!upd.data?.length) return { success: false, error: 'Estado mudou, tente de novo', code: 'state_conflict' };

    // Libera o freio da fila atual somente se foi esta camada que o aplicou.
    await from(db, 'whatsapp_instances')
      .update({ auto_send_paused_at: null, auto_send_pause_reason: null, auto_send_next_at: null } as never)
      .eq('org_id', input.orgId)
      .eq('id', input.instanceId)
      .like('auto_send_pause_reason', 'health:%');

    logHealth('number_health_recovered', {
      orgId: input.orgId,
      instanceId: input.instanceId,
      actorUserId: input.actor.userId,
      from: inst.health_state,
    });
    return { success: true, data: { state: 'warming' } };
  } catch {
    return { success: false, error: 'Falha ao recuperar o numero', code: 'unexpected' };
  }
}
