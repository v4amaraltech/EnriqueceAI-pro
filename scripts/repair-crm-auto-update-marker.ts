/**
 * Reparo do marcador calls.metadata.crm_auto_update apagado pela corrida de 13/11/2026
 * (o UPDATE do audio_stats regravou o metadata inteiro depois do CRM automático).
 * Casos conhecidos: ligações 6c5efe3c-... e 9f038ff7-... da V4 (passe os UUIDs completos).
 *
 * SÓ DRY-RUN. Lê calls e crm_auto_update_shadow_log (applied = true) e imprime o patch
 * que iria para merge_calls_metadata. Não grava nada. --apply é recusado de propósito:
 * a reposição, se aprovada, é feita depois do deploy da RPC, em PR próprio.
 * O log é append-only: este script nunca faz UPDATE nem DELETE nele.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm dlx tsx scripts/repair-crm-auto-update-marker.ts --call <uuid> --call <uuid>
 *
 * Sem credenciais no código: lê só das variáveis de ambiente acima.
 */
import { createClient } from '@supabase/supabase-js';

import {
  type MarkerRepairCall,
  type MarkerRepairLog,
  planMarkerRepair,
} from '../src/features/calls/services/crm-auto-update/marker-repair';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv: string[]): { callIds: string[] } {
  if (argv.includes('--apply') || argv.includes('--execute')) {
    throw new Error('Este script é só dry-run. --apply não está disponível neste PR.');
  }
  const callIds: string[] = [];
  argv.forEach((arg, i) => {
    if (arg === '--call') {
      const id = argv[i + 1];
      if (!id || !UUID.test(id))
        throw new Error(`--call inválido: ${id ?? '(vazio)'}. Use o UUID completo.`);
      callIds.push(id);
    }
  });
  if (callIds.length === 0) throw new Error('Informe ao menos um --call <uuid>.');
  return { callIds };
}

async function main() {
  const { callIds } = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  const db = createClient(url, key, { auth: { persistSession: false } });

  for (const callId of callIds) {
    const { data: call, error: callError } = (await db
      .from('calls')
      .select('id, org_id, sdr_disposition, metadata')
      .eq('id', callId)
      .maybeSingle()) as { data: MarkerRepairCall | null; error: { message: string } | null };
    if (callError) throw new Error(`calls ${callId}: ${callError.message}`);

    const { data: logs, error: logError } = (await db
      .from('crm_auto_update_shadow_log')
      .select('call_id, applied, applied_at, rules_version, qualification_id, proposed_changes')
      .eq('call_id', callId)
      .eq('applied', true)) as {
      data: MarkerRepairLog[] | null;
      error: { message: string } | null;
    };
    if (logError) throw new Error(`log ${callId}: ${logError.message}`);

    const plan = planMarkerRepair(callId, call, logs ?? []);
    if (plan.action === 'skip') {
      console.warn(`[dry-run] ${callId}: nada a fazer (${plan.reason})`);
      continue;
    }
    console.warn(
      `[dry-run] ${callId}: repor o marcador com merge_calls_metadata(p_id => '${plan.callId}', ` +
        `p_org_id => '${plan.orgId}', p_patch => '${JSON.stringify(plan.patch)}'::jsonb). Nada foi gravado.`,
    );
  }
}

if (process.argv[1]?.endsWith('repair-crm-auto-update-marker.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
