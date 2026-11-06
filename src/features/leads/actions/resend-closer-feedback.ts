'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { sendCloserFeedbackEmail, type SendFeedbackChannelResult } from './send-closer-feedback';

const inputSchema = z.object({
  leadId: z.string().uuid('Lead inválido'),
});

interface LeadRow {
  id: string;
  status: string;
  closer_id: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
}

interface CloserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

interface PendingRequestRow {
  id: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  already_answered_recently: 'O closer já respondeu o feedback desta reunião',
  no_manager_evolution: 'Nenhum gestor com WhatsApp conectado para enviar',
};

/**
 * Re-trigger a closer feedback notification (email + WhatsApp via the org
 * manager's Evolution instance). Reuses any pending request for the lead/closer
 * pair so the closer keeps the original link.
 *
 * Sem request nenhum, só segue para lead `won`: é o caminho do gestor para
 * recuperar um Ganho cujo link nunca saiu (ex.: Ganho marcado antes da reunião
 * em versões antigas, que descartavam o pedido). Lead fora de `won` sem request
 * continua recusado — clicar o botão num lead antigo não abre ciclo novo.
 *
 * Reunião ainda no futuro: o serviço deixa o pedido agendado (`email:
 * 'scheduled'`) e o cron envia depois — isso é sucesso, não falha.
 */
export async function resendCloserFeedback(
  input: z.infer<typeof inputSchema>,
): Promise<ActionResult<SendFeedbackChannelResult>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data: lead } = (await from(supabase, 'leads')
    .select('id, status, closer_id, nome_fantasia, razao_social')
    .eq('id', parsed.data.leadId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: LeadRow | null };

  if (!lead) {
    return { success: false, error: 'Lead não encontrado' };
  }
  if (!lead.closer_id) {
    return { success: false, error: 'Lead não possui closer atribuído' };
  }

  const { data: closer } = (await from(supabase, 'closers')
    .select('id, name, email, phone')
    .eq('id', lead.closer_id)
    .eq('org_id', orgId)
    .maybeSingle()) as { data: CloserRow | null };

  if (!closer) {
    return { success: false, error: 'Closer não encontrado' };
  }

  const { data: pending } = (await from(supabase, 'closer_feedback_requests')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('closer_id', closer.id)
    .is('responded_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()) as { data: PendingRequestRow | null };

  if (!pending && lead.status !== 'won') {
    return { success: false, error: 'Nenhum feedback pendente para este lead' };
  }

  const leadName = lead.nome_fantasia ?? lead.razao_social ?? 'Lead';
  const result = await sendCloserFeedbackEmail({
    leadId: lead.id,
    orgId,
    closerId: closer.id,
    closerName: closer.name,
    closerEmail: closer.email,
    closerPhone: closer.phone,
    leadName,
    senderUserId: userId,
  });

  if (result.email === 'scheduled') {
    return { success: true, data: result };
  }

  if (result.email !== 'sent' && result.whatsapp !== 'sent') {
    const raw = result.emailError ?? result.whatsappError ?? 'Falha ao enviar feedback';
    return { success: false, error: ERROR_MESSAGES[raw] ?? raw };
  }

  return { success: true, data: result };
}
