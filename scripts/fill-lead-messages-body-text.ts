/**
 * Preenche lead_messages.body_text vazio a partir de body_html, de UMA org.
 *
 * Não roda no CI. O padrão é dry-run: lê e imprime só contagens e ids.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm exec tsx scripts/fill-lead-messages-body-text.ts --org <uuid>
 *
 * --apply grava só a coluna body_text, linha a linha, e só onde ainda está
 * nula ou vazia. Exige a migration 20261113190000_lead_messages_fill_empty_body_text
 * aplicada antes (sem ela o trigger recusa o UPDATE).
 * Nunca imprime o corpo das mensagens.
 */
import { pathToFileURL } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import {
  runFillBodyText,
  type FillBodyTextDb,
  type FillCandidateRow,
  type FillCursor,
} from '../src/features/lead-messages/fill-body-text-script';

function quoteFilter(value: string): string {
  return `"${value.replace(/[",()\\]/g, '')}"`;
}

function keyset(cursor: FillCursor): string {
  const at = quoteFilter(cursor.createdAt);
  const id = quoteFilter(cursor.id);
  return `created_at.gt.${at},and(created_at.eq.${at},id.gt.${id})`;
}

export function supabaseFillDb(url: string, key: string): FillBodyTextDb {
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async listCandidates(orgId, after, limit) {
      let query = db
        .from('lead_messages')
        .select('id, org_id, channel, direction, provider, body_text, body_html, created_at')
        .eq('org_id', orgId)
        .not('body_html', 'is', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (after) query = query.or(keyset(after));
      const { data, error } = await query;
      if (error) throw new Error(`Leitura falhou: ${error.code ?? ''} ${error.message}`);
      return (data ?? []) as FillCandidateRow[];
    },
    async updateBodyText(orgId, id, bodyText) {
      const { data, error } = await db
        .from('lead_messages')
        .update({ body_text: bodyText })
        .eq('org_id', orgId)
        .eq('id', id)
        .or('body_text.is.null,body_text.eq.')
        .select('id');
      if (error) throw new Error(`Gravação falhou no id ${id}: ${error.code ?? ''} ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    if (!url || !key) throw new Error('Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
    await runFillBodyText({ argv: process.argv.slice(2), db: supabaseFillDb(url, key) });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
  void main();
}
