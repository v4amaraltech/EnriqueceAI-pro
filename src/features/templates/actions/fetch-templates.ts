'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { TemplateListResult } from '../index';
import type { MessageTemplateRow } from '../../cadences/types';

interface FetchTemplatesParams {
  channel?: string;
  search?: string;
  is_system?: boolean;
  page?: number;
  per_page?: number;
}

export async function fetchTemplates(
  params: FetchTemplatesParams = {},
): Promise<ActionResult<TemplateListResult>> {
  const { userId, orgId, role } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const page = params.page ?? 1;
  const per_page = params.per_page ?? 20;
  const rangeFrom = (page - 1) * per_page;
  const to = rangeFrom + per_page - 1;

  let query = from(supabase, 'message_templates')
    .select('*', { count: 'exact' })
    .eq('org_id', orgId);

  // SDR isolation: only see own templates + system templates
  if (role === 'sdr') {
    query = query.or(`created_by.eq.${userId},is_system.eq.true`);
  }

  if (params.channel) {
    query = query.eq('channel', params.channel);
  }

  if (params.is_system !== undefined) {
    query = query.eq('is_system', params.is_system);
  }

  if (params.search) {
    query = query.ilike('name', `%${params.search}%`);
  }

  query = query.order('created_at', { ascending: false }).range(rangeFrom, to);

  const { data, count, error } = (await query) as {
    data: MessageTemplateRow[] | null;
    count: number | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar templates' };
  }

  return {
    success: true,
    data: {
      data: data ?? [],
      total: count ?? 0,
      page,
      per_page,
    },
  };
}

export async function fetchTemplate(
  templateId: string,
): Promise<ActionResult<MessageTemplateRow>> {
  const { userId, orgId, role } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  let query = from(supabase, 'message_templates')
    .select('*')
    .eq('id', templateId)
    .eq('org_id', orgId);

  // SDR isolation: can only access own templates + system templates
  if (role === 'sdr') {
    query = query.or(`created_by.eq.${userId},is_system.eq.true`);
  }

  const { data, error } = (await query.single()) as {
    data: MessageTemplateRow | null;
    error: { message: string } | null;
  };

  if (error || !data) {
    return { success: false, error: 'Template não encontrado' };
  }

  return { success: true, data };
}
