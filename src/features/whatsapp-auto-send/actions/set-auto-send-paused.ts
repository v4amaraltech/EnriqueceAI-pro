'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

const schema = z.object({
  instanceId: z.string().uuid(),
  paused: z.boolean(),
});

/**
 * Pausar / retomar a fila de WhatsApp automático de um número (Cockpit).
 *
 * O RLS de `whatsapp_instances` só deixa gestor alterar, mas o SDR precisa
 * pausar o próprio número — então a posse é conferida aqui e a escrita sai
 * pelo service role, só nas colunas de pausa (critério 14).
 */
export async function setAutoSendPaused(input: z.infer<typeof schema>): Promise<ActionResult<{ paused: boolean }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId, orgId, role } = auth.data;

  const service = createServiceRoleClient();
  const { data: instance } = (await from(service, 'whatsapp_instances')
    .select('id, org_id, user_id, status, auto_send_paused_at')
    .eq('id', parsed.data.instanceId)
    .eq('org_id', orgId)
    .maybeSingle()) as {
    data: { id: string; org_id: string; user_id: string | null; status: string; auto_send_paused_at: string | null } | null;
  };

  // Mesmo erro para "não existe" e "não é seu": não revela números de outros SDRs.
  if (!instance || !instance.user_id || (role !== 'manager' && instance.user_id !== userId)) {
    return { success: false, error: 'Número não encontrado' };
  }

  if (parsed.data.paused) {
    if (instance.auto_send_paused_at) return { success: true, data: { paused: true } };
    const profiles = await resolveUserProfiles([userId]);
    const who = profiles.get(userId)?.displayName ?? 'usuário';
    const { error } = await from(service, 'whatsapp_instances')
      .update({
        auto_send_paused_at: new Date().toISOString(),
        auto_send_pause_reason: `pausado manualmente por ${who}`,
      } as Record<string, unknown>)
      .eq('id', instance.id);
    if (error) return { success: false, error: 'Erro ao pausar' };
  } else {
    // Retomar com o WhatsApp caído só faria o freio pausar de novo no minuto seguinte.
    if (instance.status !== 'connected') {
      return { success: false, error: 'Conecte o WhatsApp antes de retomar o envio automático' };
    }
    const { error } = await from(service, 'whatsapp_instances')
      .update({
        auto_send_paused_at: null,
        auto_send_pause_reason: null,
        auto_send_consecutive_failures: 0,
        auto_send_next_at: null,
      } as Record<string, unknown>)
      .eq('id', instance.id);
    if (error) return { success: false, error: 'Erro ao retomar' };
  }

  revalidatePath('/cockpit');
  return { success: true, data: { paused: parsed.data.paused } };
}
