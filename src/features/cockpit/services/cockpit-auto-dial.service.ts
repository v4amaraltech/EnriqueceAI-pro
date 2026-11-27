import type { SupabaseClient } from '@supabase/supabase-js';

import { BR_NATIONAL_HOLIDAYS } from '@/lib/utils/br-holidays';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { computeCallPriority, rankLeadsByPriority, type PriorityResult } from '@/features/contact-engine/services/call-priority';

import type { AutoDialGateCode } from '../auto-dial.types';
import type { CockpitViewer } from '../types';
import {
  AUTO_DIAL_RULES,
  DIAL_SPACING,
  brtStartOfDay,
  evaluateDialSpacing,
  evaluateLeadEligibility,
  isDailyCapReached,
  isWithinDialWindow,
  nextReleaseAt,
  type AutoDialRules,
  type LeadDialStats,
  type RecentUserCall,
} from '../utils/auto-dial-rules';
import { AUTO_DIAL_RPC_OVERRIDES, SIGNAL_CHUNK_SIZE, chunk } from '../utils/cold-lead-order';
import { pickCockpitLead, type CockpitTier } from '../utils/next-call-pick';
import { RECOVERY_BLOCKED_REASON_NAMES, isNoResumeReason, type AutoDialQueue } from '../utils/recovery-queue';
import { ACTION_DISPOSITIONS, NO_ACTION_DISPOSITIONS, noActionCooldownCutoff } from '../utils/no-action-cooldown';
import { isRealConversation } from '../utils/real-conversation';
import { fetchCockpitCandidates } from './cockpit-candidates.service';
import { POSTGREST_MAX_ROWS, fetchRecoveryCandidates, loadFutureReturnLeadIds, loadRecoveryHoldoutLeadIds } from './cockpit-recovery-candidates.service';
import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from './cockpit-auto-dial-flag';
import { loadSignalsInChunks } from './next-call-card.service';
import { loadCallbackTarget } from './callback-contact.service';

/**
 * Servidor do motor automático (plano §3.2). TODA trava mora aqui (NFR-3) e FALHA FECHADA (NFR-4):
 * erro ao ler flag, bloqueio, contagem ou lead = não disca. Service role ignora RLS, então toda consulta
 * filtra `org_id`. O navegador só manda `leadId`; telefone e dono são lidos aqui.
 */

type Rows<T> = { data: T[] | null; error: { message: string } | null };
type One<T> = { data: T | null; error: { message: string } | null };
type Count = { count: number | null; error: { message: string } | null };

/** Chave do marcador gravado em `calls.metadata` pelas ligações do motor (teto de 100 conta só estas, C-2). */
export const AUTO_DIAL_METADATA_KEY = 'cockpit_auto_dial';

/** Status em que o motor nunca liga na fila normal (ganho, perdido, arquivado). Usada na escolha e no portão. */
export const EXCLUDED_LEAD_STATUSES = ['unqualified', 'archived', 'won'];

/**
 * Lead QUALIFICADO (reunião marcada) também não entra na fila normal (decisão do usuário, 17/11: o Mercante Net foi ligado
 * 36 vezes). Diferente dos de cima, um retorno VENCIDO de "Ligar depois" agendado pelo SDR continua valendo (ele marcou a data).
 */
export const QUALIFIED_LEAD_STATUS = 'qualified';

/**
 * Feriados do motor (C-1): a lista nacional fixa do app UNIDA à tabela `business_holidays` (a mesma da régua de atraso).
 * A união é a mais restritiva. A tabela é global (não tem `org_id`). Erro de leitura = só a lista fixa, que continua
 * bloqueando os feriados nacionais (falha fechada para eles).
 */
export async function loadMotorHolidays(client: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>(Object.keys(BR_NATIONAL_HOLIDAYS));
  try {
    const { data, error } = (await from(client, 'business_holidays').select('holiday_date')) as Rows<{ holiday_date: string }>;
    if (error || !data) {
      console.error('[cockpit-auto-dial] business_holidays:', error?.message ?? 'sem dados');
      return out;
    }
    for (const r of data) if (typeof r.holiday_date === 'string') out.add(r.holiday_date.slice(0, 10));
  } catch (err) {
    console.error('[cockpit-auto-dial] business_holidays:', err instanceof Error ? err.message : 'erro');
  }
  return out;
}

