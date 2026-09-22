/**
 * BDR-2 — Regras puras do consumo de eventos do V4 Call e da reserva de passos.
 *
 * O V4 Call entrega (pela outbox, via n8n) três eventos terminais por ligação:
 *   chamada_finalizada | caixa_postal | chamada_falhou
 * Todos trazem `event_id` (estável por call_sid+evento — deduplicar por ele),
 * `execution_id` (o que o n8n recebeu em claim_due_steps) e `resultado`.
 * Eventos não terminais (ex.: status intermediário) são registrados mas não
 * avançam o passo.
 */
import { isUuid } from '@/lib/utils/uuid';

export const TERMINAL_EVENTS = ['chamada_finalizada', 'caixa_postal', 'chamada_falhou'] as const;
export type TerminalEvent = (typeof TERMINAL_EVENTS)[number];

export function isTerminalEvent(evento: unknown): evento is TerminalEvent {
  return typeof evento === 'string' && (TERMINAL_EVENTS as readonly string[]).includes(evento);
}

export interface ExternalStepEvent {
  eventId: string;
  executionId: string;
  evento: string;
  callSid: string | null;
  resultado: Record<string, unknown>;
  performedBy: string | null;
  /** Payload inteiro, guardado em external_step_events.payload (auditoria/conciliação). */
  payload: Record<string, unknown>;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Aceita o payload do V4 Call como ele sai da outbox (snake_case) e também as
 * variantes camelCase, caso o n8n remonte o corpo. `execution_id` pode vir no
 * topo ou dentro de `metadata_entrada` (o V4 Call ecoa o metadata do dispatch).
 */
export function parseExternalStepEvent(body: unknown): ParseResult<ExternalStepEvent> {
  const b = asRecord(body);
  const meta = asRecord(b.metadata_entrada);

  const eventId = str(b.event_id) ?? str(b.eventId);
  if (!eventId || !isUuid(eventId)) return { ok: false, error: 'event_id obrigatório (uuid)' };

  const executionId = str(b.execution_id) ?? str(b.executionId) ?? str(meta.execution_id) ?? str(meta.executionId);
  if (!executionId || !isUuid(executionId)) return { ok: false, error: 'execution_id obrigatório (uuid)' };

  const evento = str(b.evento) ?? str(b.event);
  if (!evento) return { ok: false, error: 'evento obrigatório' };

  const performedBy = str(b.performed_by) ?? str(b.performedBy);
  if (performedBy && !isUuid(performedBy)) return { ok: false, error: 'performed_by inválido (uuid)' };

  return {
    ok: true,
    value: {
      eventId,
      executionId,
      evento,
      callSid: str(b.call_sid) ?? str(b.callSid),
      resultado: asRecord(b.resultado),
      performedBy,
      payload: b,
    },
  };
}

export interface ClaimRequest {
  cadenceIds: string[];
  channel: string;
  limit: number;
  leaseMinutes: number;
  owner: string | null;
}

const CHANNELS = new Set(['phone', 'whatsapp', 'email', 'linkedin', 'research']);

export function parseClaimRequest(body: unknown): ParseResult<ClaimRequest> {
  const b = asRecord(body);
  const cadenceIds = Array.isArray(b.cadence_ids) ? (b.cadence_ids as unknown[]).filter(isUuid) : [];
  if (!cadenceIds.length) return { ok: false, error: 'cadence_ids obrigatório (uuid[])' };

  const channel = str(b.channel) ?? 'phone';
  if (!CHANNELS.has(channel)) return { ok: false, error: `channel inválido: ${channel}` };

  const limit = clampInt(b.limit, 10, 1, 100);
  const leaseMinutes = clampInt(b.lease_minutes ?? b.leaseMinutes, 15, 1, 240);
  const owner = str(b.owner)?.slice(0, 120) ?? null;

  return { ok: true, value: { cadenceIds, channel, limit, leaseMinutes, owner } };
}

export function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Resultado da RPC confirm_external_step. */
export interface ConfirmResult {
  aplicado: boolean;
  duplicado: boolean;
  motivo: string;
  enrollment_id: string | null;
  lead_id: string | null;
  cadence_id: string | null;
  step_id: string | null;
  interaction_id: string | null;
  advanced: boolean;
  completed: boolean;
  new_step: number | null;
}

/**
 * Código HTTP para a resposta do webhook. Só `execution_id_desconhecida` é 404
 * (o n8n precisa saber que confirmou algo que o Enriquece não reservou);
 * duplicados e eventos tardios são 200 — repetir a chamada não muda nada.
 */
export function httpStatusFor(result: ConfirmResult): number {
  return result.motivo === 'execution_id_desconhecida' ? 404 : 200;
}
