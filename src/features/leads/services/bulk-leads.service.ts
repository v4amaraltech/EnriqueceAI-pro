import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { MAX_BULK_LEAD_IDS } from '@/lib/constants/limits';
import { from } from '@/lib/supabase/from';

/**
 * Valida o tamanho do lote de uma operação em massa de leads. Retorna a mensagem
 * de erro (pronta para `ActionResult`) ou `null` quando ok.
 */
export function validateBulkLeadIds(leadIds: string[]): string | null {
  if (leadIds.length === 0) return 'Nenhum lead selecionado';
  if (leadIds.length > MAX_BULK_LEAD_IDS) return `Máximo de ${MAX_BULK_LEAD_IDS} leads por operação`;
  return null;
}

/** Revalida as telas afetadas por uma mutação de leads em massa. */
export function revalidateLeadPaths(): void {
  revalidatePath('/leads');
  revalidatePath('/atividades');
}

/**
 * Encerra os enrollments ativos/pausados dos leads dados, via service role
 * (bypassa RLS para o cron parar de agendar). O patch varia por chamador
 * (arquivar/excluir vs perder, que carrega loss_reason).
 *
 * SEGURANÇA: `cadence_enrollments` NÃO tem `org_id`, então o escopo de org vem
 * de FORA — passe APENAS lead ids já confirmados como da org do caller (use o
 * retorno `.select('id')` do UPDATE de `leads` org-scoped). Passar leadIds crus
 * do cliente reabre o IDOR cross-org (S6).
 */
export async function endActiveEnrollments(
  serviceClient: SupabaseClient,
  confirmedLeadIds: string[],
  patch: Record<string, unknown>,
): Promise<void> {
  if (confirmedLeadIds.length === 0) return;
  await from(serviceClient, 'cadence_enrollments')
    .update(patch as Record<string, unknown>)
    .in('lead_id', confirmedLeadIds)
    .in('status', ['active', 'paused']);
}