/** Ligações recentes DO PRÓPRIO usuário (qualquer origem), para a trava `too_soon`. `null` = falha de leitura. */
async function loadRecentUserCalls(client: SupabaseClient, orgId: string, userId: string, now: Date): Promise<RecentUserCall[] | null> {
  const since = new Date(now.getTime() - DIAL_SPACING.ongoingMaxAgeMs).toISOString();
  const { data, error } = (await from(client, 'calls')
    .select('id, created_at, hangup_cause, metadata')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('created_at', since)) as Rows<{ id: string; created_at: string; hangup_cause: string | null; metadata: Record<string, unknown> | null }>;
  if (error || !data) return null;
  return data.map((c) => ({ created_at: c.created_at, hangup_cause: c.hangup_cause, isMotor: c.metadata?.[AUTO_DIAL_METADATA_KEY] != null }));
}

/** Colunas que `isRealConversation` precisa (desfecho do SDR, IA e telemetria). */
const CALL_DAY_COLUMNS = 'id, created_at, started_at, answered_at, duration_seconds, status, sdr_disposition, metadata';
interface CallDayRow {
  id: string;
  created_at: string;
  started_at: string | null;
  answered_at: string | null;
  duration_seconds: number | null;
  status: string | null;
  sdr_disposition: string | null;
  metadata: unknown;
}

export interface SimulatedAttempts {
  /** leadId → instantes (ISO) das ligações simuladas hoje. No modo simulado não há linha em `calls`. */
  [leadId: string]: string[];
}

function holdTypesBy(rows: Array<{ lead_id: string; tipo: string }>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.lead_id, [...(out.get(r.lead_id) ?? []), r.tipo]);
  return out;
}

/** Ligações do dia (BRT) do lead, de QUALQUER origem. `null` = falha de leitura. */
export async function loadLeadCallStats(
  client: SupabaseClient,
  orgId: string,
  leadId: string,
  now: Date,
): Promise<Pick<LeadDialStats, 'callsToday' | 'lastCallAt' | 'conversationToday'> | null> {
  const since = new Date(brtStartOfDay(now)).toISOString();
  const { data, error } = (await from(client, 'calls')
    .select(CALL_DAY_COLUMNS)
    .eq('org_id', orgId)
    .eq('lead_id', leadId)
    .gte('created_at', since)) as Rows<CallDayRow>;
  if (error || !data) return null;
  let last: number | null = null;
  for (const c of data) {
    const at = Date.parse(c.started_at ?? c.created_at);
    if (!Number.isNaN(at) && (last === null || at > last)) last = at;
  }
  return { callsToday: data.length, lastCallAt: last, conversationToday: data.some(isRealConversation) };
}

/** Quantas ligações DO MOTOR o usuário fez hoje (FR-12, C-2). `null` = falha de leitura. */
export async function countMotorCallsToday(client: SupabaseClient, orgId: string, userId: string, now: Date): Promise<number | null> {
  const since = new Date(brtStartOfDay(now)).toISOString();
  const { count, error } = (await from(client, 'calls')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('started_at', since)
    .not(`metadata->${AUTO_DIAL_METADATA_KEY}`, 'is', null)) as unknown as Count;
  if (error || count === null) return null;
  return count;
}

/**
 * Retornos vencidos (FR-23, A-D2) entre os `leadIds`: `scheduled_activities` de telefone (`kind='return'`), pendentes,
 * com `scheduled_at` <= agora. Igual à Execução, a posse é do lead (`leads.assigned_to`), nunca de quem clicou em
 * Agendar: aqui só entram leads que já estão na carteira do usuário (vêm da RPC ou do portão, que confere o dono).
 * O retorno é CONSUMIDO por qualquer ligação ao lead depois da hora marcada (assim ele não fura o intervalo
 * para sempre). `null` = falha de leitura (falha fechada). Devolve leadId → hora marcada mais antiga (ms).
 */
