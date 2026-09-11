'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { ensureCallWebhook } from '../services/api4com.service';

/**
 * Garante que a conta API4COM do usuário entregue os eventos de ligação
 * (integração `webhook` sem filtro — ver `ensureCallWebhook`). Chamada
 * automaticamente depois de salvar a config API4COM. Não mexe em integrações
 * de CRM.
 */
export async function registerApi4ComWebhook(): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId } = auth.data;

  try {
    await ensureCallWebhook(userId);
    return { success: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao configurar eventos da API4COM';
    console.error('[api4com] ensureCallWebhook failed:', message);
    return { success: false, error: message };
  }
}
