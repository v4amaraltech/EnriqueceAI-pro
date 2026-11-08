import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { Uuid } from '../types';

import {
  dispatchOnce,
  DISPATCHER_FLAG_KEY,
  type DispatchRunResult,
  type PayloadResolver,
  type ProviderAdapters,
} from './dispatcher.service';
import { isFlagEnabledForAnyScope } from './flag-scope.service';
import { createDefaultAdapters } from './provider-adapters.service';
import { reconcileOnce, type ReconcileRunResult } from './reconciliation.service';

/**
 * Ciclo do cron do dispatcher (PR08): para cada organizacao com trabalho,
 * despacha e depois reconcilia.
 *
 * Inerte por padrao: com `dispatcher_v1` desligada nada e lido da fila. Mesmo
 * ligada, sem `PayloadResolver` configurado (a outbox nao guarda o corpo da
 * mensagem) o ciclo nao reserva nada. Hoje `getPayloadResolver()` devolve null:
 * quem enfileirar mensagens de verdade (PR seguinte) registra o resolver aqui.
 */
export function getPayloadResolver(): PayloadResolver | null {
  return null;
}

const MAX_ORGS_PER_CYCLE = 25;
const LEASE_OWNER = 'dispatch-outbox-cron';

export interface DispatchCycleResult {
  enabled: boolean;
  reason: string | null;
  orgs: number;
  dispatch: Array<{ orgId: Uuid; result: DispatchRunResult }>;
  reconcile: Array<{ orgId: Uuid; result: ReconcileRunResult }>;
}

async function listOrgsWithWork(): Promise<Uuid[] | null> {
  try {
    const { data, error } = (await from(createServiceRoleClient(), 'send_outbox')
      .select('org_id')
      .in('status', ['pending', 'reserved', 'sending', 'uncertain'])
      .limit(500)) as { data: Array<{ org_id: string }> | null; error?: { message: string } | null };
    if (error || !data) return null;
    return [...new Set(data.map((r) => r.org_id))].slice(0, MAX_ORGS_PER_CYCLE);
  } catch {
    return null;
  }
}

export async function runDispatchCycle(
  overrides: { resolver?: PayloadResolver | null; adapters?: ProviderAdapters; now?: () => Date } = {},
): Promise<DispatchCycleResult> {
  const base: DispatchCycleResult = { enabled: false, reason: null, orgs: 0, dispatch: [], reconcile: [] };
  // Portao do ciclo: ligada globalmente ou em alguma lista. A decisao por organizacao fica em dispatchOnce/reconcileOnce.
  if (!(await isFlagEnabledForAnyScope(DISPATCHER_FLAG_KEY))) return { ...base, reason: 'flag_disabled' };

  const resolver = overrides.resolver === undefined ? getPayloadResolver() : overrides.resolver;
  if (!resolver) return { ...base, enabled: true, reason: 'payload_resolver_not_configured' };

  const orgs = await listOrgsWithWork();
  if (!orgs) return { ...base, enabled: true, reason: 'read_failed' };

  const adapters = overrides.adapters ?? createDefaultAdapters();
  const out: DispatchCycleResult = { ...base, enabled: true, orgs: orgs.length };
  for (const orgId of orgs) {
    const common = { orgId, resolver, adapters, now: overrides.now };
    out.dispatch.push({ orgId, result: await dispatchOnce({ ...common, leaseOwner: LEASE_OWNER }) });
    out.reconcile.push({ orgId, result: await reconcileOnce(common) });
  }
  return out;
}
