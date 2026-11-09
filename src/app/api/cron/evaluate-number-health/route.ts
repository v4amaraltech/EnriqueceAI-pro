import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { runNumberHealthEvaluation } from '@/features/contact-engine/services/number-health.service';
import type { FlagRow } from '@/features/contact-engine/services/flag-scope.service';

import {
  collectEligibleInstances,
  HEALTH_EVALUATION_PAGE_SIZE,
  HEALTH_EVALUATION_WORK_LIMIT,
  orgEligibleForNumberHealth,
} from './batch';

export const maxDuration = 60;

interface EligibleInstance {
  id: string;
  org_id: string;
  instance_name: string;
}

interface FlagRead extends FlagRow {
  key: string;
}

/**
 * Avalia saude de instancias Evolution em lotes.
 *
 * A tabela `whatsapp_instances` nao tem soft delete. Toda linha e uma
 * instancia Evolution. Orgs fora da flag nao entram no lote de trabalho e
 * nao sao gravadas. Erro ou avaliacao nao aplicada avanca `health_evaluated_at`
 * para nao prender as 100 primeiras na frente das demais.
 *
 * O agendamento nao e criado aqui. O runbook descreve POST e a cadencia.
 */
async function evaluateNumberHealth() {
  const db = createServiceRoleClient();

  const flagRes = (await from(db, 'app_flags')
    .select('key, enabled, allow_org_ids, allow_user_ids')
    .eq('key', 'number_health_v1')
    .limit(1)) as unknown as { data: FlagRead[] | null; error: { message: string } | null };

  if (flagRes.error || !flagRes.data?.[0]) {
    return { evaluated: 0, skipped: 'flag_unreadable' };
  }

  const flag = flagRes.data[0];
  const allowedOrgs = flag.allow_org_ids ?? [];
  if (!flag.enabled && allowedOrgs.length === 0) {
    return { evaluated: 0, skipped: 'flag_disabled' };
  }

  const candidates: EligibleInstance[] = [];
  let offset = 0;
  for (;;) {
    const pageRes = (await from(db, 'whatsapp_instances')
      .select('id, org_id, instance_name')
      .order('health_evaluated_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(offset, offset + HEALTH_EVALUATION_PAGE_SIZE - 1)) as unknown as {
      data: EligibleInstance[] | null;
      error: { message: string } | null;
    };

    if (pageRes.error || !pageRes.data) {
      return { evaluated: 0, error: 'failed_to_read_instances' };
    }

    candidates.push(...pageRes.data);
    if (collectEligibleInstances(candidates, flag).length >= HEALTH_EVALUATION_WORK_LIMIT) break;
    if (pageRes.data.length < HEALTH_EVALUATION_PAGE_SIZE) break;
    offset += HEALTH_EVALUATION_PAGE_SIZE;
  }

  const instances = collectEligibleInstances(candidates, flag);
  if (instances.length === 0) {
    return { evaluated: 0, skipped: 'no_eligible_instances', scanned: candidates.length };
  }

  let evaluated = 0;
  let skipped = 0;
  let failed = 0;

  for (const inst of instances) {
    if (!orgEligibleForNumberHealth(flag, inst.org_id)) {
      skipped++;
      continue;
    }

    try {
      const result = await runNumberHealthEvaluation({
        orgId: inst.org_id,
        instanceId: inst.id,
      });

      if (result.success && result.data.applied) {
        evaluated++;
        continue;
      }

      if (result.success && (result.data.reason === 'flag_disabled' || result.data.reason === 'flag_unreadable')) {
        skipped++;
        continue;
      }

      if (!result.success) failed++;
      else skipped++;
      await advanceEvaluationCursor(db, inst);
    } catch (err) {
      console.error(`[evaluate-number-health] Error evaluating ${inst.instance_name}:`, err);
      failed++;
      await advanceEvaluationCursor(db, inst);
    }
  }

  return { evaluated, skipped, failed, total: instances.length, scanned: candidates.length };
}

/**
 * Tira a instancia da frente da fila sem alterar estado, teto, rampa ou freio.
 * So roda depois de uma tentativa elegivel que nao aplicou avaliacao.
 */
async function advanceEvaluationCursor(
  db: ReturnType<typeof createServiceRoleClient>,
  inst: EligibleInstance,
): Promise<void> {
  await from(db, 'whatsapp_instances')
    .update({ health_evaluated_at: new Date().toISOString() } as never)
    .eq('id', inst.id)
    .eq('org_id', inst.org_id);
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
