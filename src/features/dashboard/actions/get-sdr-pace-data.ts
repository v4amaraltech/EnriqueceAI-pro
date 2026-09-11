'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { fetchSdrIds, fetchSdrPaceMetrics } from '../services/sdr-pace.service';
import type { SdrOption, SdrPaceData, SdrPaceMetrics } from '../types';

const inputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM format'),
  userId: z.string().uuid().optional(),
});

function isRedirect(error: unknown): boolean {
  return (
    error instanceof Error &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

async function resolveSdrOptions(sdrIds: string[]): Promise<SdrOption[]> {
  const options = new Map<string, SdrOption>(
    sdrIds.map((id) => [id, { userId: id, userName: id.slice(0, 8) }]),
  );
  try {
    const adminClient = createAdminSupabaseClient();
    await Promise.all(
      sdrIds.map(async (id) => {
        const { data } = await adminClient.auth.admin.getUserById(id);
        if (!data?.user) return;
        const u = data.user;
        const meta = u.user_metadata as { full_name?: string; avatar_url?: string } | undefined;
        options.set(id, {
          userId: id,
          userName: meta?.full_name ?? u.email?.split('@')[0] ?? id.slice(0, 8),
          avatarUrl: meta?.avatar_url,
        });
      }),
    );
  } catch {
    // Fallback: mantém o id truncado como nome
  }
  return [...options.values()].sort((a, b) => a.userName.localeCompare(b.userName, 'pt-BR'));
}

/**
 * Carga inicial da seção "SDR selecionado": lista de SDRs do seletor + números
 * do SDR escolhido. Qualquer papel pode ver qualquer SDR (o dashboard já é
 * global — ranking do time visível para todos). SDR padrão: o pedido, se for
 * SDR da org; senão o próprio usuário, se for SDR; senão o 1º da lista.
 */
export async function getSdrPaceData(input: {
  month: string;
  userId?: string;
}): Promise<ActionResult<SdrPaceData>> {
  const { userId: viewerId, orgId } = await requireAuthWithMember();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Filtros inválidos' };
  const { month, userId: requested } = parsed.data;

  try {
    const supabase = createServiceRoleClient();
    const sdrIds = await fetchSdrIds(supabase, orgId);
    const sdrs = await resolveSdrOptions(sdrIds);
    const isSdr = (id: string | undefined): id is string => !!id && sdrIds.includes(id);
    const selectedUserId = isSdr(requested) ? requested : isSdr(viewerId) ? viewerId : (sdrs[0]?.userId ?? null);

    const metrics = selectedUserId
      ? await fetchSdrPaceMetrics(supabase, orgId, month, selectedUserId)
      : null;

    return { success: true, data: { month, sdrs, selectedUserId, metrics } };
  } catch (error: unknown) {
    if (isRedirect(error)) throw error;
    console.error('[getSdrPaceData]', error);
    return { success: false, error: 'Erro ao carregar os números do SDR' };
  }
}

/** Troca de SDR no seletor: só os números (a lista já está na tela). */
export async function getSdrPaceMetrics(input: {
  month: string;
  userId: string;
}): Promise<ActionResult<SdrPaceMetrics>> {
  const { orgId } = await requireAuthWithMember();
  const parsed = inputSchema.required({ userId: true }).safeParse(input);
  if (!parsed.success) return { success: false, error: 'Filtros inválidos' };
  const { month, userId } = parsed.data;

  try {
    const supabase = createServiceRoleClient();
    // Service role ignora RLS: só aceita SDR da própria org.
    const sdrIds = await fetchSdrIds(supabase, orgId);
    if (!sdrIds.includes(userId)) return { success: false, error: 'SDR não encontrado' };
    return { success: true, data: await fetchSdrPaceMetrics(supabase, orgId, month, userId) };
  } catch (error: unknown) {
    if (isRedirect(error)) throw error;
    console.error('[getSdrPaceMetrics]', error);
    return { success: false, error: 'Erro ao carregar os números do SDR' };
  }
}
