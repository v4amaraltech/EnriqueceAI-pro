'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { PlanRow } from '../types';

export interface DowngradeWarnings {
  leadCount: number;
  hasCrmConnected: boolean;
  hasCalendarConnected: boolean;
}

export async function fetchDowngradeWarnings(
  targetPlan: PlanRow,
): Promise<ActionResult<{ warnings: string[] }>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const warnings: string[] = [];

  // Check lead count vs target plan limit
  const { count: leadCount } = (await (supabase
    .from('leads') as ReturnType<typeof supabase.from>)
    .select('id', { count: 'exact', head: true })
    .eq('org_id', member.org_id)) as { count: number | null };

  if (leadCount && leadCount > targetPlan.max_leads) {
    warnings.push(
      `Você tem ${leadCount.toLocaleString('pt-BR')} leads, mas o plano ${targetPlan.name} permite apenas ${targetPlan.max_leads.toLocaleString('pt-BR')}.`,
    );
  }

  // Check CRM integrations
  if (!targetPlan.features.crm) {
    const { count: crmCount } = (await (supabase
      .from('crm_connections') as ReturnType<typeof supabase.from>)
      .select('id', { count: 'exact', head: true })
      .eq('org_id', member.org_id)
      .eq('status', 'connected')) as { count: number | null };

    if (crmCount && crmCount > 0) {
      warnings.push(
        'Você tem integrações CRM ativas que serão desconectadas com este plano.',
      );
    }
  }

  // Check Calendar integrations
  if (!targetPlan.features.calendar) {
    const { count: calendarCount } = (await (supabase
      .from('gmail_connections') as ReturnType<typeof supabase.from>)
      .select('id', { count: 'exact', head: true })
      .eq('org_id', member.org_id)
      .eq('status', 'connected')) as { count: number | null };

    if (calendarCount && calendarCount > 0) {
      warnings.push(
        'Você tem integrações de calendário ativas que serão desconectadas com este plano.',
      );
    }
  }

  return { success: true, data: { warnings } };
}
