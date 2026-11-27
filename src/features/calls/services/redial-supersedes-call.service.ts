import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { extractAmd, extractAutoHangup, getAnsweredVerdict } from '@/features/cockpit/utils/answered-verdict';
import { NON_CONVERSATION_DISPOSITIONS, isRealConversation } from '@/features/cockpit/utils/real-conversation';

/** Mesma chave de `AUTO_DIAL_METADATA_KEY` (marcador do motor do Cockpit em `calls.metadata`). */
const MOTOR_KEY = 'cockpit_auto_dial';
/** Sem término e mais nova que isto = ainda em andamento (mesmo teto da trava `too_soon` do motor). */
const ONGOING_MAX_AGE_MS = 20 * 60_000;

interface LeadCallRow {
  id: string;
  created_at: string;
  answered_at: string | null;
  hangup_cause: string | null;
  duration_seconds: number | null;
  status: string | null;
  sdr_disposition: string | null;
  metadata: Record<string, unknown> | null;
}

function redialOf(call: LeadCallRow): string | null {
  const marker = call.metadata?.[MOTOR_KEY] as { redial_of?: unknown } | undefined;
  return typeof marker?.redial_of === 'string' ? marker.redial_of : null;
}

/** A religação foi atendida pelo lead, virou conversa ou ainda está no ar? Não atendida e caixa postal = não. */
function tookOver(call: LeadCallRow, now: Date): boolean {
  if (isRealConversation(call)) return true;
  if (call.sdr_disposition && NON_CONVERSATION_DISPOSITIONS.has(call.sdr_disposition)) return false;
  if (extractAutoHangup(call.metadata)) return false;
  const amd = extractAmd(call.metadata);
  const verdict = getAnsweredVerdict({
    answeredAt: call.answered_at,
    durationSeconds: call.duration_seconds,
    amdPrediction: amd?.prediction ?? null,
    amdConfidence: amd?.confidence ?? null,
  });
  if (verdict.reason === 'machine') return false;
  if (call.answered_at) return true;
  return !call.hangup_cause && now.getTime() - Date.parse(call.created_at) < ONGOING_MAX_AGE_MS;
}

/**
 * "Ligar de novo": esta ligação caiu e uma religação dela (direta ou em cadeia, A<-B<-C) assumiu a conversa? Aí quem
 * decide o próximo passo é a ligação nova, e a IA não agenda retorno pela antiga. SOMENTE LEITURA, filtra `org_id`.
 * `null` = falha de leitura (quem chama não pode criar nem cancelar nada).
 */
export async function wasSupersededByRedial(
  supabase: SupabaseClient,
  call: { id: string; org_id: string; lead_id: string; created_at: string },
  now: Date,
): Promise<boolean | null> {
  const { data, error } = (await from(supabase, 'calls')
    .select('id, created_at, answered_at, hangup_cause, duration_seconds, status, sdr_disposition, metadata')
    .eq('org_id', call.org_id)
    .eq('lead_id', call.lead_id)
    .gte('created_at', call.created_at)) as { data: LeadCallRow[] | null; error: { message: string } | null };
  if (error || !data) {
    console.error('[ai-outcome] religações:', error?.message ?? 'sem dados', 'callId=', call.id);
    return null;
  }

  const chain = new Set([call.id]);
  const redials = data.filter((c) => redialOf(c) !== null).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  for (const c of redials) {
    if (!chain.has(redialOf(c)!)) continue;
    chain.add(c.id);
    if (tookOver(c, now)) return true;
  }
  return false;
}
