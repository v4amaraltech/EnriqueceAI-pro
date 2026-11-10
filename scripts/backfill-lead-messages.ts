/**
 * Copia interactions de WhatsApp e e-mail de UMA org para lead_messages.
 *
 * Não roda no CI e não grava sem --execute. O padrão é --dry-run:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm exec tsx scripts/backfill-lead-messages.ts --org <uuid>
 *
 *   pnpm exec tsx scripts/backfill-lead-messages.ts --org <uuid> --execute
 *
 * A leitura filtra org_id. Outra organização não entra na consulta.
 * A página usa (created_at, id), então o mesmo instante na borda não some.
 * O upsert usa (org_id, provider, provider_message_id). Rodar de novo não duplica.
 * provider fica 'legacy_interactions'. Não baixa mídia e não apaga interactions.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { LegacyInteraction } from '../src/features/lead-messages/backfill';
import {
  audienceFromDirectory,
  cursorAfter,
  decideLegacyCopy,
  formatSample,
  keysetFilter,
  parseBackfillArgs,
  type BackfillCursor,
  type LeadAudience,
} from '../src/features/lead-messages/backfill-script';

const PAGE = 200;
const SAMPLE_LIMIT = 5;
const CHANNELS = ['whatsapp', 'email'] as const;

interface ChannelTally {
  wouldCopy: number;
  copied: number;
  duplicates: number;
  reasons: Record<string, number>;
}

function emptyTally(): ChannelTally {
  return { wouldCopy: 0, copied: 0, duplicates: 0, reasons: {} };
}

function addReason(tally: ChannelTally, reason: string) {
  tally.reasons[reason] = (tally.reasons[reason] ?? 0) + 1;
}

function skippedTotal(tally: ChannelTally): number {
  return Object.values(tally.reasons).reduce((sum, count) => sum + count, 0);
}

function printReport(execute: boolean, tallies: Record<string, ChannelTally>, samples: string[]) {
  const mode = execute ? 'execute' : 'dry-run';
  console.log(`Modo: ${mode}. Nenhuma outra org foi consultada.`);
  for (const channel of CHANNELS) {
    const tally = tallies[channel] ?? emptyTally();
    if (execute) {
      console.log(
        `${channel}  copiadas: ${tally.copied}  duplicadas: ${tally.duplicates}  ignoradas: ${skippedTotal(tally)}`,
      );
    } else {
      console.log(`${channel}  copiaria: ${tally.wouldCopy}  ignoradas: ${skippedTotal(tally)}`);
    }
    for (const reason of Object.keys(tally.reasons).sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
      console.log(`  ${reason}: ${tally.reasons[reason]}`);
    }
  }
  if (!execute) {
    console.log(samples.length === 0 ? 'Amostras: nenhuma linha seria copiada.' : 'Amostras (corpo até 60, endereço mascarado):');
    for (const sample of samples) console.log(`  ${sample}`);
    console.log('Dry-run: nenhuma escrita.');
  }
}

async function loadAudience(
  db: SupabaseClient,
  orgId: string,
  leadId: string,
  cache: Map<string, LeadAudience>,
): Promise<LeadAudience> {
  const cached = cache.get(leadId);
  if (cached) return cached;
  const leadRes = await db
    .from('leads')
    .select('telefone, phones, email, emails')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (leadRes.error) throw new Error(leadRes.error.message);
  const contactRes = await db
    .from('lead_contacts')
    .select('phones, emails')
    .eq('lead_id', leadId)
    .eq('org_id', orgId);
  if (contactRes.error) throw new Error(contactRes.error.message);
  const audience = audienceFromDirectory({
    telefone: leadRes.data?.telefone,
    phones: leadRes.data?.phones,
    email: leadRes.data?.email,
    emails: leadRes.data?.emails,
    contacts: contactRes.data ?? [],
  });
  cache.set(leadId, audience);
  return audience;
}

async function main() {
  const args = parseBackfillArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
    process.exitCode = 1;
    return;
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const tallies: Record<string, ChannelTally> = { whatsapp: emptyTally(), email: emptyTally() };
  const samples: string[] = [];
  const audiences = new Map<string, LeadAudience>();
  let cursor: BackfillCursor | null = null;

  try {
    for (;;) {
      let query = db
        .from('interactions')
        .select('id, org_id, lead_id, channel, type, message_content, external_id, metadata, ai_generated, performed_by, created_at')
        .eq('org_id', args.orgId)
        .in('channel', ['whatsapp', 'email'])
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(PAGE);
      if (cursor) query = query.or(keysetFilter(cursor));
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as LegacyInteraction[];
      if (rows.length === 0) break;

      for (const row of rows) {
        if (row.org_id !== args.orgId) {
          throw new Error('A página trouxe outra org. O script parou sem gravar o restante.');
        }
        const channel = row.channel === 'email' ? 'email' : 'whatsapp';
        const tally = tallies[channel] ?? emptyTally();
        tallies[channel] = tally;
        const audience = await loadAudience(db, args.orgId, row.lead_id, audiences);
        const decision = decideLegacyCopy(row, audience);
        if ('skip' in decision) {
          addReason(tally, decision.skip);
          continue;
        }
        if (!args.execute) {
          tally.wouldCopy += 1;
          if (samples.length < SAMPLE_LIMIT) samples.push(formatSample(row, decision.copy));
          continue;
        }

        const { status, ...insert } = decision.copy;
        const saved = await db
          .from('lead_messages')
          .upsert(insert, { onConflict: 'org_id,provider,provider_message_id', ignoreDuplicates: true })
          .select('id')
          .maybeSingle();
        if (saved.error) throw new Error(saved.error.message);
        if (!saved.data) {
          tally.duplicates += 1;
          continue;
        }
        tally.copied += 1;
        if (status) {
          const statusSaved = await db.from('lead_message_status_events').upsert(
            {
              org_id: decision.copy.org_id,
              message_id: saved.data.id,
              status,
              occurred_at: decision.copy.occurred_at,
              raw: { source: 'legacy_interactions' },
            },
            { onConflict: 'message_id,status', ignoreDuplicates: true },
          );
          if (statusSaved.error) throw new Error(statusSaved.error.message);
        }
      }

      cursor = cursorAfter(rows);
      if (rows.length < PAGE) break;
    }
    printReport(args.execute, tallies, samples);
  } catch (err) {
    printReport(args.execute, tallies, samples);
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
