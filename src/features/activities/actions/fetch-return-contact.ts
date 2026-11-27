'use server';

import { z } from 'zod';

import {
  type CallbackTarget,
  loadCallbackTarget,
} from '@/features/cockpit/services/callback-contact.service';
import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

const schema = z.object({ scheduledActivityId: z.string().uuid(), leadId: z.string().uuid() });

/**
 * Contato indicado de UMA tarefa de retorno, para pré-selecionar o número. Mesma regra da discagem do Cockpit
 * (`loadCallbackTarget`): `null` = motivo normal para ligar ao principal; `success: false` = não deu para saber. Vale também com a tarefa aberta adiantada.
 */
export async function fetchReturnContact(
  input: z.input<typeof schema>,
): Promise<ActionResult<CallbackTarget | null>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;
  const { leadId, scheduledActivityId } = parsed.data;

  // A regra lê com service role (precisa ver ligações de qualquer SDR): antes, o lead tem de ser visível para a sessão.
  const { data: lead } = (await from(supabase, 'leads')
    .select('id')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { id: string } | null };
  if (!lead) return { success: false, error: 'Lead não encontrado' };

  let failed = false;
  const target = await loadCallbackTarget({
    orgId,
    leadId,
    now: new Date(),
    returnId: scheduledActivityId,
    onError: () => {
      failed = true;
    },
  });
  // Falha ≠ "sem contato": a tela avisa que está ligando para o principal.
  if (failed) return { success: false, error: 'Falha ao carregar o contato do retorno' };
  return { success: true, data: target };
}
