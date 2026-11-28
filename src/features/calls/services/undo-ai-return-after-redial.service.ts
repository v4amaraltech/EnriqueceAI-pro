import type { SupabaseClient } from '@supabase/supabase-js';

import { CONVERSATION_DISPOSITIONS } from '@/features/cockpit/utils/real-conversation';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';
import { from } from '@/lib/supabase/from';

import { readAiOutcome } from '../ai-outcome';

/** Mesma chave de `AUTO_DIAL_METADATA_KEY` (marcador do motor do Cockpit em `calls.metadata`). */
const MOTOR_KEY = 'cockpit_auto_dial';
/** Teto da cadeia A<-B<-C... (também corta ciclo em dado ruim). */
const MAX_CHAIN = 10;

interface OriginCall {
  id: string;
  created_at: string;
  sdr_disposition: string | null;
  metadata: Record<string, unknown> | null;
}

export interface UndoAiReturnInput {
  orgId: string;
  userId: string;
  /** A religação que acabou de receber o desfecho do SDR. */
  call: { id: string; lead_id: string | null; metadata: Record<string, unknown> | null };
  disposition: string;
}

type Result<T> = { data: T | null; error: { message: string } | null };

function redialOf(metadata: Record<string, unknown> | null): string | null {
  const marker = metadata?.[MOTOR_KEY] as { redial_of?: unknown } | undefined;
  return typeof marker?.redial_of === 'string' ? marker.redial_of : null;
}

function check<T>(r: Result<T>, step: string): T | null {
  if (r.error) throw new Error(`${step}: ${r.error.message}`);
  return r.data;
}

/** Ligações anteriores da cadeia, da mais próxima para a mais antiga. */
async function loadOrigins(
  supabase: SupabaseClient,
  orgId: string,
  leadId: string,
  input: UndoAiReturnInput,
): Promise<OriginCall[]> {
  const origins: OriginCall[] = [];
  const seen = new Set([input.call.id]);
  let next = redialOf(input.call.metadata);
  while (next && !seen.has(next) && origins.length < MAX_CHAIN) {
    seen.add(next);
    const call: OriginCall | null = check(
      (await from(supabase, 'calls')
        .select('id, created_at, sdr_disposition, metadata')
        .eq('id', next)
        .eq('org_id', orgId)
        .eq('lead_id', leadId)
        .maybeSingle()) as Result<OriginCall>,
      'ligação de origem',
    );
    if (!call) break;
    origins.push(call);
    next = redialOf(call.metadata);
  }
  return origins;
}

/** O retorno foi CRIADO pela IA por uma ligação desta cadeia? (e não só mantido por ela, nem marcado pelo SDR) */
async function createdByAiInChain(
  supabase: SupabaseClient,
  orgId: string,
  leadId: string,
  activityId: string,
  chain: ReadonlySet<string>,
): Promise<boolean> {
  // 1. Só o retorno que a IA cria gera este evento na timeline.
  const events = check(
    (await from(supabase, 'interactions')
      .select('id')
      .eq('org_id', orgId)
      .eq('lead_id', leadId)
      .eq('metadata->>scheduled_activity_id', activityId)
      .eq('metadata->>scheduled_by', 'ai_call_outcome')
      .limit(1)) as Result<Array<{ id: string }>>,
    'evento do retorno',
  );
  if (!events?.length) return false;
  // 2. Ligação de fora da cadeia apontando para ele = pode ser o retorno dela, que a IA desta cadeia só manteve.
  const refs = check(
    (await from(supabase, 'calls')
      .select('id')
      .eq('org_id', orgId)
      .eq('lead_id', leadId)
      .eq('metadata->ai_outcome->>scheduled_activity_id', activityId)) as Result<
      Array<{ id: string }>
    >,
    'ligações do retorno',
  );
  return Boolean(refs) && refs!.every((r) => chain.has(r.id));
}

async function undo(supabase: SupabaseClient, input: UndoAiReturnInput): Promise<void> {
  const { orgId, userId, call, disposition } = input;
  const leadId = call.lead_id;
  if (!leadId || !redialOf(call.metadata) || !CONVERSATION_DISPOSITIONS.has(disposition)) return;

  const origins = await loadOrigins(supabase, orgId, leadId, input);
  const chain = new Set([call.id, ...origins.map((o) => o.id)]);

  for (const origin of origins) {
    const ai = readAiOutcome(origin.metadata);
    const activityId = ai?.scheduled_activity_id;
    if (ai?.status !== 'done' || !activityId) continue;
    // O SDR marcou a ligação de origem por conta própria: respeita. Não conta o que a própria IA gravou, nem o mesmo
    // desfecho da religação (o painel, durante a religação, grava o mesmo valor nas duas).
    if (
      origin.sdr_disposition &&
      origin.sdr_disposition !== ai.disposition &&
      origin.sdr_disposition !== disposition
    )
      continue;

    const activity = check(
      (await from(supabase, 'scheduled_activities' as never)
        .select('id, created_at, scheduled_at')
        .eq('id', activityId)
        .eq('org_id', orgId)
        .eq('lead_id', leadId)
        .eq('status', 'pending')
        .eq('channel', 'phone')
        .eq('kind', 'return')
        .maybeSingle()) as Result<{ id: string; created_at: string; scheduled_at: string }>,
      'retorno',
    );
    // Nascido antes da ligação de origem = já existia; a IA só o manteve.
    if (!activity || !(Date.parse(activity.created_at) >= Date.parse(origin.created_at))) continue;
    if (!(await createdByAiInChain(supabase, orgId, leadId, activityId, chain))) continue;

    const cancelled = check(
      (await from(supabase, 'scheduled_activities' as never)
        .update({ status: 'cancelled' } as Record<string, unknown>)
        .eq('id', activityId)
        .eq('org_id', orgId)
        .eq('lead_id', leadId)
        .eq('status', 'pending')
        .select('id')) as Result<Array<{ id: string }>>,
      'cancelar retorno',
    );
    if (!cancelled?.length) continue;

    const when = new Date(activity.scheduled_at).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    });
    await logLeadEvent(supabase, {
      orgId,
      leadId,
      userId,
      event: 'scheduled_activity_cancelled',
      message: `Retorno da IA de ${when} desfeito: a religação teve conversa`,
      metadata: {
        scheduled_activity_id: activityId,
        scheduled_at: activity.scheduled_at,
        call_id: call.id,
        origin_call_id: origin.id,
      },
    });
  }
}

/**
 * "Ligar de novo": a religação teve conversa → desfaz o retorno que a IA criou por uma ligação anterior da cadeia
 * (ela classifica a que caiu antes de a nova existir). Não restaura cadência pausada nem retornos anteriores.
 * NUNCA lança: o desfecho do SDR já está gravado e não depende disto.
 */
export async function undoAiReturnAfterRedial(
  supabase: SupabaseClient,
  input: UndoAiReturnInput,
): Promise<void> {
  try {
    await undo(supabase, input);
  } catch (err) {
    console.error(
      '[redial-undo-ai-return]',
      err instanceof Error ? err.message : 'erro',
      'callId=',
      input.call.id,
    );
  }
}
