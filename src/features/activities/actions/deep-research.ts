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

interface DeepResearchInput {
  empresa: string;
  lead_id?: string | null;
  cnpj?: string | null;
  site?: string | null;
}

export async function deepResearchLead(
  input: DeepResearchInput,
): Promise<ActionResult<{ dossie: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;

  // Send empresa + lead_id always; include cnpj/site only when filled so the
  // n8n flow can use them as extra context for the research.
  const payload: Record<string, string> = { empresa: input.empresa };
  const leadId = input.lead_id?.trim();
  const cnpj = input.cnpj?.trim();
  const site = input.site?.trim();
  if (leadId) payload.lead_id = leadId;
  if (cnpj) payload.cnpj = cnpj;
  if (site) payload.site = site;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

    // Plain string at top level — use it directly.
    if (typeof result === 'string') {
      if (result.trim().length > 50) {
        return { success: true, data: { dossie: cleanDossie(result) } };
      }
      return { success: false, error: 'A pesquisa retornou uma resposta vazia. Tente novamente em instantes.' };
    }

    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;
      const knownFields = ['dossie', 'output', 'text', 'result', 'response', 'content', 'message', 'data', 'answer'];

      // 1. Try known field names first.
      for (const key of knownFields) {
        if (typeof obj[key] === 'string' && obj[key].length > 50) {
          return { success: true, data: { dossie: cleanDossie(obj[key] as string) } };
        }
      }

      // 2. Detect explicit null on the primary field — that means the n8n flow
      // produced no content (OpenAI failure, empty prompt, etc.). Surface as a
      // user-friendly error instead of dumping the JSON envelope into the notes.
      if ('dossie' in obj && obj.dossie === null) {
        console.error('[deep-research] n8n returned dossie:null. Payload:', JSON.stringify(obj).slice(0, 300));
        return { success: false, error: 'A IA não conseguiu gerar a pesquisa para esta empresa. Verifique o fluxo n8n e tente novamente.' };
      }

      // 3. Fallback: first long string field in any other key.
      for (const val of Object.values(obj)) {
        if (typeof val === 'string' && val.length > 50) {
          return { success: true, data: { dossie: cleanDossie(val) } };
        }
      }

      console.error('[deep-research] No usable field. Keys:', Object.keys(obj), 'Preview:', JSON.stringify(obj).slice(0, 300));
    }

    // Reaching here means the response had no usable dossie payload. Do NOT
    // stringify the envelope — that's how raw JSON ended up saved as a note.
    return { success: false, error: 'Nenhum resultado encontrado para esta empresa.' };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'A pesquisa demorou muito para responder. Tente novamente.' };
    }
    return { success: false, error: 'Não foi possível conectar à pesquisa. Verifique sua conexão e tente novamente.' };
  }
}
