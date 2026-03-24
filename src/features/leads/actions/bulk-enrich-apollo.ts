'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';

import { enrichLeadWithApollo } from './enrich-lead-apollo';

export async function bulkEnrichApollo(
  leadIds: string[],
): Promise<ActionResult<{ successCount: number; failCount: number; skippedCount: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
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