export async function loadDueCallbacks(client: SupabaseClient, orgId: string, leadIds: string[], now: Date): Promise<Map<string, number> | null> {
  const due = new Map<string, number>();
  for (const part of chunk(leadIds, SIGNAL_CHUNK_SIZE)) {
    const { data, error } = (await from(client, 'scheduled_activities')
      .select('lead_id, scheduled_at')
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .eq('channel', 'phone')
      .eq('kind', 'return')
      .in('lead_id', part)
      .lte('scheduled_at', now.toISOString())) as Rows<{ lead_id: string; scheduled_at: string }>;
    if (error || !data) return null;
    for (const r of data) {
      const at = Date.parse(r.scheduled_at);
      if (Number.isNaN(at)) continue;
      const prev = due.get(r.lead_id);
      if (prev === undefined || at < prev) due.set(r.lead_id, at);
    }
  }
  if (due.size === 0) return due;

  const earliest = new Date(Math.min(...due.values())).toISOString();
  for (const part of chunk([...due.keys()], SIGNAL_CHUNK_SIZE)) {
    const { data, error } = (await from(client, 'calls')
      .select('lead_id, created_at')
      .eq('org_id', orgId)
      .in('lead_id', part)
      .gte('created_at', earliest)) as Rows<{ lead_id: string; created_at: string }>;
    if (error || !data) return null;
    for (const c of data) {
      const scheduled = due.get(c.lead_id);
      if (scheduled !== undefined && Date.parse(c.created_at) >= scheduled) due.delete(c.lead_id);
    }
  }
  return due;
}

/**
 * Fora da escolha ANTES de discar (D1/D2): lead ganho (`won`) ou com motivo de perda "não retomar" nunca vai ao
 * portão, senão a RPC (que ainda os devolve) enche o topo da fila de recusas e o motor pausa. Mesma regra do portão
 * (`EXCLUDED_LEAD_STATUSES`, `isNoResumeReason`); na recuperação o status `unqualified` é o esperado, então só `won`
 * conta, e vale a lista maior de motivos. Lote em `SIGNAL_CHUNK_SIZE` + UMA leitura de `loss_reasons` da org
 * (só se algum lead tem motivo). Lead que não aparece na leitura segue (o portão confere de novo). `null` = erro de leitura.
 */
export async function loadUnavailableLeadIds(
  client: SupabaseClient,
  orgId: string,
  leadIds: string[],
  queue: AutoDialQueue | undefined,
  /** Leads com retorno vencido: `qualified` com retorno vencido segue elegível. */
  dueCallbackLeadIds: ReadonlySet<string> = new Set(),
): Promise<Set<string> | null> {
  const out = new Set<string>();
  if (leadIds.length === 0) return out;
  const recovery = queue === 'recovery';
  const parts = await Promise.all(
    chunk(leadIds, SIGNAL_CHUNK_SIZE).map(
      async (part) =>
        (await from(client, 'leads').select('id, status, loss_reason_id').eq('org_id', orgId).in('id', part)) as Rows<{
          id: string;
          status: string;
          loss_reason_id: string | null;
        }>,
    ),
  );
  if (parts.some((p) => p.error || !p.data)) return null;
  const leads = parts.flatMap((p) => p.data!);

  let reasonNames: Map<string, string> | null = null;
  if (leads.some((l) => l.loss_reason_id)) {
    const reasons = (await from(client, 'loss_reasons').select('id, name').eq('org_id', orgId)) as Rows<{ id: string; name: string | null }>;
    if (reasons.error || !reasons.data) return null;
    reasonNames = new Map(reasons.data.flatMap((r) => (r.name ? [[r.id, r.name] as [string, string]] : [])));
  }

  for (const l of leads) {
    const statusOut = recovery
      ? l.status === 'won'
      : EXCLUDED_LEAD_STATUSES.includes(l.status) || (l.status === QUALIFIED_LEAD_STATUS && !dueCallbackLeadIds.has(l.id));
    const name = l.loss_reason_id ? reasonNames?.get(l.loss_reason_id) : undefined;
    const reasonOut = Boolean(name) && (isNoResumeReason(name) || (recovery && RECOVERY_BLOCKED_REASON_NAMES.includes(name as string)));
    if (statusOut || reasonOut) out.add(l.id);
  }
  return out;
}

