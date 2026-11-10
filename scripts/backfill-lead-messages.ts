/**
 * Copia interactions de WhatsApp e e-mail para lead_messages.
 *
 * Não roda no CI e não foi executado nesta entrega.
 * Só copia quando alguém passar --execute, com a migration já aplicada:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm exec tsx scripts/backfill-lead-messages.ts --execute
 *
 * O upsert usa (org_id, provider, provider_message_id). Rodar de novo não duplica.
 * provider fica 'legacy_interactions'. Não baixa mídia e não apaga interactions.
 */
import { createClient } from '@supabase/supabase-js';

import { legacyInteractionToMessage, type LegacyInteraction } from '../src/features/lead-messages/backfill';

const PAGE = 200;

async function main() {
  if (!process.argv.includes('--execute')) {
    console.log('Backfill não executado. Passe --execute somente depois da migration, fora do CI.');
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
    process.exitCode = 1;
    return;
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  let copied = 0;
  let skipped = 0;
  let after: string | null = null;

  for (;;) {
    let query = db
      .from('interactions')
      .select('id, org_id, lead_id, channel, type, message_content, external_id, metadata, ai_generated, performed_by, created_at')
      .in('channel', ['whatsapp', 'email'])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE);
    if (after) query = query.gt('created_at', after);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as LegacyInteraction[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const message = legacyInteractionToMessage(row);
      if (!message) {
        skipped += 1;
        continue;
      }
      const { status, ...insert } = message;
      const { data: saved, error: upsertError } = await db
        .from('lead_messages')
        .upsert(insert, { onConflict: 'org_id,provider,provider_message_id', ignoreDuplicates: true })
        .select('id')
        .maybeSingle();
      if (upsertError) throw new Error(upsertError.message);
      if (saved && status) {
        await db.from('lead_message_status_events').upsert(
          { org_id: message.org_id, message_id: saved.id, status, occurred_at: message.occurred_at, raw: { source: 'legacy_interactions' } },
          { onConflict: 'message_id,status', ignoreDuplicates: true },
        );
      }
      copied += 1;
    }

    after = rows[rows.length - 1]?.created_at ?? after;
    if (rows.length < PAGE) break;
  }

  console.log(`Backfill concluído. Copiadas: ${copied}. Ignoradas: ${skipped}.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
