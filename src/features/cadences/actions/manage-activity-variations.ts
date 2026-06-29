'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { ActivityTypeVariationRow } from '../types';

const channelSchema = z.enum(['email', 'whatsapp', 'phone', 'linkedin', 'research']);
const callProviderSchema = z.enum(['whatsapp']).nullish();

const createSchema = z.object({
  channel: channelSchema,
  label: z.string().trim().min(1, 'Rótulo é obrigatório').max(60, 'Rótulo muito longo'),
  call_provider: callProviderSchema,
  sort_order: z.number().int().optional(),
});

const renameSchema = z.object({
  id: z.string().uuid('ID inválido'),
  label: z.string().trim().min(1, 'Rótulo é obrigatório').max(60, 'Rótulo muito longo'),
});

export async function fetchActivityVariations(): Promise<ActionResult<ActivityTypeVariationRow[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'activity_type_variations')
    .select('*')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })) as {
    data: ActivityTypeVariationRow[] | null;
    error: { message: string } | null;
  };

  const qErr = handleQueryError(error, 'Erro ao carregar variações', 'activity_type_variations');
  if (qErr) return qErr;

  return { success: true, data: data ?? [] };
}

export async function createActivityVariation(
  input: Record<string, unknown>,
): Promise<ActionResult<ActivityTypeVariationRow>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'activity_type_variations')
    .insert({
      org_id: orgId,
      channel: parsed.data.channel,
      label: parsed.data.label,
      call_provider: parsed.data.call_provider ?? null,
      sort_order: parsed.data.sort_order ?? 0,
    } as Record<string, unknown>)
    .select('*')
    .single()) as { data: ActivityTypeVariationRow | null; error: { message: string } | null };

  const qErr = handleQueryError(error, 'Erro ao criar variação', 'activity_type_variations');
  if (qErr) return qErr;

  return { success: true, data: data! };
}

export async function renameActivityVariation(
  input: Record<string, unknown>,
): Promise<ActionResult<ActivityTypeVariationRow>> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'activity_type_variations')
    .update({ label: parsed.data.label } as Record<string, unknown>)
    .eq('id', parsed.data.id)
    .eq('org_id', orgId)
    .select('*')
    .single()) as { data: ActivityTypeVariationRow | null; error: { message: string } | null };

  const qErr = handleQueryError(error, 'Erro ao renomear variação', 'activity_type_variations');
  if (qErr) return qErr;

  return { success: true, data: data! };
}

export async function deleteActivityVariation(id: string): Promise<ActionResult<{ id: string }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'ID inválido' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { error } = (await from(supabase, 'activity_type_variations')
    .delete()
    .eq('id', parsed.data)
    .eq('org_id', orgId)) as { error: { message: string } | null };

  const qErr = handleQueryError(error, 'Erro ao remover variação', 'activity_type_variations');
  if (qErr) return qErr;

  return { success: true, data: { id: parsed.data } };
}