/**
 * Leads que ficam FORA da fila NORMAL por terem tido uma conversa sem ação final (ver `no-action-cooldown.ts`): a ÚLTIMA
 * conversa do lead nos últimos `NO_ACTION_COOLDOWN_DAYS` dias tem desfecho `answered_no_progress`/`relevant_conversation`
 * e o lead NÃO tem atividade pendente (retorno ou tarefa) agendada. Contado da ligação. Em blocos de `SIGNAL_CHUNK_SIZE`
 * ids (sem `.in()` gigante), em 3 passos pequenos: (1) ligações com esses desfechos na janela; (2) só uma ligação MAIS NOVA com
 * `callback_requested` ou `referred_contact` (ação) tira o lead da lista; ligação nova sem conversa/desfecho NÃO tira (uma conversa nova sem ação vira a "última"); (3) atividade pendente tira o lead (já tem ação).
 * `null` = falha de leitura (falha fechada).
 */
export async function loadNoActionLeadIds(client: SupabaseClient, orgId: string, leadIds: string[], now: Date): Promise<Set<string> | null> {
  const out = new Set<string>();
  if (leadIds.length === 0) return out;
  const cutoff = noActionCooldownCutoff(now).toISOString();

  const lastTalk = new Map<string, number>();
  for (const part of chunk(leadIds, SIGNAL_CHUNK_SIZE)) {
    const { data, error } = (await from(client, 'calls')
      .select('lead_id, created_at')
      .eq('org_id', orgId)
      .in('lead_id', part)
      .in('sdr_disposition', [...NO_ACTION_DISPOSITIONS])
      .gte('created_at', cutoff)) as Rows<{ lead_id: string; created_at: string }>;
    if (error || !data || data.length >= POSTGREST_MAX_ROWS) return null; // teto = possivelmente truncada: falha fechada
    for (const r of data) {
      const at = Date.parse(r.created_at);
      if (!Number.isNaN(at) && at > (lastTalk.get(r.lead_id) ?? Number.NEGATIVE_INFINITY)) lastTalk.set(r.lead_id, at);
    }
  }
  if (lastTalk.size === 0) return out;

  // Só uma ligação mais nova COM AÇÃO (pediu para ligar depois ou indicou outro contato) solta o lead. Ligação nova sem conversa e sem desfecho, ou com
  // no_answer/voicemail/technical_failure, NÃO solta (caso Lippaus: a própria discagem ligou de novo, 0 s, sem desfecho).
  // Uma conversa nova sem ação já é a "última conversa" do passo 1 (os 7 dias contam dela).
  const earliest = new Date(Math.min(...lastTalk.values())).toISOString();
  for (const part of chunk([...lastTalk.keys()], SIGNAL_CHUNK_SIZE)) {
    const { data, error } = (await from(client, 'calls')
      .select('lead_id, created_at, sdr_disposition')
      .eq('org_id', orgId)
      .in('sdr_disposition', [...ACTION_DISPOSITIONS]) // filtrado NO BANCO: só as ligações que têm ação
      .in('lead_id', part)
      .gte('created_at', earliest)) as Rows<{ lead_id: string; created_at: string; sdr_disposition: string | null }>;
    if (error || !data || data.length >= POSTGREST_MAX_ROWS) return null;
    const acted = new Set<string>();
    for (const r of data) {
      if (r.sdr_disposition && ACTION_DISPOSITIONS.includes(r.sdr_disposition) && Date.parse(r.created_at) > (lastTalk.get(r.lead_id) ?? Number.POSITIVE_INFINITY)) acted.add(r.lead_id);
    }
    for (const id of part) if (!acted.has(id)) out.add(id);
  }
  if (out.size === 0) return out;

  // Atividade pendente (retorno ou tarefa): o lead já tem ação, não duplica.
  for (const part of chunk([...out], SIGNAL_CHUNK_SIZE)) {
    const { data, error } = (await from(client, 'scheduled_activities')
      .select('lead_id')
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .in('lead_id', part)) as Rows<{ lead_id: string }>;
    if (error || !data || data.length >= POSTGREST_MAX_ROWS) return null;
    for (const r of data) out.delete(r.lead_id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Escolha do próximo lead
// ---------------------------------------------------------------------------

export type PickAutoDialResult =
  | { kind: 'picked'; leadId: string; tier: CockpitTier; result: PriorityResult; callback?: boolean }
  | { kind: 'waiting'; until: number }
  | { kind: 'empty' }
  | { kind: 'error' };

/**
 * Próximo lead elegível AGORA (FR-3, FR-4, FR-5, FR-9b, FR-10, FR-17). Chama a RPC do #641 com os overrides do
 * motor (teto 3, `cold_limit` 1000), aplica no TypeScript as regras de `auto-dial-rules.ts` (3/dia, 1 h,
 * bloqueios `total`+`prospeccao`, atendido hoje) e escolhe quente confirmado primeiro, senão o menor `cold_rank`.
 * `waiting` = todos os livres estão só esperando o intervalo de 1 h.
 */
export async function pickAutoDialLead(input: {
  viewer: CockpitViewer;
  now: Date;
  /** Fila: 'normal' (padrão, a do #641) ou 'recovery' (perdidos, perda mais recente primeiro). */
  queue?: AutoDialQueue;
  excludeLeadIds?: string[];
  simulatedAttempts?: SimulatedAttempts;
  rules?: AutoDialRules;
  client?: SupabaseClient;
}): Promise<PickAutoDialResult> {
  const { viewer, now } = input;
  const rules = input.rules ?? AUTO_DIAL_RULES;
  try {
    const client = input.client ?? createServiceRoleClient();
    // Fila de recuperação: a ordem vem do SQL (recovery_rank). O resto do portão é EXATAMENTE o da fila normal.
    const rows =
      input.queue === 'recovery'
        ? await fetchRecoveryCandidates(client, { viewer, now, excludeLeadIds: input.excludeLeadIds ?? [] })
        : await fetchCockpitCandidates(client, {
            viewer,
            now,
            excludeLeadIds: input.excludeLeadIds ?? [],
            overrides: AUTO_DIAL_RPC_OVERRIDES,
          });
    if (!rows) return { kind: 'error' };

    // Contagem e último contato: RPC (qualquer origem) + ligações simuladas desta sessão.
    const sim = input.simulatedAttempts ?? {};
    const stats = new Map<string, LeadDialStats>();
    for (const r of rows) {
      const simTimes = (sim[r.leadId] ?? []).map((t) => Date.parse(t)).filter((t) => !Number.isNaN(t));
      const realLast = r.lastCallAt ? Date.parse(r.lastCallAt) : null;
      const last = Math.max(...simTimes, ...(realLast !== null && !Number.isNaN(realLast) ? [realLast] : []), Number.NEGATIVE_INFINITY);
      stats.set(r.leadId, {
        callsToday: r.callsToday + simTimes.length,
        lastCallAt: Number.isFinite(last) ? last : null,
        conversationToday: false,
        holdTypes: [],
      });
    }

    // Retornos vencidos (FR-23): sobem ao topo e furam "conversa hoje" e o intervalo de 1 h.
    const callbacks = await loadDueCallbacks(client, viewer.orgId, rows.map((r) => r.leadId), now);
    if (!callbacks) return { kind: 'error' };
    for (const r of rows) {
      if (callbacks.has(r.leadId)) stats.set(r.leadId, { ...stats.get(r.leadId)!, callbackDue: true });
    }

    // 1) Filtro barato (tentativas e intervalo) antes de ler bloqueios e atendimentos.
    const cheap = rows.filter((r) => {
      const d = evaluateLeadEligibility(stats.get(r.leadId)!, now, rules);
      return d.allowed || d.code === 'gap';
    });
    // Ganho e "não retomar" saem AQUI (também o retorno vencido deles): nunca chegam a ser escolhidos (D1/D2).
    const unavailable = await loadUnavailableLeadIds(client, viewer.orgId, cheap.map((r) => r.leadId), input.queue, new Set(callbacks.keys()));
    if (!unavailable) return { kind: 'error' };
    // Conversa sem ação final fica fora da fila NORMAL por 7 dias (a recuperação só tem perdidos: não se aplica).
    if (input.queue !== 'recovery') {
      const noAction = await loadNoActionLeadIds(client, viewer.orgId, cheap.map((r) => r.leadId).filter((id) => !unavailable.has(id)), now);
      if (!noAction) return { kind: 'error' };
      for (const id of noAction) unavailable.add(id);
      // Retorno marcado para depois: o lead espera a hora (um retorno VENCIDO ainda não atendido continua valendo).
      const notDue = cheap.map((r) => r.leadId).filter((id) => !unavailable.has(id) && !callbacks.has(id));
      const future = await loadFutureReturnLeadIds(client, viewer.orgId, notDue, now);
      if (!future) return { kind: 'error' };
      for (const id of future) unavailable.add(id);
    }
    const live = cheap.filter((r) => !unavailable.has(r.leadId));
    const ids = live.map((r) => r.leadId);

    // 2) Bloqueios (total + prospeccao) e atendido hoje, em blocos de 100 ids. Erro = falha fechada (NFR-4).
    const since = new Date(brtStartOfDay(now)).toISOString();
    const parts = await Promise.all(
      chunk(ids, SIGNAL_CHUNK_SIZE).map(async (part) => {
        const [holds, answered] = await Promise.all([
          from(client, 'contact_holds')
            .select('lead_id, tipo')
            .eq('org_id', viewer.orgId)
            .in('tipo', [...rules.blockedHoldTypes])
            .in('lead_id', part) as unknown as Promise<Rows<{ lead_id: string; tipo: string }>>,
          from(client, 'calls')
            .select(`lead_id, ${CALL_DAY_COLUMNS}`)
            .eq('org_id', viewer.orgId)
            .in('lead_id', part)
            .gte('created_at', since) as unknown as Promise<Rows<CallDayRow & { lead_id: string }>>,
        ]);
        if (holds.error || answered.error || !holds.data || !answered.data) return null;
        return { holds: holds.data, answered: answered.data };
      }),
    );
    if (parts.some((p) => p === null)) return { kind: 'error' };
    const heldBy = holdTypesBy(parts.flatMap((p) => p!.holds));
    const conversed = new Set(parts.flatMap((p) => p!.answered.filter(isRealConversation).map((a) => a.lead_id)));
    for (const id of ids) {
      const s = stats.get(id)!;
      stats.set(id, { ...s, holdTypes: heldBy.get(id) ?? [], conversationToday: conversed.has(id) });
    }

    // 3) Quem passou e quem só espera o intervalo.
    const eligible = live.filter((r) => evaluateLeadEligibility(stats.get(r.leadId)!, now, rules).allowed);
    if (eligible.length === 0) {
      const until = nextReleaseAt(
        live.map((r) => stats.get(r.leadId)!),
        now,
        rules,
      );
      return until === null ? { kind: 'empty' } : { kind: 'waiting', until };
    }

    // 3b) Retorno vencido vai ao TOPO (o mais antigo primeiro), ainda respeitando bloqueio, dono e as 3 tentativas.
    const dueFirst = eligible
      .filter((r) => stats.get(r.leadId)!.callbackDue)
      .sort((a, b) => (callbacks.get(a.leadId) ?? 0) - (callbacks.get(b.leadId) ?? 0) || a.leadId.localeCompare(b.leadId))[0];
    if (dueFirst) {
      const own = (await loadSignalsInChunks(client, viewer.orgId, [dueFirst.leadId], now))?.get(dueFirst.leadId);
      if (!own) return { kind: 'error' };
      return { kind: 'picked', leadId: dueFirst.leadId, tier: 'hot', result: computeCallPriority(own, now), callback: true };
    }

    // 4) Quente confirmado primeiro; senão o menor cold_rank (mesma escolha do #641, FR-3).
    const hotRows = eligible.filter((r) => r.maybeHot);
    const signals = await loadSignalsInChunks(client, viewer.orgId, hotRows.map((r) => r.leadId), now);
    if (!signals) return { kind: 'error' };
    const hot = rankLeadsByPriority(
      hotRows.map((r) => ({ leadId: r.leadId, updatedAt: r.updatedAt, signals: signals.get(r.leadId) ?? [] })),
      now,
    );
    const cold = eligible.flatMap((r) => (r.coldRank == null ? [] : [{ leadId: r.leadId, coldRank: r.coldRank }]));
    const pick = pickCockpitLead({ hot, cold });
    if (!pick) return { kind: 'empty' };

    let result = hot.find((h) => h.leadId === pick.leadId)?.result;
    if (!result) {
      const own = signals.get(pick.leadId) ?? (await loadSignalsInChunks(client, viewer.orgId, [pick.leadId], now))?.get(pick.leadId);
      if (!own) return { kind: 'error' };
      result = computeCallPriority(own, now);
    }
    return { kind: 'picked', leadId: pick.leadId, tier: pick.tier, result };
  } catch (err) {
    console.error('[cockpit-auto-dial] pick:', err instanceof Error ? err.message : 'erro');
    return { kind: 'error' };
  }
}

// ---------------------------------------------------------------------------
// Portão da discagem
// ---------------------------------------------------------------------------

export type DialGateResult =
  | { ok: true; live: boolean; phone: string; attemptNo: number; leadId: string; contactId?: string }
  | { ok: false; code: AutoDialGateCode };

/**
 * Decide, NO SERVIDOR e a cada discagem, se pode ligar para o lead. Recusa na primeira trava, nesta ordem:
 * flags do motor → janela/feriado (FR-11) → teto do motor (FR-12) → dono do lead e telefone → bloqueios (FR-10)
 * → tentativas, intervalo e atendido hoje (FR-4/5/9b). Qualquer erro de leitura = `error` (não disca, NFR-4).
 * `live` sai das flags lidas aqui, NUNCA do navegador.
 */
export async function checkDialGate(input: {
  orgId: string;
  userId: string;
  leadId: string;
  now: Date;
  /** Fila do pedido. Na 'recovery' o lead PRECISA ser perdido (`unqualified` com `lost_at`); na 'normal', nunca. */
  queue?: AutoDialQueue;
  /** Ligar para o telefone do lead mesmo com contato no retorno (número do indicado recusado). */
  ignoreContact?: boolean;
  holidays?: ReadonlySet<string> | readonly string[];
  rules?: AutoDialRules;
  client?: SupabaseClient;
}): Promise<DialGateResult> {
  const { orgId, userId, leadId, now } = input;
  const rules = input.rules ?? AUTO_DIAL_RULES;
  const refuse = (code: AutoDialGateCode): DialGateResult => ({ ok: false, code });
  try {
    const scope = { orgId, userId };
    if (!(await isCockpitAutoDialEnabled(scope))) return refuse('flag_off');
    const live = await isCockpitAutoDialLive(scope);

    const client = input.client ?? createServiceRoleClient();
    // Leituras independentes em paralelo (antes eram uma atrás da outra); as recusas continuam avaliadas na MESMA ordem abaixo.
    const [holidays, motorCalls, recent, leadRes, holds, callStats, callbacks, target] = await Promise.all([
      input.holidays ?? loadMotorHolidays(client),
      countMotorCallsToday(client, orgId, userId, now),
      // Trava suave contra disparo duplo (duas abas, cliques rápidos): ligação recente ou do motor ainda sem término.
      loadRecentUserCalls(client, orgId, userId, now),
      from(client, 'leads')
        .select('id, assigned_to, closer_id, telefone, status, lost_at, loss_reason_id')
        .eq('id', leadId)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .maybeSingle() as PromiseLike<
        One<{
          id: string;
          assigned_to: string | null;
          closer_id: string | null;
          telefone: string | null;
          status: string;
          lost_at: string | null;
          loss_reason_id: string | null;
        }>
      >,
      from(client, 'contact_holds')
        .select('lead_id, tipo')
        .eq('org_id', orgId)
        .eq('lead_id', leadId)
        .in('tipo', [...rules.blockedHoldTypes]) as PromiseLike<Rows<{ lead_id: string; tipo: string }>>,
      loadLeadCallStats(client, orgId, leadId, now),
      loadDueCallbacks(client, orgId, [leadId], now),
      // Contato do retorno vencido; nunca recusa (falha = principal).
      input.ignoreContact ? null : loadCallbackTarget({ orgId, leadId, now, client }),
    ]);

    const window = isWithinDialWindow(now, holidays, rules);
    if (!window.allowed) return refuse(window.code);

    if (motorCalls === null) return refuse('error');
    if (isDailyCapReached(motorCalls, rules)) return refuse('daily_cap');

    if (!recent) return refuse('error');
    const spacing = evaluateDialSpacing(recent, now);
    if (!spacing.allowed) return refuse(spacing.code);

    if (leadRes.error) return refuse('error');
    const lead = leadRes.data;
    if (!lead) return refuse('lead_unavailable');
    // O motor só liga para a PRÓPRIA carteira (SDR dono ou closer do lead).
    if (lead.assigned_to !== userId && lead.closer_id !== userId) return refuse('not_owner');
    const recovery = input.queue === 'recovery';
    // Fila normal: perdido/arquivado nunca. Recuperação: SÓ perdido de verdade (unqualified com lost_at); reaberto ou arquivado, não.
    if (recovery ? lead.status !== 'unqualified' || !lead.lost_at : EXCLUDED_LEAD_STATUSES.includes(lead.status)) {
      return refuse('lead_unavailable');
    }
    // `contactId` só quando o número discado é o do contato do retorno.
    const contactPhone = target?.phone ?? null;
    const phone = contactPhone ?? lead.telefone?.trim();
    if (!phone) return refuse('no_phone');

    if (holds.error || !holds.data) return refuse('error');
    if (!callStats) return refuse('error');
    if (!callbacks) return refuse('error');

    // Fila normal: lead qualificado (reunião marcada) não entra, salvo retorno vencido; conversa sem ação final fica 7 dias fora.
    if (!recovery) {
      if (lead.status === QUALIFIED_LEAD_STATUS && !callbacks.has(leadId)) return refuse('lead_unavailable');
      // Retorno marcado para depois (sem um vencido em aberto): não liga antes da hora. Código próprio: o lead NÃO sai
      // da sessão, porque volta quando o retorno vencer.
      if (!callbacks.has(leadId)) {
        const future = await loadFutureReturnLeadIds(client, orgId, [leadId], now);
        if (!future) return refuse('error');
        if (future.has(leadId)) return refuse('return_scheduled');
      }
    }

    // Motivo de perda, nas DUAS filas (o navegador escolhe a fila e o lead; nada vale só porque veio da escolha):
    // "não retomar" (blocklist, spam, adolescente/criança) nunca liga (D2); na recuperação vale a lista maior (A-D5).
    let reasonName: string | null = null;
    if (lead.loss_reason_id) {
      const reason = (await from(client, 'loss_reasons')
        .select('name')
        .eq('id', lead.loss_reason_id)
        .eq('org_id', orgId)
        .maybeSingle()) as One<{ name: string | null }>;
      if (reason.error) return refuse('error');
      reasonName = reason.data?.name ?? null;
      if (reasonName && (isNoResumeReason(reasonName) || (recovery && RECOVERY_BLOCKED_REASON_NAMES.includes(reasonName)))) {
        return refuse('lead_unavailable');
      }
    }
    // Recuperação: "Sem interesse" em quarentena de 90 dias e retorno FUTURO agendado (salvo retorno vencido).
    if (recovery) {
      const held = await loadRecoveryHoldoutLeadIds(
        client,
        orgId,
        [{ leadId, lostAt: lead.lost_at as string, reasonName, returnDue: callbacks.has(leadId) }],
        now,
      );
      if (!held) return refuse('error');
      if (held.has(leadId)) return refuse('lead_unavailable');
    }
    // Recuperação: conversa real depois da perda (A-D4, salvo retorno vencido).
    if (recovery) {
      if (!callbacks.has(leadId)) {
        const since = (await from(client, 'calls')
          .select(CALL_DAY_COLUMNS)
          .eq('org_id', orgId)
          .eq('lead_id', leadId)
          .gte('created_at', lead.lost_at as string)) as Rows<CallDayRow>;
        if (since.error || !since.data) return refuse('error');
        if (since.data.some(isRealConversation)) return refuse('answered_today');
      }
    }

    const decision = evaluateLeadEligibility(
      { ...callStats, holdTypes: holds.data.map((h) => h.tipo), callbackDue: callbacks.has(leadId) },
      now,
      rules,
    );
    if (!decision.allowed) return refuse(decision.code);

    // Conversa sem ação final nos últimos 7 dias (depois das regras do dia, para "conversa hoje" seguir como `answered_today`).
    if (!recovery) {
      const noAction = await loadNoActionLeadIds(client, orgId, [leadId], now);
      if (!noAction) return refuse('error');
      if (noAction.has(leadId)) return refuse('lead_unavailable');
    }

    return {
      ok: true,
      live,
      phone,
      attemptNo: callStats.callsToday + 1,
      leadId,
      ...(contactPhone && target ? { contactId: target.contactId } : {}),
    };
  } catch (err) {
    console.error('[cockpit-auto-dial] gate:', err instanceof Error ? err.message : 'erro');
    return refuse('error');
  }
}
