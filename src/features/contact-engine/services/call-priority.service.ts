import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { readAiOutcome } from '@/features/calls/ai-outcome';

import {
  CALL_PRIORITY_FLAG_KEY,
  CALL_PRIORITY_MODEL_VERSION,
  INTEREST_MAX,
  type PriorityResult,
  type PrioritySignal,
  type PrioritySource,
} from './call-priority';
import { isScopedFlagEnabled, type FlagScope } from './flag-scope.service';

/**
 * Score de prioridade v2 (PR11): leitura de sinais, flag e trilha `decision_events`.
 *
 * Flag `call_priority_v2` (app_flags, GLOBAL, nasce desligada). E flag de efeito:
 * erro de leitura vale DESLIGADA. Desligada, nada daqui le sinal nem escreve evento
 * e o cockpit usa a ordenacao e a abordagem de antes.
 *
 * Isolamento por organizacao: o cliente de service role ignora RLS, entao TODA
 * consulta e escrita aqui filtra `org_id` explicitamente.
 *
 * Escrita em `decision_events` e idempotente (indice unico org_id + chave). Payload
 * so com chaves permitidas e valores primitivos curtos: sem PII, sem transcricao.
 * Logs: somente ids e motivos.
 */

const SIGNAL_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;
const BANT_CORE_FIELDS = ['B (Budget)', 'A (Autoridade)', 'N (Necessidade)', 'T (Timing)'];
const SEND_AND_REPLY_TYPES = ['replied', 'meeting_scheduled', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'];
const UNIQUE_VIOLATION = '23505';
const PAYLOAD_ALLOWED_KEYS = [
  'score',
  'interest',
  'effort',
  'primary_source',
  'v1_pick_same',
  'call_id',
  'disposition',
  'confidence',
  'previous_interest',
  'interest_set',
  'reason_codes',
] as const;
const PAYLOAD_MAX_STRING = 120;

type Rows<T> = { data: T[] | null; error: { message: string; code?: string } | null };

// ---------------------------------------------------------------------------
// Flag
// ---------------------------------------------------------------------------

export async function isCallPriorityV2Enabled(scope?: FlagScope): Promise<boolean> {
  return isScopedFlagEnabled(CALL_PRIORITY_FLAG_KEY, scope);
}

// ---------------------------------------------------------------------------
// Carga de sinais (somente leitura, sempre dentro da organizacao)
// ---------------------------------------------------------------------------

interface InteractionRow {
  id: string;
  lead_id: string;
  channel: string;
  type: string;
  created_at: string;
}
interface CallRow {
  id: string;
  lead_id: string | null;
  started_at: string | null;
  created_at: string;
  sdr_disposition: string | null;
  metadata: unknown;
}
interface LeadBantRow {
  id: string;
  updated_at: string;
  custom_field_values: Record<string, unknown> | null;
}
interface CorrectionRow {
  lead_id: string;
  idempotency_key: string;
  actor_user_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

function isFilled(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value != null && value !== '';
}

/**
 * Sinais por lead. `null` quando QUALQUER leitura falha: o chamador volta para a
 * ordenacao de antes em vez de decidir com dados parciais.
 */
export async function loadPrioritySignals(
  client: SupabaseClient,
  orgId: string,
  leadIds: string[],
  now: Date,
): Promise<Map<string, PrioritySignal[]> | null> {
  const out = new Map<string, PrioritySignal[]>(leadIds.map((id) => [id, []]));
  if (leadIds.length === 0) return out;
  const since = new Date(now.getTime() - SIGNAL_WINDOW_DAYS * DAY_MS).toISOString();
  const push = (leadId: string | null, signal: PrioritySignal) => {
    if (leadId && out.has(leadId)) out.get(leadId)?.push(signal);
  };

  const [interactions, calls, leads, fields, corrections] = await Promise.all([
    from(client, 'interactions')
      .select('id, lead_id, channel, type, created_at')
      .eq('org_id', orgId)
      .in('lead_id', leadIds)
      .in('type', SEND_AND_REPLY_TYPES)
      .gte('created_at', since) as unknown as Promise<Rows<InteractionRow>>,
    from(client, 'calls')
      .select('id, lead_id, started_at, created_at, sdr_disposition, metadata')
      .eq('org_id', orgId)
      .in('lead_id', leadIds)
      .gte('created_at', since) as unknown as Promise<Rows<CallRow>>,
    from(client, 'leads')
      .select('id, updated_at, custom_field_values')
      .eq('org_id', orgId)
      .in('id', leadIds) as unknown as Promise<Rows<LeadBantRow>>,
    from(client, 'custom_fields')
      .select('id, field_name')
      .eq('org_id', orgId)
      .in('field_name', BANT_CORE_FIELDS) as unknown as Promise<Rows<{ id: string; field_name: string }>>,
    from(client, 'decision_events')
      .select('lead_id, idempotency_key, actor_user_id, payload, created_at')
      .eq('org_id', orgId)
      .in('lead_id', leadIds)
      .eq('event_type', 'human_correction') as unknown as Promise<Rows<CorrectionRow>>,
  ]);

  for (const [name, r] of [
    ['interactions', interactions],
    ['calls', calls],
    ['leads', leads],
    ['custom_fields', fields],
    ['decision_events', corrections],
  ] as const) {
    if (r.error) {
      console.error(`[call-priority] ${name}:`, r.error.message);
      return null;
    }
  }

  for (const i of interactions.data ?? []) {
    const key = `interaction:${i.id}`;
    if (i.type === 'replied') push(i.lead_id, { kind: 'reply', key, at: i.created_at, channel: i.channel });
    else if (i.type === 'meeting_scheduled') push(i.lead_id, { kind: 'meeting_scheduled', key, at: i.created_at });
    else push(i.lead_id, { kind: 'send', key, at: i.created_at, channel: i.channel, type: i.type });
  }

  for (const c of calls.data ?? []) {
    const at = c.started_at ?? c.created_at;
    const ai = readAiOutcome(c.metadata);
    const aiDone = ai?.status === 'done' && ai.disposition ? ai : null;
    // `applyAiCallOutcome` grava a disposicao da IA em `sdr_disposition` quando o SDR nao marcou nada.
    // Igual a da IA e aplicada = atribuida a IA (sujeita a confianca); so a divergente e do SDR.
    const sdrIsFromAi = aiDone != null && aiDone.applied !== false && c.sdr_disposition === aiDone.disposition;
    if (c.sdr_disposition && !sdrIsFromAi) {
      push(c.lead_id, { kind: 'call_outcome', key: `call:${c.id}:sdr`, callId: c.id, at, by: 'sdr', disposition: c.sdr_disposition });
    }
    if (aiDone) {
      push(c.lead_id, {
        kind: 'call_outcome',
        key: `call:${c.id}:ai`,
        callId: c.id,
        at: aiDone.classified_at ?? at,
        by: 'ai',
        disposition: aiDone.disposition as string,
        confidence: aiDone.confidence ?? null,
        needsReview: aiDone.needs_review === true,
      });
    }
  }

  const fieldIds = new Set((fields.data ?? []).map((f) => f.id));
  for (const l of leads.data ?? []) {
    const values = l.custom_field_values ?? {};
    const filled = Object.entries(values).filter(([id, v]) => fieldIds.has(id) && isFilled(v)).length;
    if (filled > 0) push(l.id, { kind: 'bant', key: `bant:${l.id}`, at: l.updated_at, filledFields: filled });
  }

  for (const e of corrections.data ?? []) {
    const interest = e.payload?.interest_set;
    if (typeof interest !== 'number' || !e.actor_user_id) continue;
    push(e.lead_id, {
      kind: 'human_correction',
      key: e.idempotency_key,
      at: e.created_at,
      actorUserId: e.actor_user_id,
      interest,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Trilha decision_events (append-only, idempotente)
// ---------------------------------------------------------------------------

export type DecisionEventType = 'signal_observed' | 'priority_suggestion' | 'human_correction';
export type DecisionEventSource = PrioritySource | 'system';
export type PayloadValue = string | number | boolean | null | string[];

/** Mantem so chaves permitidas com valores primitivos curtos. Nada de PII ou texto livre. */
export function sanitizePayload(payload: Record<string, unknown>): Record<string, PayloadValue> {
  const out: Record<string, PayloadValue> = {};
  for (const key of PAYLOAD_ALLOWED_KEYS) {
    const v = payload[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string') out[key] = v.slice(0, PAYLOAD_MAX_STRING);
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[key] = (v as string[]).slice(0, 10).map((x) => x.slice(0, PAYLOAD_MAX_STRING));
  }
  return out;
}

export interface DecisionEventInput {
  orgId: string;
  leadId: string;
  eventType: DecisionEventType;
  source: DecisionEventSource;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  actorUserId?: string | null;
  modelVersion?: string;
}

export type RecordEventResult = 'recorded' | 'duplicate' | 'error';

export async function recordDecisionEvent(client: SupabaseClient, input: DecisionEventInput): Promise<RecordEventResult> {
  const { error } = (await from(client, 'decision_events').insert({
    org_id: input.orgId,
    lead_id: input.leadId,
    event_type: input.eventType,
    model_version: input.modelVersion ?? CALL_PRIORITY_MODEL_VERSION,
    source: input.source,
    idempotency_key: input.idempotencyKey,
    payload: sanitizePayload(input.payload),
    actor_user_id: input.actorUserId ?? null,
  } as Record<string, unknown>)) as { error: { message: string; code?: string } | null };
  if (!error) return 'recorded';
  if (error.code === UNIQUE_VIOLATION) return 'duplicate';
  console.error(`[call-priority] decision_events lead=${input.leadId}:`, error.message);
  return 'error';
}

/** Sugestao emitida. Melhor esforco: falha de escrita nunca muda a decisao exibida. */
export async function recordPrioritySuggestion(
  client: SupabaseClient,
  input: { orgId: string; leadId: string; result: PriorityResult; v1PickSame: boolean; dayKey: string },
): Promise<RecordEventResult> {
  const { result } = input;
  return recordDecisionEvent(client, {
    orgId: input.orgId,
    leadId: input.leadId,
    eventType: 'priority_suggestion',
    source: result.primarySource ?? 'system',
    // Mesmo lead, versao, dia e score = mesma sugestao: recarregar a tela nao duplica.
    idempotencyKey: `suggest:${input.leadId}:${result.version}:${input.dayKey}:${result.score}`,
    payload: {
      score: result.score,
      interest: result.interest,
      effort: result.effort,
      primary_source: result.primarySource ?? 'none',
      v1_pick_same: input.v1PickSame,
      reason_codes: result.reasons.map((r) => r.code),
    },
  });
}

// ---------------------------------------------------------------------------
// Correcao humana
// ---------------------------------------------------------------------------

export interface CorrectionActor {
  orgId: string;
  userId: string;
  isManager: boolean;
}

export type CorrectionResult =
  | { status: 'recorded' | 'duplicate'; interest: number }
  | { status: 'disabled' | 'not_found' | 'invalid' | 'error' };

/**
 * Registra a correcao de interesse feita por uma pessoa (0 a 100). Vale a partir
 * da proxima leitura e substitui o interesse calculado; a trilha anterior fica.
 * Gestor corrige qualquer lead da organizacao; SDR e closer so da propria carteira.
 * Lead de outra organizacao responde `not_found`, igual a inexistente.
 * `requestId` torna a chamada idempotente (duplo clique, replay).
 */
export async function recordHumanCorrection(input: {
  actor: CorrectionActor;
  leadId: string;
  interest: number;
  requestId: string;
  client?: SupabaseClient;
}): Promise<CorrectionResult> {
  const { actor, leadId, requestId } = input;
  if (!Number.isFinite(input.interest) || input.interest < 0 || input.interest > INTEREST_MAX || !requestId.trim() || requestId.length > 100) {
    return { status: 'invalid' };
  }
  if (!(await isCallPriorityV2Enabled({ orgId: actor.orgId, userId: actor.userId }))) return { status: 'disabled' };

  const client = input.client ?? createServiceRoleClient();
  const lead = (await from(client, 'leads')
    .select('id, assigned_to, closer_id')
    .eq('id', leadId)
    .eq('org_id', actor.orgId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: { id: string; assigned_to: string | null; closer_id: string | null } | null; error: unknown };
  if (lead.error) return { status: 'error' };
  const row = lead.data;
  if (!row) return { status: 'not_found' };
  if (!actor.isManager && row.assigned_to !== actor.userId && row.closer_id !== actor.userId) return { status: 'not_found' };

  const interest = Math.round(input.interest);
  const status = await recordDecisionEvent(client, {
    orgId: actor.orgId,
    leadId,
    eventType: 'human_correction',
    source: 'human',
    idempotencyKey: `correction:${leadId}:${requestId}`,
    payload: { interest_set: interest },
    actorUserId: actor.userId,
  });
  if (status === 'error') return { status: 'error' };
  return { status, interest };
}
