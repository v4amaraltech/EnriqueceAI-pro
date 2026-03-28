'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { checkRateLimit } from '@/lib/security/rate-limit';

import { enrichLeadWithApollo } from './enrich-lead-apollo';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function bulkEnrichApollo(
  leadIds: string[],
): Promise<ActionResult<{ successCount: number; failCount: number; skippedCount: number }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;

  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }

  // Rate limit: 5 bulk operations per org per minute
  const rl = await checkRateLimit(`bulk-apollo:${auth.data.orgId}`, 5, 60_000);
  if (!rl.allowed) {
    return { success: false, error: 'Limite de operações em massa atingido. Aguarde um momento.' };
  }

  if (leadIds.length > 100) {
    return { success: false, error: 'Máximo de 100 leads por vez' };
  }

  if (!leadIds.every((id) => UUID_RE.test(id))) {
    return { success: false, error: 'IDs inválidos' };
  }

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (const leadId of leadIds) {
    const result = await enrichLeadWithApollo(leadId);

    if (result.success) {
      successCount++;
    } else if (result.error === 'Lead já foi enriquecido via Apollo') {
      skippedCount++;
    } else {
      failCount++;
    }
  }

  revalidatePath('/leads');

  return { success: true, data: { successCount, failCount, skippedCount } };
}
