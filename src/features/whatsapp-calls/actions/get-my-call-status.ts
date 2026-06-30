'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Status da Ligação via WhatsApp para o usuário logado: ele tem um número
 * pareado e conectado? Usado para habilitar a opção "Ligar via WhatsApp" no
 * botão da tela do lead — só aparece quando há sessão conectada (o pareamento é
 * feito pelo gestor na tela manager-only "Números WhatsApp", story 7.3).
 *
 * Lê a própria sessão via cliente do usuário (RLS permite o dono ler a sua),
 * mesmo padrão de startWhatsAppCall.
 */
export async function getMyWhatsAppCallStatus(): Promise<
  ActionResult<{ paired: boolean; phoneNumber: string | null }>
> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: session } = (await from(supabase, 'whatsapp_call_sessions')
    .select('phone_number, status')
    .eq('user_id', user.id)
    .eq('status', 'connected')
    .maybeSingle()) as { data: { phone_number: string | null; status: string } | null };

  return { success: true, data: { paired: !!session, phoneNumber: session?.phone_number ?? null } };
}
