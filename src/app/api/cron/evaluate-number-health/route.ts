import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { readNumberHealthFlag, runNumberHealthEvaluation } from '@/features/contact-engine/services/number-health.service';

export const maxDuration = 60;

interface EligibleInstance {
  id: string;
  org_id: string;
  instance_name: string;
}

interface FlagRow {
  key: string;
  enabled: boolean;
  allow_org_ids: string[] | null;
}

/**
 * Cron: avalia saude periodica de numeros Evolution conforme PR10.
 *
 * Somente instancias Evolution de organizacoes permitidas pela flag
 * `number_health_v1` (escopo org do PR12). Flag desligada ou ilegivel:
 * nenhuma gravacao. Avaliacao em lotes limitados, idempotente e segura
 * para concorrencia (CAS por health_state).
 *
 * IMPORTANTE: agendamento NUNCA e criado/ativado por este PR. Sera
 * documentado em runbook separado e ativado somente apos aprovacao.
 */
async function evaluateNumberHealth() {
  const db = createServiceRoleClient();

  // 1. Le flag global e lista de organizacoes permitidas.
  const flagRes = (await from(db, 'app_flags')
    .select('key, enabled, allow_org_ids')
    .eq('key', 'number_health_v1')
    .limit(1)) as unknown as { data: FlagRow[] | null; error: { message: string } | null };

  if (flagRes.error || !flagRes.data?.[0]) {
    return { evaluated: 0, skipped: 'flag_unreadable' };
  }

  const flag = flagRes.data[0];
  const globalEnabled = flag.enabled;
  const allowedOrgs = flag.allow_org_ids ?? [];

  // Flag desligada globalmente e sem organizacoes permitidas: nao avalia nada.
  if (!globalEnabled && allowedOrgs.length === 0) {
    return { evaluated: 0, skipped: 'flag_disabled' };
  }

  // 2. Busca instancias Evolution elegíveis (nao deletadas) de organizacoes permitidas.
  // PAGINACAO: limite 100 por execucao, ordenadas por health_evaluated_at ASC
  // (menos recentemente avaliadas primeiro) para prevenir fome.
  // FILTRO: is('deleted_at', null) seleciona instancias ATIVAS (deleted_at IS NULL).
  let query = from(db, 'whatsapp_instances')
    .select('id, org_id, instance_name')
    .is('deleted_at', null)
    .order('health_evaluated_at', { ascending: true, nullsFirst: true });

  if (!globalEnabled) {
    // Flag desligada globalmente: filtra somente orgs da lista permitida.
    query = query.in('org_id', allowedOrgs);
  }
  // Se globalEnabled, avalia todas as instancias (sem filtro de org).

  const instRes = (await query.limit(100)) as unknown as {
    data: EligibleInstance[] | null;
    error: { message: string } | null;
  };

  if (instRes.error || !instRes.data) {
    return { evaluated: 0, error: 'failed_to_read_instances' };
  }

  const instances = instRes.data;
  if (instances.length === 0) {
    return { evaluated: 0, skipped: 'no_eligible_instances' };
  }

  // 3. Avalia cada instancia em lote. Telemetria ausente nao bloqueia,
  //    mas avanco exige sinais conhecidos. Concorrencia e segura: CAS
  //    por health_state previne atropelos.
  let evaluated = 0;
  let skipped = 0;
  let failed = 0;

  for (const inst of instances) {
    try {
      // Verifica flag por organizacao antes de avaliar.
      const orgFlag = await readNumberHealthFlag({ orgId: inst.org_id });
      if (orgFlag !== 'on') {
        skipped++;
        continue;
      }

      const result = await runNumberHealthEvaluation({
        orgId: inst.org_id,
        instanceId: inst.id,
      });

      if (result.success && result.data.applied) {
        evaluated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[evaluate-number-health] Error evaluating ${inst.instance_name}:`, err);
      failed++;
    }
  }

  return { evaluated, skipped, failed, total: instances.length };
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await evaluateNumberHealth();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[evaluate-number-health] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
