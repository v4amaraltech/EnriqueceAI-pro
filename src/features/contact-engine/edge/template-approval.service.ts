import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

/**
 * Validacao de template do WhatsApp oficial no servidor (PR13).
 *
 * O n8n nao afirma que um template esta aprovado: o app consulta a Graph API
 * (templates APPROVED da WABA da organizacao, credencial de `whatsapp_connections`,
 * a mesma usada em `WhatsAppService`) e compara por id ou nome e por idioma.
 *
 *  - Cache curto em memoria por organizacao e WABA (60 s). Erro nunca e cacheado.
 *  - Falha de leitura, conexao ausente ou resposta invalida = `error` (fail-closed).
 *  - So e chamado com a flag `edge_command_adapter` ligada (dentro de `authorizeSend`).
 *  - Token nunca vai para log nem para resposta. Logs com ids e codigos apenas.
 */
export const TEMPLATE_CACHE_TTL_MS = 60_000;
export const DEFAULT_TEMPLATE_LANGUAGE = 'pt_BR';

const GRAPH_URL = 'https://graph.facebook.com/v21.0';
const GRAPH_HOST = 'graph.facebook.com';
const PAGE_LIMIT = 200;
const MAX_PAGES = 5;
const FETCH_TIMEOUT_MS = 8_000;

export interface ApprovedTemplate {
  id: string;
  name: string;
  language: string;
}

export type TemplateVerdict = 'approved' | 'not_approved' | 'language_mismatch' | 'error';

interface CacheEntry {
  expiresAt: number;
  templates: ApprovedTemplate[];
}

const cache = new Map<string, CacheEntry>();

/** Uso em teste. */
export function clearTemplateCache(): void {
  cache.clear();
}

export interface TemplateDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  loadConnection?: (orgId: string) => Promise<{ wabaId: string; token: string } | null | 'error'>;
}

async function defaultLoadConnection(orgId: string): Promise<{ wabaId: string; token: string } | null | 'error'> {
  try {
    const res = (await from(createServiceRoleClient(), 'whatsapp_connections')
      .select('business_account_id, access_token_encrypted')
      .eq('org_id', orgId)
      .eq('status', 'connected')
      .limit(1)) as {
      data: Array<{ business_account_id: string; access_token_encrypted: string }> | null;
      error: { message: string } | null;
    };
    if (res.error) return 'error';
    const row = res.data?.[0];
    if (!row) return null;
    return { wabaId: row.business_account_id, token: decrypt(row.access_token_encrypted) };
  } catch {
    return 'error';
  }
}

async function fetchApproved(wabaId: string, token: string, fetchImpl: typeof fetch): Promise<ApprovedTemplate[] | null> {
  const out: ApprovedTemplate[] = [];
  let url: string | null =
    `${GRAPH_URL}/${encodeURIComponent(wabaId)}/message_templates?status=APPROVED&fields=id,name,language,status&limit=${PAGE_LIMIT}`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res: Response = await fetchImpl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      data?: Array<{ id?: unknown; name?: unknown; language?: unknown; status?: unknown }>;
      paging?: { next?: unknown };
    } | null;
    if (!body || !Array.isArray(body.data)) return null;
    for (const t of body.data) {
      if (t.status === 'APPROVED' && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.language === 'string') {
        out.push({ id: t.id, name: t.name, language: t.language });
      }
    }
    const next: unknown = body.paging?.next;
    // So segue paginacao que continue no host da Graph API.
    url = typeof next === 'string' && new URL(next).host === GRAPH_HOST ? next : null;
    if (url && page === MAX_PAGES - 1) return null; // lista maior que o limite: nao decide por lista parcial
  }
  return out;
}

/** Decisao pura sobre a lista de aprovados. */
export function matchTemplate(templates: ApprovedTemplate[], ref: string, language: string): TemplateVerdict {
  const sameRef = templates.filter((t) => t.id === ref || t.name === ref);
  if (sameRef.length === 0) return 'not_approved';
  return sameRef.some((t) => t.language === language) ? 'approved' : 'language_mismatch';
}

export async function verifyApprovedTemplate(
  orgId: string,
  template: { id: string; language?: string },
  deps: TemplateDeps = {},
): Promise<TemplateVerdict> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const language = template.language ?? DEFAULT_TEMPLATE_LANGUAGE;
  try {
    const conn = await (deps.loadConnection ?? defaultLoadConnection)(orgId);
    if (conn === 'error' || conn === null) return 'error';

    const key = `${orgId}|${conn.wabaId}`;
    const hit = cache.get(key);
    let templates = hit && hit.expiresAt > now() ? hit.templates : null;
    if (!templates) {
      templates = await fetchApproved(conn.wabaId, conn.token, fetchImpl);
      if (!templates) {
        console.error('[edge-command] template_lookup_failed', { orgId });
        return 'error';
      }
      cache.set(key, { expiresAt: now() + TEMPLATE_CACHE_TTL_MS, templates });
    }
    return matchTemplate(templates, template.id, language);
  } catch {
    console.error('[edge-command] template_lookup_failed', { orgId });
    return 'error';
  }
}
