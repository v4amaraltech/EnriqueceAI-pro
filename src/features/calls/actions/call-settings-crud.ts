'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import type { createServerSupabaseClient } from '@/lib/supabase/server';

import type { CallDailyTargetRow, CallSettingsData, CallSettingsRow, PhoneBlacklistRow } from '../types';
import { addPhoneBlacklistSchema, saveCallSettingsSchema } from '../schemas/call-settings.schemas';

function settingsFrom(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  return from(supabase, 'organization_call_settings');
}

function targetsFrom(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  return from(supabase, 'call_daily_targets');
}

function blacklistFrom(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  return from(supabase, 'phone_blacklist');
}

export async function getCallSettings(): Promise<ActionResult<CallSettingsData>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch (error: unknown) {
    // Re-throw Next.js redirect errors so navigation works correctly
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data: settings } = (await settingsFrom(supabase)
    .select('*')
    .eq('org_id', orgId)
    .single()) as { data: CallSettingsRow | null };

  const { data: dailyTargets } = (await targetsFrom(supabase)
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })) as { data: CallDailyTargetRow[] | null };

  const { data: blacklist } = (await blacklistFrom(supabase)
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })) as { data: PhoneBlacklistRow[] | null };

  return {
    success: true,
    data: {
      settings: settings ?? null,
      dailyTargets: dailyTargets ?? [],
      blacklist: blacklist ?? [],
    },
  };
}

export async function saveCallSettings(
  raw: Record<string, unknown>,
): Promise<ActionResult<{ saved: true }>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch (error: unknown) {
    // Re-throw Next.js redirect errors so navigation works correctly
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return { success: false, error: 'Organização não encontrada' };
  }

  const parsed = saveCallSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const input = parsed.data;

  // Check if settings already exist
  const { data: existing } = (await settingsFrom(supabase)
    .select('id')
    .eq('org_id', orgId)
    .single()) as { data: { id: string } | null };

  if (existing) {
    const { error } = await settingsFrom(supabase)
      .update({
        calls_enabled: input.calls_enabled,
        default_call_type: input.default_call_type,
        significant_threshold_seconds: input.significant_threshold_seconds,
        daily_call_target: input.daily_call_target,
      })
      .eq('org_id', orgId);

    if (error) return { success: false, error: 'Erro ao salvar configurações' };
  } else {
    const { error } = await settingsFrom(supabase)
      .insert({
        org_id: orgId,
        calls_enabled: input.calls_enabled,
        default_call_type: input.default_call_type,
        significant_threshold_seconds: input.significant_threshold_seconds,
        daily_call_target: input.daily_call_target,
      });

    if (error) return { success: false, error: 'Erro ao criar configurações' };
  }

  revalidatePath('/settings/calls');
  return { success: true, data: { saved: true } };
}

export async function saveCallDailyTargets(
  targets: Array<{ userId: string; dailyTarget: number | null }>,
): Promise<ActionResult<{ saved: number }>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch (error: unknown) {
    // Re-throw Next.js redirect errors so navigation works correctly
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return { success: false, error: 'Organização não encontrada' };
  }

  let saved = 0;

  for (const target of targets) {
    if (target.dailyTarget === null) {
      // Remove individual override
      await targetsFrom(supabase)
        .delete()
        .eq('org_id', orgId)
        .eq('user_id', target.userId);
    } else {
      if (target.dailyTarget < 0) continue;

      // Delete then insert (handle upsert on composite unique)
      await targetsFrom(supabase)
        .delete()
        .eq('org_id', orgId)
        .eq('user_id', target.userId);

      const { error } = await targetsFrom(supabase)
        .insert({
          org_id: orgId,
          user_id: target.userId,
          daily_target: target.dailyTarget,
        });

      if (!error) saved++;
    }
  }

  revalidatePath('/settings/calls');
  return { success: true, data: { saved } };
}

export async function addPhoneBlacklist(
  raw: Record<string, unknown>,
): Promise<ActionResult<PhoneBlacklistRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch (error: unknown) {
    // Re-throw Next.js redirect errors so navigation works correctly
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return { success: false, error: 'Organização não encontrada' };
  }

  const parsed = addPhoneBlacklistSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const input = parsed.data;
  const trimmed = input.phone_pattern.trim();

  const { data, error } = (await blacklistFrom(supabase)
    .insert({
      org_id: orgId,
      phone_pattern: trimmed,
      reason: input.reason?.trim() || null,
    })
    .select()
    .single()) as { data: PhoneBlacklistRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao adicionar telefone (pode já estar na lista)' };
  revalidatePath('/settings/calls');
  return { success: true, data };
}

export async function deletePhoneBlacklist(id: string): Promise<ActionResult<{ deleted: true }>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch (error: unknown) {
    // Re-throw Next.js redirect errors so navigation works correctly
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return { success: false, error: 'Organização não encontrada' };
  }

  const { error } = await blacklistFrom(supabase)
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) return { success: false, error: 'Erro ao remover telefone' };
  revalidatePath('/settings/calls');
  return { success: true, data: { deleted: true } };
}
