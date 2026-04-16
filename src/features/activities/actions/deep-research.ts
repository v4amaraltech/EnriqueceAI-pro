'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

const N8N_WEBHOOK_URL = 'https://webhook-n8n.v4companyamaral.com/webhook/deep-research-lead';

/** Strip chain-of-thought preamble, keep only the formatted dossiê */
function cleanDossie(raw: string): string {
  const separatorIdx = raw.search(/(?:^|\n)(?:---|═══)/);
  return separatorIdx > 0 ? raw.slice(separatorIdx).trim() : raw.trim();
}
const TIMEOUT_MS = 180_000; // 3min timeout — AI agent research takes time

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
      let detail = '';
      try {
        const errorBody = await response.text();
        if (errorBody) detail = ` — ${errorBody.slice(0, 200)}`;
      } catch { /* ignore */ }
      console.error(`[deep-research] n8n returned ${response.status}${detail}`);
      return { success: false, error: 'A pesquisa não pôde ser concluída agora. Tente novamente em instantes.' };
    }

    const raw = await response.text();
    console.log('[deep-research] Raw response (first 500 chars):', raw.slice(0, 500));

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // Response is plain text, not JSON — use directly
      if (raw.trim().length > 50) {
        return { success: true, data: { dossie: cleanDossie(raw) } };
      }
      return { success: false, error: 'Resposta inesperada da pesquisa. Tente novamente.' };
    }

    // Unwrap array
    const result = Array.isArray(data) ? data[0] : data;

    // Try known field names first
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;
      const knownFields = ['dossie', 'output', 'text', 'result', 'response', 'content', 'message', 'data', 'answer'];
      for (const key of knownFields) {
        if (typeof obj[key] === 'string' && obj[key].length > 50) {
          return { success: true, data: { dossie: cleanDossie(obj[key] as string) } };
        }
      }
      // Fallback: use the first long string field found
      for (const val of Object.values(obj)) {
        if (typeof val === 'string' && val.length > 50) {
          return { success: true, data: { dossie: cleanDossie(val) } };
        }
      }
      console.error('[deep-research] No usable field. Keys:', Object.keys(obj), 'Preview:', JSON.stringify(obj).slice(0, 300));
    }

    // Last resort: stringify
    const fallback = typeof result === 'string' ? result : JSON.stringify(result);
    if (fallback.length > 50) {
      return { success: true, data: { dossie: cleanDossie(fallback) } };
    }

    return { success: false, error: 'Nenhum resultado encontrado para esta empresa.' };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'A pesquisa demorou muito para responder. Tente novamente.' };
    }
    return { success: false, error: 'Não foi possível conectar à pesquisa. Verifique sua conexão e tente novamente.' };
  }
}
