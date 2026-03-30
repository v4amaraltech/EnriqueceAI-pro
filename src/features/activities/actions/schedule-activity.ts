'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

const scheduleActivitySchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(['phone', 'whatsapp', 'email', 'linkedin', 'research']),
  scheduledAt: z.string().min(1),
  notes: z.string().optional(),
  completeEnrollments: z.boolean().default(true),
});

export async function scheduleActivity(
  input: z.infer<typeof scheduleActivitySchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = scheduleActivitySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { leadId, channel, scheduledAt, notes, completeEnrollments } = parsed.data;

  // Create scheduled activity
  const { data, error } = (await from(supabase, 'scheduled_activities' as never)
    .insert({
      org_id: orgId,
      lead_id: leadId,
      user_id: userId,
      channel,
      scheduled_at: scheduledAt,
      notes: notes || null,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Erro ao agendar atividade' };
  }

  // Complete active cadence enrollments if requested
  if (completeEnrollments) {
    await from(supabase, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused']);
  }

  // Record system interaction for timeline
  const channelLabels: Record<string, string> = {
    phone: 'Ligação', whatsapp: 'WhatsApp', email: 'Email', linkedin: 'LinkedIn', research: 'Pesquisa',
  };
  const dateStr = new Date(scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  await from(supabase, 'interactions')
    .insert({
      org_id: orgId,
      lead_id: leadId,
      channel: 'system',
      type: 'sent',
      message_content: `Atividade agendada: ${channelLabels[channel] ?? channel} para ${dateStr}${notes ? ` — ${notes}` : ''}`,
      performed_by: userId,
      metadata: { system_event: 'activity_scheduled', scheduled_activity_id: data.id },
    } as Record<string, unknown>);

  revalidatePath('/atividades');
  revalidatePath(`/leads/${leadId}`);

  return { success: true, data: { id: data.id } };
}
