/**
 * Orquestração da originação API4COM (`POST /calls`) com `callRef`.
 *
 * A linha em `calls` nasce ANTES do POST, com `id` = callRef, e o mesmo valor
 * vai em `metadata.callRef`. Motivo: o POST só responde depois que o webphone
 * atende (até 90 s) e o `channel-answer` / `channel-hangup` pode chegar antes da
 * resposta; com a linha já gravada o webhook casa pelo callRef, sem cair na
 * janela de ramal + telefone. No timeout a linha fica, e o reconcile e a busca
 * de gravação também casam pelo callRef.
 *
 * - Sucesso: merge de `api4com_call_id` no metadata relido (não apaga o que o
 *   webhook escreveu; status, duração e horários não são tocados).
 * - 424 (perna do ramal falhou): nenhuma chamada nasce, a linha é apagada.
 * - Outro erro (timeout, rede, 401, 404, 429, 503...): a ligação pode ter
 *   nascido, a linha fica com callRef e sem `api4com_call_id`.
 *
 * Dependências injetadas para testar sem rede e sem banco.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { from } from '@/lib/supabase/from';
import type { Database } from '@/lib/supabase/types';
import { normalizePhone } from '@/lib/utils/phone';

import {
  CALL_REF_KEY,
  GATEWAY_KEY,
  buildOriginateMetadata,
  linkProviderIdToMetadata,
} from '@/features/integrations/services/api4com-call-ref';
import { maskCalledForLog } from '@/features/integrations/services/api4com-log-mask';
import type { Api4ComCredentials } from '@/features/integrations/services/api4com.service';
import type { Api4ComOriginateResponse } from '@/features/integrations/types/api4com';

export interface OriginateApi4ComInput {
  phone: string;
  leadId?: string;
  contactId?: string | null;
  extraMetadata?: Record<string, string>;
}

export interface OriginateApi4ComResult {
  callId: string;
  api4comId: string;
}

export interface OriginateApi4ComDeps {
  supabase: SupabaseClient<Database>;
  orgId: string;
  userId: string;
  getCredentials: (userId: string) => Promise<Api4ComCredentials | null>;
  originate: (
    userId: string,
    phone: string,
    metadata: Record<string, string>,
    credentials: Api4ComCredentials,
  ) => Promise<{ data: Api4ComOriginateResponse; ramal: string }>;
  randomUUID: () => string;
  isRamalLegFailure: (message: string) => boolean;
  describeOriginateError: (message: string) => string;
}

type QueryError = { message: string } | null;

export async function originateApi4ComCallWithRef(
  deps: OriginateApi4ComDeps,
  input: OriginateApi4ComInput,
): Promise<ActionResult<OriginateApi4ComResult>> {
  const { supabase, orgId, userId } = deps;
  const gateway = `flux-${orgId}`;

  // Strip the phone before persisting so the recovery cron + recording lookup
  // can match against API4COM's record list (which always returns digit-only
  // numbers). Saving formatted strings like "31 9621-1619" here was the cause
  // of 514 unmatched recordings on V4 Amaral.
  const normalizedPhone = normalizePhone(input.phone);

  // O ramal (origin da linha) vem da credencial local; não consulta a API4COM.
  let credentials: Api4ComCredentials | null;
  try {
    credentials = await deps.getCredentials(userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao iniciar chamada';
    console.error('[api4com] getUserCredentials failed:', message);
    return { success: false, error: deps.describeOriginateError(message) };
  }
  if (!credentials) {
    return { success: false, error: 'API4COM não configurada para este usuário' };
  }

  const callRef = deps.randomUUID();
  const originateMetadata = buildOriginateMetadata({ gateway, callRef, extra: input.extraMetadata });

  // 1) Linha local primeiro. Sem ela persistida, não disca.
  const { error: insertError } = (await from(supabase, 'calls')
    .insert({
      id: callRef,
      org_id: orgId,
      user_id: userId,
      lead_id: input.leadId ?? null,
      contact_id: input.contactId ?? null,
      origin: credentials.ramal,
      destination: normalizedPhone,
      duration_seconds: 0,
      status: 'not_connected',
      type: 'outbound',
      metadata: { [GATEWAY_KEY]: gateway, [CALL_REF_KEY]: callRef },
    })
    .select('id')
    .single()) as { data: { id: string } | null; error: QueryError };

  const qErr = handleQueryError(insertError, 'Erro ao registrar chamada', 'api4com');
  if (qErr) return qErr;

  // 2) POST /calls com o callRef no metadata.
  let api4comId: string;
  let ramal: string;
  try {
    const result = await deps.originate(userId, input.phone, originateMetadata, credentials);
    api4comId = result.data.id;
    ramal = result.ramal;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao iniciar chamada';
    // O erro cru da API4COM traz o número ("call from 1001 to +55..."): mascara no log.
    console.error(
      '[api4com] originateCall failed:',
      message.replace(/\+?\d[\d\s()-]{7,}\d/g, (m) => maskCalledForLog(m)),
      { callId: callRef },
    );

    if (deps.isRamalLegFailure(message)) {
      // 424: nenhuma chamada nasceu. Apaga a linha para não deixar órfã na lista/timeline.
      const { error: deleteError } = (await from(supabase, 'calls')
        .delete()
        .eq('id', callRef)) as { error: QueryError };
      if (deleteError) {
        console.error('[api4com] Failed to delete call row after 424:', deleteError.message, { callId: callRef });
      }
      return { success: false, error: deps.describeOriginateError(message), code: 'ramal_busy' };
    }

    // Falha incerta: a ligação pode ter nascido. A linha fica (webhook e
    // reconcile casam pelo callRef) e a interaction também é registrada.
    // ActionResult de erro não carrega dados, então o callId não volta para a UI.
    await logLeadInteraction(supabase, { orgId, userId, input, normalizedPhone, callId: callRef, api4comId: null, ramal: credentials.ramal });
    return { success: false, error: deps.describeOriginateError(message) };
  }

  // 3) Sucesso: merge do id do provedor no metadata relido. O webhook pode ter
  //    escrito webhook_linked, alt ids, status e duração nesse meio tempo.
  //    Falha aqui não derruba a ligação: a linha e o callRef existem.
  try {
    const { data: current, error: readError } = (await from(supabase, 'calls')
      .select('metadata')
      .eq('id', callRef)
      .maybeSingle()) as { data: { metadata: Record<string, unknown> | null } | null; error: QueryError };
    if (readError) throw new Error(readError.message);

    const base = { [GATEWAY_KEY]: gateway, [CALL_REF_KEY]: callRef, ...(current?.metadata ?? {}) };
    const { metadata, changed } = linkProviderIdToMetadata(base, api4comId);
    if (changed || !current?.metadata) {
      const { error: updateError } = (await from(supabase, 'calls')
        .update({ metadata })
        .eq('id', callRef)) as { error: QueryError };
      if (updateError) throw new Error(updateError.message);
    }
  } catch (err) {
    console.error('[api4com] Failed to save api4com_call_id:', err instanceof Error ? err.message : String(err), {
      callId: callRef,
    });
  }

  await logLeadInteraction(supabase, { orgId, userId, input, normalizedPhone, callId: callRef, api4comId, ramal });

  return { success: true, data: { callId: callRef, api4comId } };
}

// Mirror the call into `interactions` so it shows up in the lead timeline.
// Webhook-driven external calls already get this via `createExternalCallInteraction`;
// calls initiated from the "Ligar" button skipped it, so they ended up
// invisible in the timeline (the manager could only see them in /calls).
// Linking via `metadata.callId` lets fetch-interactions enrich the row with
// recording_url/transcription/duration once the webhook updates the call.
async function logLeadInteraction(
  supabase: SupabaseClient<Database>,
  params: {
    orgId: string;
    userId: string;
    input: OriginateApi4ComInput;
    normalizedPhone: string;
    callId: string;
    api4comId: string | null;
    ramal: string;
  },
): Promise<void> {
  const { orgId, userId, input, normalizedPhone, callId, api4comId, ramal } = params;
  if (!input.leadId) return;
  const interactionInsert = (await from(supabase, 'interactions').insert({
    org_id: orgId,
    lead_id: input.leadId,
    contact_id: input.contactId ?? null,
    type: 'sent',
    channel: 'phone',
    message_content: `Ligação iniciada pela plataforma para ${normalizedPhone}`,
    performed_by: userId,
    metadata: {
      source: 'internal_api4com',
      callId,
      api4com_id: api4comId,
      ramal,
    },
  } as Record<string, unknown>)) as { error?: QueryError };
  if (interactionInsert?.error) {
    console.error('[api4com] Failed to log call interaction:', interactionInsert.error.message);
  }
}
