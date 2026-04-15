'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

const N8N_WEBHOOK_URL = 'https://webhook-n8n.v4companyamaral.com/webhook/deep-research-lead';
const TIMEOUT_MS = 60_000; // 60s timeout

export async function deepResearchLead(
  empresa: string,
): Promise<ActionResult<{ dossie: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { success: false, error: `Erro no serviço de pesquisa (${response.status})` };
    }

    const data = (await response.json()) as { dossie?: string } | Array<{ dossie?: string }>;
    const result = Array.isArray(data) ? data[0] : data;
    const dossie = result?.dossie;

    if (!dossie) {
      return { success: false, error: 'Nenhum resultado retornado' };
    }

    return { success: true, data: { dossie } };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Pesquisa excedeu o tempo limite (60s)' };
    }
    return { success: false, error: 'Erro de conexão com o serviço de pesquisa' };
  }
}
